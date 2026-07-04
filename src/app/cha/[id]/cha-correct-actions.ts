"use server";

import { revalidatePath } from "next/cache";
import { getChaSession } from "@/lib/supabase/cha-auth";
import { createSupabaseAuthClient } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { proposeCorrection } from "@/lib/ai/apply-correction";
import { generateCoreDocSet } from "@/lib/docs/generate";
import { sendDocsToCustomerCore } from "@/lib/docs/send-to-customer";
import { notifyCustomerWhatsApp } from "@/lib/whatsapp/notify";
import { screenShipmentParties, partiesFromExtracted } from "@/lib/screening/screen-shipment";
import { validateExtracted } from "@/lib/docs/validate";

type CorrectResult =
  | { ok: true; field: string; oldValue: string; newValue: string; note?: string }
  | { ok: false; error: string };
type Result = { ok: true } | { ok: false; error: string };

// A change to any party name must re-run denied-party screening before any
// document is regenerated (mirrors the operator correction path).
const PARTY_KEYS = ["buyer_name", "consignee_name", "notify_party_name"];

// The broker may correct the pack only while it sits on their desk (handed over)
// and they haven't filed yet. Once filed (cha_review_status='filed'), it's closed.
const CHA_CORRECTABLE = new Set(["customer_approved", "filed_with_cha"]);

// Per-broker throttle — each correction is a paid model call + a doc regeneration.
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

