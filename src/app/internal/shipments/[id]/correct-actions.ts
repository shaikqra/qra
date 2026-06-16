"use server";

import { revalidatePath } from "next/cache";
import { getOperatorSession } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { proposeCorrection } from "@/lib/ai/apply-correction";
import { reviewDocuments, type DocReviewFlag } from "@/lib/ai/review-documents";
import { classifyHsCode, type HsResult } from "@/lib/ai/classify-hs";
import { generateCommercialInvoiceCore, generatePackingListCore } from "@/lib/docs/generate";
import { screenShipmentParties, partiesFromExtracted } from "@/lib/screening/screen-shipment";
import { validateExtracted } from "@/lib/docs/validate";

type Result =
  | { ok: true; field: string; oldValue: string; newValue: string; note?: string }
  | { ok: false; error: string };

type CheckResult = { ok: true; flags: DocReviewFlag[] } | { ok: false; error: string };

// Run the AI data-consistency check over the shipment's data (operator side, so
// the flags sit next to the fix box — the §12 loop on one surface).
export async function checkShipmentDocs(shipmentId: string): Promise<CheckResult> {
  const session = await getOperatorSession();
  if (!session) return { ok: false, error: "Not authorized" };
  if (rateLimited(`check:${session.userId}`)) return { ok: false, error: "Please wait a moment and try again." };
  const admin = createSupabaseServerClient();
  const { data: ship } = await admin
    .from("shipments")
    .select("extracted_data")
    .eq("id", shipmentId)
    .maybeSingle();
  if (!ship) return { ok: false, error: "Shipment not found." };
  const flags = await reviewDocuments((ship.extracted_data ?? {}) as Record<string, string>);
  return { ok: true, flags };
}

type VerifyResult =
  | { ok: true; intact: boolean; checked: number; brokenAt: number | null }
  | { ok: false; error: string };

