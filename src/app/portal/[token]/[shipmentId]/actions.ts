"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveCustomerByPortalToken, portalWriteRateLimited } from "@/lib/portal/auth";
import { runAutoPipeline, loadStoredExtraction } from "@/lib/docs/auto-pipeline";
import { sendDocsToChaCore } from "@/lib/docs/send-to-cha-core";
import { notifyCustomerWhatsApp } from "@/lib/whatsapp/notify";
import { isAutoSendChaEnabled } from "@/lib/app-settings";
import { negotiateTargetFor } from "@/lib/freight/rank-quotes";

type Result = { ok: true } | { ok: false; error: string };

// Authorize a portal write: the token must resolve to a customer, AND that
// shipment must belong to them AND be at the expected gate. Returns the
// customer id + reference, or null (caller turns that into a friendly refusal).
// This is the same trust the WhatsApp path gets from the verified phone number —
// here the secret link is the credential.
async function authorize(
  token: string,
  shipmentId: string,
  expectedStatus: string
): Promise<{ customerId: string; referenceNumber: string } | null> {
  const customer = await resolveCustomerByPortalToken(token);
  if (!customer) return null;
  const admin = createSupabaseServerClient();
  const { data } = await admin
    .from("shipments")
    .select("id, reference_number")
    .eq("id", shipmentId)
    .eq("customer_id", customer.id)
    .eq("status", expectedStatus)
    .maybeSingle();
  return data
    ? { customerId: customer.id, referenceNumber: (data.reference_number as string) ?? shipmentId }
    : null;
}

// Confirm a drafted (emailed) order — resumes the pipeline from the stored draft.
export async function portalConfirmOrder(token: string, shipmentId: string): Promise<Result> {
  if (portalWriteRateLimited(`act:${token}`)) return { ok: false, error: "Please wait a moment and try again." };
  const auth = await authorize(token, shipmentId, "awaiting_order_confirm");
  if (!auth) return { ok: false, error: "This order can't be confirmed right now." };

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
    // Mirror the WhatsApp confirm reply, so both channels stay in sync.
    await notifyCustomerWhatsApp(
      admin,
      auth.customerId,
      `✅ Confirmed — I'm preparing your export documents for ${auth.referenceNumber} now. They'll arrive here shortly.`
    );
    await runAutoPipeline({ shipmentId, extract: () => loadStoredExtraction(shipmentId) });
  });

  revalidatePath(`/portal/${token}/${shipmentId}`);
  return { ok: true };
}

// Verify gate (G1): the exporter confirms the fields Qra wasn't sure about are
// correct, which resumes the pipeline (skipping the low-confidence re-flag — they
// just vouched for the values). Corrections to a value go via WhatsApp free text;
// this button is the "yes, they're right" path. Mirrors the WhatsApp CONFIRM with
// an atomic claim so a double-tap (or a simultaneous WhatsApp confirm) can't
// double-run.
export async function portalVerifyOrder(token: string, shipmentId: string): Promise<Result> {
  if (portalWriteRateLimited(`act:${token}`)) return { ok: false, error: "Please wait a moment and try again." };
  const auth = await authorize(token, shipmentId, "awaiting_customer_verify");
  if (!auth) return { ok: false, error: "This order can't be confirmed right now." };

  const admin = createSupabaseServerClient();
  const { data: claimed } = await admin
    .from("shipments")
    .update({ status: "data_extracting" })
    .eq("id", shipmentId)
    .eq("status", "awaiting_customer_verify")
    .select("id");
  if (!claimed || claimed.length === 0) return { ok: true }; // already moving

  await admin.from("audit_operator_action").insert({
    operator_id: null,
    shipment_id: shipmentId,
    action_type: "approve",
    old_value: { status: "awaiting_customer_verify" },
    new_value: { event: "order_verified", verified_by: "customer", via: "portal" },
  });

  after(async () => {
    await notifyCustomerWhatsApp(
      admin,
      auth.customerId,
      `✅ Thanks for confirming — I'm preparing your export documents for ${auth.referenceNumber} now. They'll arrive here shortly.`
    );
    await runAutoPipeline({
      shipmentId,
      extract: () => loadStoredExtraction(shipmentId),
      skipLowConfidence: true,
    });
  });

  revalidatePath(`/portal/${token}/${shipmentId}`);
  return { ok: true };
}

