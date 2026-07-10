"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseAuthClient, getOperatorSession } from "@/lib/supabase/auth";
import { screenShipmentParties, partiesFromExtracted } from "@/lib/screening/screen-shipment";
import { writeAudit } from "@/lib/audit";

const PARTY_KEYS = ["buyer_name", "consignee_name", "notify_party_name"];

type SaveExtractionInput = {
  shipmentId: string;
  extractedData: Record<string, string>;
  status: string;
  notes: string;
};

type ActionResult = { ok: true } | { ok: false; error: string };

const ALLOWED_STATUSES = [
  "po_received",
  "data_extracting",
  "awaiting_customer_info",
  "generating_documents",
  "sanctions_screening",
  "bucket_b_review",
  "awaiting_customer_approval",
  "customer_approved",
  "filed_with_cha",
  "customs_cleared",
  "in_transit",
  "delivered",
  "completed",
  "rejected",
];

export async function saveShipmentExtraction(
  input: SaveExtractionInput
): Promise<ActionResult> {
  const session = await getOperatorSession();
  if (!session) return { ok: false, error: "Not authorized" };

  if (!ALLOWED_STATUSES.includes(input.status)) {
    return { ok: false, error: "Invalid status" };
  }

  const supabase = await createSupabaseAuthClient();

  const { data: current, error: fetchErr } = await supabase
    .from("shipments")
    .select("id, status, extracted_data, notes")
    .eq("id", input.shipmentId)
    .maybeSingle();

  if (fetchErr || !current) {
    return { ok: false, error: "Shipment not found" };
  }

  // The patch is the 25 VISIBLE form fields only — kept INCLUDING blanks (as "")
  // so the operator can clear a field (a merge can't delete a key, but it can set
  // it to ""). Reserved underscore keys (_lc, _tracking, _booking_draft, ...) are
  // never in the form, so they're filtered out here and the merge leaves them
  // untouched — the old whole-blob write wiped them on every Save (the data-loss bug).
  const patch: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.extractedData)) {
    if (k.startsWith("_")) continue;
    patch[k] = (v ?? "").trim();
  }

  const prevExtracted = (current.extracted_data ?? {}) as Record<string, string>;
  const mergedExtracted = { ...prevExtracted, ...patch };

  // extracted_data via the atomic merge (reserved keys preserved). status + notes
  // are real columns — updated directly, exactly as before.
  const { error: mergeErr } = await supabase.rpc("merge_extracted_data", {
    p_shipment_id: input.shipmentId,
    p_patch: patch,
  });
  if (mergeErr) {
    return { ok: false, error: "Could not save changes" };
  }

  const { error: updateErr } = await supabase
    .from("shipments")
    .update({
      status: input.status,
      notes: input.notes.trim() || null,
    })
    .eq("id", input.shipmentId);

  if (updateErr) {
    return { ok: false, error: "Could not save changes" };
  }

  const audits: {
    operator_id: string;
    shipment_id: string;
    action_type: string;
    old_value: unknown;
    new_value: unknown;
  }[] = [];

  // Audit the ACTUAL stored state: old = prior full blob, new = the merged blob.
  // Reserved keys are identical in both (the patch never touches them), so they're
  // never falsely reported as changed — only the visible fields the operator edited
  // show a diff.
  if (JSON.stringify(prevExtracted) !== JSON.stringify(mergedExtracted)) {
    audits.push({
      operator_id: session.userId,
      shipment_id: input.shipmentId,
      action_type: "extract",
      old_value: prevExtracted,
      new_value: mergedExtracted,
    });
  }

  if (current.status !== input.status) {
    audits.push({
      operator_id: session.userId,
      shipment_id: input.shipmentId,
      action_type: "status_change",
      old_value: { status: current.status },
      new_value: { status: input.status },
    });
  }

  const newNotes = input.notes.trim() || null;
  if ((current.notes ?? null) !== newNotes) {
    audits.push({
      operator_id: session.userId,
      shipment_id: input.shipmentId,
      action_type: "note",
      old_value: { notes: current.notes ?? null },
      new_value: { notes: newNotes },
    });
  }

  // Insert one row per statement (not a single multi-row insert): the audit
  // hash-chain trigger must fire in seq order, and Postgres doesn't guarantee
  // firing order within a multi-row insert — which would fork the chain.
  for (const a of audits) {
    await supabase.from("audit_operator_action").insert(a);
  }

  // If the operator changed a party name, re-run denied-party screening on the
  // new names. A flag forces the shipment back to sanctions review regardless
  // of the status they picked — a newly-entered party can't skip the check.
  const partyChanged = PARTY_KEYS.some(
    (k) => (prevExtracted[k] ?? "").trim() !== (patch[k] ?? "").trim()
  );
  if (partyChanged) {
    try {
      const screening = await screenShipmentParties(
        input.shipmentId,
        partiesFromExtracted(mergedExtracted)
      );
      // Don't yank back a shipment the operator deliberately rejected — that's
      // already a stronger decision than "needs screening".
      if (screening.flagged && input.status !== "rejected") {
        await supabase
          .from("shipments")
          .update({ status: "sanctions_screening" })
          .eq("id", input.shipmentId);
        // The forced move overrides the status the operator picked, so record it —
        // otherwise the audit trail's last status_change lags the live column.
        if (input.status !== "sanctions_screening") {
          await writeAudit(supabase, {
            operator_id: session.userId,
            shipment_id: input.shipmentId,
            action_type: "status_change",
            old_value: { status: input.status },
            new_value: { status: "sanctions_screening" },
          });
        }
      }
    } catch {
      // On a THROWN screening failure we can't vouch for the new party, so fail
      // CLOSED: force the shipment back into sanctions review rather than let it
      // proceed at the operator's chosen status (mirrors the correction paths).
      // The rejected carve-out matches the flagged branch above — a deliberately
      // rejected order is already blocked and shouldn't be resurrected. No PII.
      console.error("rescreen_threw", { shipmentId: input.shipmentId });
      if (input.status !== "rejected") {
        await supabase
          .from("shipments")
          .update({ status: "sanctions_screening" })
          .eq("id", input.shipmentId);
        // Same fail-closed override as the flagged branch — audit the forced move
        // so the trail's last status doesn't lag the live column.
        if (input.status !== "sanctions_screening") {
          await writeAudit(supabase, {
            operator_id: session.userId,
            shipment_id: input.shipmentId,
            action_type: "status_change",
            old_value: { status: input.status },
            new_value: { status: "sanctions_screening" },
          });
        }
      }
    }
  }

  revalidatePath(`/internal/shipments/${input.shipmentId}`);
  revalidatePath("/internal/shipments");
  return { ok: true };
}
