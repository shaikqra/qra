"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseAuthClient, getOperatorSession } from "@/lib/supabase/auth";

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

  const cleanedExtracted: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.extractedData)) {
    const trimmed = (v ?? "").trim();
    if (trimmed) cleanedExtracted[k] = trimmed;
  }

  const { error: updateErr } = await supabase
    .from("shipments")
    .update({
      extracted_data: cleanedExtracted,
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

  if (JSON.stringify(current.extracted_data) !== JSON.stringify(cleanedExtracted)) {
    audits.push({
      operator_id: session.userId,
      shipment_id: input.shipmentId,
      action_type: "extract",
      old_value: current.extracted_data,
      new_value: cleanedExtracted,
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

  if (audits.length > 0) {
    await supabase.from("audit_operator_action").insert(audits);
  }

  revalidatePath(`/internal/shipments/${input.shipmentId}`);
  revalidatePath("/internal/shipments");
  return { ok: true };
}