// G5 conversational correction (Build Bible §12.3), broker side. Mirrors the
// operator's guarded loop — propose one field change → re-screen parties →
// validate → regenerate — but scoped and audited to the CHA.
//
// IMMUTABILITY (Build Bible §8): the exporter has already approved & locked this
// pack before it reached the broker. A broker correction therefore UN-APPROVES it
// and bounces it back to the exporter for a fresh approval (re-generated docs are
// new versions; the approved originals are never mutated). The exporter re-approves
// every change to their own documents — nothing they signed off on changes silently.
//
// Ownership is proven by the broker's own RLS-scoped read BEFORE any service-role
// write: the broker has no write RLS, the admin client bypasses RLS, so that read
// is the gate.
export async function chaApplyCorrection(
  shipmentId: string,
  instruction: string
): Promise<CorrectResult> {
  const session = await getChaSession();
  if (!session) return { ok: false, error: "Not authorized" };
  if (!instruction.trim()) return { ok: false, error: "Type what to fix." };
  if (rateLimited(session.userId)) return { ok: false, error: "Please wait a moment and try again." };

  const broker = await createSupabaseAuthClient();
  const { data: ship } = await broker
    .from("shipments")
    .select("status, cha_review_status, extracted_data, customer_id, reference_number")
    .eq("id", shipmentId)
    .maybeSingle();
  if (!ship) return { ok: false, error: "Not your shipment." };

  const status = ship.status as string;
  if (ship.cha_review_status === "filed") {
    return { ok: false, error: "This shipment is already filed — corrections are closed." };
  }
  if (!CHA_CORRECTABLE.has(status)) {
    return { ok: false, error: "This pack isn't open for changes right now." };
  }

  const current = (ship.extracted_data ?? {}) as Record<string, string>;
  const correction = await proposeCorrection(current, instruction);
  if (!correction) {
    return { ok: false, error: "Couldn't work out a concrete fix — try naming the field and the value." };
  }

  const oldValue = (current[correction.field] ?? "").toString();
  const merged = { ...current, [correction.field]: correction.value };

  // Service-role write (broker has no write RLS). Atomic merge of just the one
  // corrected field, guarded on the status we read (p_expected_status) so a
  // correction can't land on a pack that moved on between the read and the write —
  // the RPC returns false when the guard fails.
  const admin = createSupabaseServerClient();
  const { data: applied, error: updErr } = await admin.rpc("merge_extracted_data", {
    p_shipment_id: shipmentId,
    p_patch: { [correction.field]: correction.value },
    p_expected_status: status,
  });
  if (updErr || !applied) {
    return { ok: false, error: "Couldn't apply the change — the shipment may have moved on." };
  }

  // Append-only audit, attributed to the broker (operator_id null). Uses
  // corrected_by:"cha" to mirror the operator path's corrected_by:"operator".
  await admin.from("audit_operator_action").insert({
    operator_id: null,
    shipment_id: shipmentId,
    action_type: "extract",
    old_value: { [correction.field]: oldValue },
    new_value: {
      [correction.field]: correction.value,
      corrected_by: "cha",
      cha_user_id: session.userId,
      via: "cha_doc_review",
      instruction: instruction.slice(0, 500),
    },
  });

  const ok = { ok: true as const, field: correction.field, oldValue, newValue: correction.value };
  const holdAt = async (newStatus: string) =>
    admin.from("shipments").update({ status: newStatus }).eq("id", shipmentId).eq("status", status);

  // GUARD 1 — denied-party screening. A corrected party must be re-screened before
  // any document is regenerated. Fail closed: pull the shipment back into the
  // sanctions process (off the broker's desk) rather than print an unscreened party.
  if (PARTY_KEYS.includes(correction.field)) {
    try {
      const screening = await screenShipmentParties(shipmentId, partiesFromExtracted(merged));
      if (!screening.proceed) {
        await holdAt("sanctions_screening");
        revalidatePath(`/cha/${shipmentId}`);
        return {
          ...ok,
          note: "That party needs a sanctions re-check — I've sent it back for screening and didn't regenerate the documents.",
        };
      }
    } catch {
      console.error("cha_correction_rescreen_threw", { shipmentId });
      await holdAt("sanctions_screening");
      revalidatePath(`/cha/${shipmentId}`);
      return { ...ok, note: "Held for a sanctions re-check — documents not regenerated." };
    }
  }

  // GUARD 2 — never regenerate a document with a value the rules reject.
  if (validateExtracted(merged).some((i) => i.field === correction.field)) {
    await holdAt("bucket_b_review");
    revalidatePath(`/cha/${shipmentId}`);
    return {
      ...ok,
      note: "Saved, but that value needs a closer look — I've flagged it for review and didn't regenerate the documents.",
    };
  }

  // Clean — redraft the pack as NEW versions, then UN-APPROVE it: send it back to
  // the exporter to re-approve. We move status to awaiting_customer_approval
  // ourselves (guarded) so the pack can NEVER sit "changed but still approved" even
  // if the WhatsApp re-send fails — the exporter can always re-approve in-portal.
  await generateCoreDocSet(shipmentId, null);
  await admin
    .from("shipments")
    .update({ status: "awaiting_customer_approval", cha_review_status: null, cha_review_note: null })
    .eq("id", shipmentId)
    .in("status", ["customer_approved", "filed_with_cha"]);

  // Best-effort: tell the exporter their CHA changed it, then re-send the revised
  // pack with an APPROVE prompt. Failures here don't undo the un-approval above.
  const fieldLabel = correction.field.replace(/_/g, " ");
  try {
    await notifyCustomerWhatsApp(
      admin,
      ship.customer_id as string,
      `Your CHA reviewed ${ship.reference_number} and updated the ${fieldLabel}. I've re-sent the revised documents — please review and reply APPROVE.`
    );
  } catch {
    // attribution ping is best-effort
  }
  try {
    await sendDocsToCustomerCore(shipmentId, null);
  } catch {
    console.error("cha_correction_resend_threw", { shipmentId });
  }

  revalidatePath(`/cha/${shipmentId}`);
  return {
    ...ok,
    note: "Updated and sent back to the exporter to re-approve. It returns to your desk once they confirm.",
  };
}

// G5 — the broker approves the document set. Forgiving: no precondition on flags
// (per §12.3, approval never dead-ends). Persisted via the cha_approve_docs RPC
// (migration 032), which re-checks broker ownership server-side.
export async function chaApproveDocs(shipmentId: string): Promise<Result> {
  const session = await getChaSession();
  if (!session) return { ok: false, error: "Not authorized" };
  const supabase = await createSupabaseAuthClient();
  const { error } = await supabase.rpc("cha_approve_docs", { p_shipment: shipmentId });
  if (error) {
    console.error("cha_approve_docs_failed", { code: error.code });
    return { ok: false, error: "Could not save — please try again." };
  }
  revalidatePath(`/cha/${shipmentId}`);
  revalidatePath("/cha");
  return { ok: true };
}