export async function portalDeclineOrder(token: string, shipmentId: string): Promise<Result> {
  if (portalWriteRateLimited(`act:${token}`)) return { ok: false, error: "Please wait a moment and try again." };
  const auth = await authorize(token, shipmentId, "awaiting_order_confirm");
  if (!auth) return { ok: false, error: "This order can't be declined right now." };

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
  after(async () => {
    await notifyCustomerWhatsApp(
      admin,
      auth.customerId,
      `No problem — I won't process that PO (${auth.referenceNumber}). Send me another anytime.`
    );
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
  const auth = await authorize(token, shipmentId, "awaiting_customer_approval");
  if (!auth) return { ok: false, error: "These documents can't be approved right now." };

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

  // Mirror the WhatsApp approve reply, then hand off to the CHA in the background
  // (only if the operator enabled auto-send).
  after(async () => {
    await notifyCustomerWhatsApp(
      admin,
      auth.customerId,
      `✅ Thank you! Your documents for ${auth.referenceNumber} are approved and locked. We'll send them to your customs broker and proceed with your shipment.`
    );
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

// G8 — close the shipment. The exporter closes once it's filed and complete; the
// shipment reaches its terminal state. (The full G8 in the Bible also reconciles
// proceeds + eBRC — that's Treasury, a P2 agent — so this is the close itself.)
const CLOSEABLE = ["filed_with_cha", "customs_cleared", "in_transit", "delivered"];

// --- Freight G4 gate (exporter) -------------------------------------------
// The exporter accepts / negotiates / rejects a carrier quote. Authorize:
// token -> customer, the shipment is theirs, the quote is on that shipment. No
// lifecycle-status gate (freight isn't in the state machine). Each write is
// guarded with `.or("decision.is.null,decision.eq.negotiate")` so an already
// awarded/rejected quote can't be re-decided, and audited via:'portal'.
async function authorizeFreightQuote(
  token: string,
  shipmentId: string,
  quoteId: string
): Promise<{ customerId: string; rateAmount: number | null } | null> {
  const customer = await resolveCustomerByPortalToken(token);
  if (!customer) return null;
  const admin = createSupabaseServerClient();
  const { data: ship } = await admin
    .from("shipments")
    .select("id")
    .eq("id", shipmentId)
    .eq("customer_id", customer.id)
    .maybeSingle();
  if (!ship) return null;
  const { data: quote } = await admin
    .from("freight_quotes")
    .select("id, rate_amount")
    .eq("id", quoteId)
    .eq("shipment_id", shipmentId)
    .maybeSingle();
  if (!quote) return null;
  return { customerId: customer.id, rateAmount: quote.rate_amount == null ? null : Number(quote.rate_amount) };
}

async function shipmentHasAward(
  admin: ReturnType<typeof createSupabaseServerClient>,
  shipmentId: string
): Promise<boolean> {
  const { data } = await admin
    .from("freight_quotes")
    .select("id")
    .eq("shipment_id", shipmentId)
    .eq("decision", "awarded")
    .limit(1)
    .maybeSingle();
  return !!data;
}

export async function portalAwardFreight(token: string, shipmentId: string, quoteId: string): Promise<Result> {
  if (portalWriteRateLimited(`act:${token}`)) return { ok: false, error: "Please wait a moment and try again." };
  const auth = await authorizeFreightQuote(token, shipmentId, quoteId);
  if (!auth) return { ok: false, error: "This quote can't be awarded right now." };

  const admin = createSupabaseServerClient();
  // Fast-path friendly message; the freight_quotes_one_award unique index is the
  // real, race-proof guarantee (a concurrent second award fails on insert below).
  if (await shipmentHasAward(admin, shipmentId)) {
    return { ok: false, error: "A carrier is already awarded for this shipment." };
  }
  const { data: claimed, error: updErr } = await admin
    .from("freight_quotes")
    .update({ decision: "awarded", decided_at: new Date().toISOString() })
    .eq("id", quoteId)
    .eq("shipment_id", shipmentId)
    .or("decision.is.null,decision.eq.negotiate")
    .select("id");
  if (updErr) {
    // Unique-index violation = a concurrent award already won this shipment.
    return { ok: false, error: "A carrier is already awarded for this shipment." };
  }
  if (!claimed || claimed.length === 0) return { ok: false, error: "This quote can't be awarded right now." };

  await admin.from("audit_operator_action").insert({
    operator_id: null,
    shipment_id: shipmentId,
    action_type: "approve",
    old_value: null,
    new_value: { event: "freight_awarded", quote_id: quoteId, decided_by: "customer", via: "portal" },
  });
  revalidatePath(`/portal/${token}/${shipmentId}`);
  return { ok: true };
}

export async function portalRejectFreightQuote(token: string, shipmentId: string, quoteId: string): Promise<Result> {
  if (portalWriteRateLimited(`act:${token}`)) return { ok: false, error: "Please wait a moment and try again." };
  const auth = await authorizeFreightQuote(token, shipmentId, quoteId);
  if (!auth) return { ok: false, error: "This quote can't be rejected right now." };

  const admin = createSupabaseServerClient();
  // Gate is closed once a carrier is awarded.
  if (await shipmentHasAward(admin, shipmentId)) {
    return { ok: false, error: "A carrier is already awarded for this shipment." };
  }
  const { data: claimed } = await admin
    .from("freight_quotes")
    .update({ decision: "rejected", decided_at: new Date().toISOString() })
    .eq("id", quoteId)
    .eq("shipment_id", shipmentId)
    .or("decision.is.null,decision.eq.negotiate")
    .select("id");
  if (!claimed || claimed.length === 0) return { ok: false, error: "This quote can't be rejected right now." };

  await admin.from("audit_operator_action").insert({
    operator_id: null,
    shipment_id: shipmentId,
    action_type: "note",
    old_value: null,
    new_value: { event: "freight_quote_rejected", quote_id: quoteId, decided_by: "customer", via: "portal" },
  });
  revalidatePath(`/portal/${token}/${shipmentId}`);
  return { ok: true };
}

export async function portalNegotiateFreight(token: string, shipmentId: string, quoteId: string): Promise<Result> {
  if (portalWriteRateLimited(`act:${token}`)) return { ok: false, error: "Please wait a moment and try again." };
  const auth = await authorizeFreightQuote(token, shipmentId, quoteId);
  if (!auth) return { ok: false, error: "This quote can't be negotiated right now." };

  const admin = createSupabaseServerClient();
  // Gate is closed once a carrier is awarded.
  if (await shipmentHasAward(admin, shipmentId)) {
    return { ok: false, error: "A carrier is already awarded for this shipment." };
  }
  const target = negotiateTargetFor(auth.rateAmount);
  const { data: claimed } = await admin
    .from("freight_quotes")
    .update({ decision: "negotiate", negotiate_target: target, decided_at: new Date().toISOString() })
    .eq("id", quoteId)
    .eq("shipment_id", shipmentId)
    .or("decision.is.null,decision.eq.negotiate")
    .select("id");
  if (!claimed || claimed.length === 0) return { ok: false, error: "This quote can't be negotiated right now." };

  await admin.from("audit_operator_action").insert({
    operator_id: null,
    shipment_id: shipmentId,
    action_type: "note",
    old_value: null,
    new_value: { event: "freight_negotiate", quote_id: quoteId, target, decided_by: "customer", via: "portal" },
  });
  revalidatePath(`/portal/${token}/${shipmentId}`);
  return { ok: true };
}

export async function portalCloseShipment(token: string, shipmentId: string): Promise<Result> {
  if (portalWriteRateLimited(`act:${token}`)) return { ok: false, error: "Please wait a moment and try again." };
  const customer = await resolveCustomerByPortalToken(token);
  if (!customer) return { ok: false, error: "This shipment can't be closed right now." };

  const admin = createSupabaseServerClient();
  // Auth + atomic claim in one: only this customer's shipment, only from a
  // closeable state, moved to 'completed' exactly once.
  const { data: claimed } = await admin
    .from("shipments")
    .update({ status: "completed" })
    .eq("id", shipmentId)
    .eq("customer_id", customer.id)
    .in("status", CLOSEABLE)
    .select("id");
  if (!claimed || claimed.length === 0) {
    return { ok: false, error: "This shipment can't be closed right now." };
  }

  await admin.from("audit_operator_action").insert({
    operator_id: null,
    shipment_id: shipmentId,
    action_type: "status_change",
    old_value: null,
    new_value: { status: "completed", closed_by: "customer", via: "portal" },
  });

  revalidatePath(`/portal/${token}/${shipmentId}`);
  return { ok: true };
}