// Prove the shipment's tamper-evident audit chain is intact (Build Bible §8).
export async function verifyAuditChain(shipmentId: string): Promise<VerifyResult> {
  const session = await getOperatorSession();
  if (!session) return { ok: false, error: "Not authorized" };
  const admin = createSupabaseServerClient();
  const { data, error } = await admin.rpc("verify_audit_chain", { p_shipment: shipmentId });
  if (error) {
    console.error("verify_audit_chain_failed", { code: error.code });
    return { ok: false, error: "Couldn't verify the trail." };
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    | { ok?: boolean; broken_at?: number | null; checked?: number }
    | undefined;
  return {
    ok: true,
    intact: !!row?.ok,
    checked: Number(row?.checked ?? 0),
    brokenAt: row?.broken_at != null ? Number(row.broken_at) : null,
  };
}

type HsCheckResult = { ok: true; result: HsResult } | { ok: false; error: string };

// Advisory HS-code check (Compliance agent). Reads the goods + current HS code
// and asks the AI whether they match. Read-only — surfaces a suggestion the
// operator can apply through the normal guarded correction.
export async function checkHsCode(shipmentId: string): Promise<HsCheckResult> {
  const session = await getOperatorSession();
  if (!session) return { ok: false, error: "Not authorized" };
  if (rateLimited(`hs:${session.userId}`)) return { ok: false, error: "Please wait a moment and try again." };
  const admin = createSupabaseServerClient();
  const { data: ship } = await admin
    .from("shipments")
    .select("extracted_data")
    .eq("id", shipmentId)
    .maybeSingle();
  if (!ship) return { ok: false, error: "Shipment not found." };
  const d = (ship.extracted_data ?? {}) as Record<string, string>;
  const result = await classifyHsCode(d.product_description ?? "", d.hs_code ?? "");
  if (!result) return { ok: false, error: "Couldn't check the HS code — add a product description first." };
  return { ok: true, result };
}

// G8 close is the EXPORTER's gate (Build Bible §4): it lives only in the exporter
// console (portalCloseShipment). Mission Control / the operator owns no gates, so
// there is deliberately NO operator-side close action here.

// A change to any of these must re-run denied-party screening — a corrected
// party name can't reach the documents without being checked.
const PARTY_KEYS = ["buyer_name", "consignee_name", "notify_party_name"];

// Documents become immutable once the customer approves them (Build Bible §8),
// so the in-place AI correction is allowed ONLY while the shipment is still in
// pre-approval review. After approval, the fix path is "request a change", not a
// silent edit of an approved/filed pack.
const CORRECTABLE = new Set([
  "po_received",
  "data_extracting",
  "awaiting_customer_info",
  "generating_documents",
  "sanctions_screening",
  "bucket_b_review",
]);

// Best-effort per-operator throttle (in-memory, per server instance, resets on
// cold start). Operator auth is the real guard; this just caps paid AI + regen
// bursts from one reviewer mashing the button.
const RATE_MAX = 12;
const RATE_WINDOW_MS = 60_000;
const buckets = new Map<string, number[]>();
function rateLimited(key: string): boolean {
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  const hits = (buckets.get(key) ?? []).filter((t) => t > cutoff);
  if (hits.length >= RATE_MAX) {
    buckets.set(key, hits);
    return true;
  }
  hits.push(now);
  buckets.set(key, hits);
  return false;
}

export async function applyAiCorrection(shipmentId: string, instruction: string): Promise<Result> {
  const session = await getOperatorSession();
  if (!session) return { ok: false, error: "Not authorized" };
  if (!instruction.trim()) return { ok: false, error: "Type what to fix." };
  if (rateLimited(session.userId)) return { ok: false, error: "Please wait a moment and try again." };

  const admin = createSupabaseServerClient();
  const { data: ship } = await admin
    .from("shipments")
    .select("status, extracted_data")
    .eq("id", shipmentId)
    .maybeSingle();
  if (!ship) return { ok: false, error: "Shipment not found." };

  const status = ship.status as string;
  if (!CORRECTABLE.has(status)) {
    return {
      ok: false,
      error: "These documents are already approved — request a change instead of editing them.",
    };
  }

  const current = (ship.extracted_data ?? {}) as Record<string, string>;
  const correction = await proposeCorrection(current, instruction);
  if (!correction) {
    return { ok: false, error: "Couldn't work out a concrete fix — try naming the field and the value." };
  }

  const oldValue = (current[correction.field] ?? "").toString();
  const merged = { ...current, [correction.field]: correction.value };

  // Re-assert the pre-approval status on write, so a correction can't land on a
  // pack that just got approved between the read and the write.
  const { data: saved, error: updErr } = await admin
    .from("shipments")
    .update({ extracted_data: merged })
    .eq("id", shipmentId)
    .eq("status", status)
    .select("id");
  if (updErr || !saved || saved.length === 0) {
    return { ok: false, error: "Couldn't apply the correction — the shipment may have moved on." };
  }

  await admin.from("audit_operator_action").insert({
    operator_id: session.userId,
    shipment_id: shipmentId,
    action_type: "extract",
    old_value: { [correction.field]: oldValue },
    new_value: {
      [correction.field]: correction.value,
      corrected_by: "operator",
      via: "doc_review",
      instruction: instruction.slice(0, 500),
    },
  });

  const ok = { ok: true as const, field: correction.field, oldValue, newValue: correction.value };
  const holdAt = async (newStatus: string) =>
    admin.from("shipments").update({ status: newStatus }).eq("id", shipmentId).eq("status", status);

  // GUARD 1 — denied-party screening. A corrected party name must be re-screened
  // BEFORE any document is regenerated, exactly like the manual edit path. Fail
  // closed: if screening can't run, hold the shipment rather than print it.
  if (PARTY_KEYS.includes(correction.field)) {
    try {
      const screening = await screenShipmentParties(shipmentId, partiesFromExtracted(merged));
      if (!screening.proceed) {
        await holdAt("sanctions_screening");
        revalidatePath(`/internal/shipments/${shipmentId}`);
        return { ...ok, note: "Held for sanctions review — the new party is being screened. Documents not regenerated." };
      }
    } catch {
      console.error("ai_correction_rescreen_threw", { shipmentId });
      await holdAt("sanctions_screening");
      revalidatePath(`/internal/shipments/${shipmentId}`);
      return { ...ok, note: "Held for sanctions review. Documents not regenerated." };
    }
  }

  // GUARD 2 — trust gate. Never regenerate a document with a value the rules
  // reject (e.g. a malformed HS code or currency). Flag for review instead.
  if (validateExtracted(merged).some((i) => i.field === correction.field)) {
    await holdAt("bucket_b_review");
    revalidatePath(`/internal/shipments/${shipmentId}`);
    return { ...ok, note: "Saved, but the new value needs a check — flagged for review, documents not regenerated." };
  }

  // Clean — redraft the documents (new versions; the old ones were never
  // approved, so nothing immutable is touched).
  await generateCommercialInvoiceCore(shipmentId, session.userId);
  await generatePackingListCore(shipmentId, session.userId);

  revalidatePath(`/internal/shipments/${shipmentId}`);
  return ok;
}
