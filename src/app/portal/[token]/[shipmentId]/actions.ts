"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveCustomerByPortalToken, portalWriteRateLimited } from "@/lib/portal/auth";
import { runAutoPipeline, loadStoredExtraction } from "@/lib/docs/auto-pipeline";
import { sendDocsToChaCore } from "@/lib/docs/send-to-cha-core";
import { isAutoSendChaEnabled } from "@/lib/app-settings";

type Result = { ok: true } | { ok: false; error: string };

// Authorize a portal write: the token must resolve to a customer, AND that
// shipment must belong to them AND be at the expected gate. Returns the
// customer id, or null (caller turns that into a friendly refusal). This is the
// same trust the WhatsApp path gets from the verified phone number — here the
// secret link is the credential.
async function authorize(
  token: string,
  shipmentId: string,
  expectedStatus: string
): Promise<{ customerId: string } | null> {
  const customer = await resolveCustomerByPortalToken(token);
  if (!customer) return null;
  const admin = createSupabaseServerClient();
  const { data } = await admin
    .from("shipments")
    .select("id")
    .eq("id", shipmentId)
    .eq("customer_id", customer.id)
    .eq("status", expectedStatus)
    .maybeSingle();
  return data ? { customerId: customer.id } : null;
}

// Confirm a drafted (emailed) order — resumes the pipeline from the stored draft.
export async function portalConfirmOrder(token: string, shipmentId: string): Promise<Result> {
  if (portalWriteRateLimited(`act:${token}`)) return { ok: false, error: "Please wait a moment and try again." };
  if (!(await authorize(token, shipmentId, "awaiting_order_confirm")))
    return { ok: false, error: "This order can't be confirmed right now." };

  const admin = createSupabaseServerClient();
  // Atomic claim — a double-tap (or a simultaneous WhatsApp CONFIRM) can't double-run.
  const { data: claimed } = await admin
    .from("shipments")
    .update({ status: "data_extracting" })
    .eq("id", shipmentId)
    .eq("status", "awaiting_order_confirm")
    .select("id");
  if (!claimed || claimed.length === 0) return { ok: true }; // already moving

  await admin.from("audit_operator_action").insert({
    operator_id: null,
    shipment_id: shipmentId,
    action_type: "approve",
    old_value: { status: "awaiting_order_confirm" },
    new_value: { event: "order_confirmed", confirmed_by: "customer", via: "portal" },
  });

  after(async () => {
    await runAutoPipeline({ shipmentId, extract: () => loadStoredExtraction(shipmentId) });
  });

  revalidatePath(`/portal/${token}/${shipmentId}`);
  return { ok: true };
}

export async function portalDeclineOrder(token: string, shipmentId: string): Promise<Result> {
  if (portalWriteRateLimited(`act:${token}`)) return { ok: false, error: "Please wait a moment and try again." };
  if (!(await authorize(token, shipmentId, "awaiting_order_confirm")))
    return { ok: false, error: "This order can't be declined right now." };

  const admin = createSupabaseServerClient();
  await admin
    .from("shipments")
    .update({ status: "order_declined" })
    .eq("id", shipmentId)
    .eq("status", "awaiting_order_confirm");
  await admin.from("audit_operator_action").insert({
    operator_id: null,
    shipment_id: shipmentId,
    action_type: "note",
    old_value: { status: "awaiting_order_confirm" },
    new_value: { event: "order_declined", declined_by: "customer", via: "portal" },
  });
  revalidatePath(`/portal/${token}/${shipmentId}`);
  return { ok: true };
}

// Approve the document set — the recorded human gate that authorises sending to
// the CHA. Mirrors the WhatsApp APPROVE path (stamp docs, move to
// customer_approved, hand off to the broker). Audited with via:'portal' so the
// channel is on the immutable trail.
export async function portalApproveDocs(token: string, shipmentId: string): Promise<Result> {
  if (portalWriteRateLimited(`act:${token}`)) return { ok: false, error: "Please wait a moment and try again." };
  if (!(await authorize(token, shipmentId, "awaiting_customer_approval")))
    return { ok: false, error: "These documents can't be approved right now." };

  const admin = createSupabaseServerClient();
  const approvalMessage = "Approved via Qra portal";

  // Claim the status transition FIRST — this is the idempotency guard. A second
  // tap (or a crash mid-approve) finds zero rows here and exits cleanly, instead
  // of dead-ending the exporter on the most important button in the product.
  const { data: claimed } = await admin
    .from("shipments")
    .update({ status: "customer_approved" })
    .eq("id", shipmentId)
    .eq("status", "awaiting_customer_approval")
    .select("id");
  if (!claimed || claimed.length === 0) return { ok: true }; // already approved

  // Now stamp the approval onto the documents (the immutable per-doc record).
  const { data: updated } = await admin
    .from("generated_documents")
    .update({ approved_at: new Date().toISOString(), approval_message: approvalMessage })
    .eq("shipment_id", shipmentId)
    .is("approved_at", null)
    .select("id");
  const approvedCount = updated?.length ?? 0;

  await admin.from("audit_operator_action").insert({
    operator_id: null,
    shipment_id: shipmentId,
    action_type: "approve",
    old_value: { status: "awaiting_customer_approval" },
    new_value: {
      approved_by: "customer",
      via: "portal",
      approval_message: approvalMessage,
      documents_approved: approvedCount,
      status_changed_to: "customer_approved",
    },
  });

  // Hand off to the CHA in the background (only if the operator enabled auto-send).
  after(async () => {
    try {
      if (!(await isAutoSendChaEnabled())) return;
      const sent = await sendDocsToChaCore(shipmentId, null, "customer_approved");
      const benign =
        sent.ok || ["no_cha_email", "not_configured", "already_sent"].includes((sent as { reason?: string }).reason ?? "");
      if (!benign) console.error("portal_auto_cha_send_failed", { shipmentId, reason: (sent as { reason?: string }).reason });
    } catch (err) {
      console.error("portal_auto_cha_send_threw", { shipmentId, name: err instanceof Error ? err.name : "unknown" });
    }
  });

  revalidatePath(`/portal/${token}/${shipmentId}`);
  return { ok: true };
}
