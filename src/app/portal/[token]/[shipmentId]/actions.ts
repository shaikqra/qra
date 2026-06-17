"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveCustomerByPortalToken, portalWriteRateLimited } from "@/lib/portal/auth";
import { runAutoPipeline, loadStoredExtraction } from "@/lib/docs/auto-pipeline";
import { autoSendChaIfEnabled } from "@/lib/docs/send-to-cha-core";
import { generateProformaInvoiceCore, generateCertificateOfOriginCore } from "@/lib/docs/generate";
import { validateExtracted } from "@/lib/docs/validate";
import { readDraftedFields, readNeededFields, readStoredConfidence } from "@/lib/docs/verify-gate";
import { notifyCustomerWhatsApp } from "@/lib/whatsapp/notify";
import { negotiateTargetFor } from "@/lib/freight/rank-quotes";

type Result = { ok: true } | { ok: false; error: string };

// The fields the verify gate can flag — the only ones a console correction may
// touch (a reply can't rewrite an arbitrary field). Mirrors FIELD_LABELS.
const ALLOWED_VERIFY_FIELDS = new Set([
  "buyer_name", "product_description", "quantity", "value_amount", "value_currency",
  "incoterm", "hs_code", "number_of_packages", "package_type", "net_weight", "gross_weight",
]);

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
export async function portalVerifyOrder(
  token: string,
  shipmentId: string,
  corrections?: Record<string, string>
): Promise<Result> {
  if (portalWriteRateLimited(`act:${token}`)) return { ok: false, error: "Please wait a moment and try again." };
  const auth = await authorize(token, shipmentId, "awaiting_customer_verify");
  if (!auth) return { ok: false, error: "This order can't be confirmed right now." };

  const admin = createSupabaseServerClient();

  // Corrections typed in the console pop-up: apply only to fields the verify gate
  // can flag, re-validate the format of each, and — since the exporter supplied
  // them — drop the Qra-draft marker and lift their confidence before resuming.
  if (corrections && Object.keys(corrections).length > 0) {
    const { data: ship } = await admin
      .from("shipments")
      .select("extracted_data")
      .eq("id", shipmentId)
      .maybeSingle();
    const original = (ship?.extracted_data ?? {}) as Record<string, string>;
    const merged = { ...original };
    const changed: string[] = [];
    for (const [k, raw] of Object.entries(corrections)) {
      // Allow-list + string guard: corrections is client JSON, so reject any
      // unknown/reserved key and any non-string value before touching the data.
      if (!ALLOWED_VERIFY_FIELDS.has(k) || typeof raw !== "string") continue;
      const v = raw.trim();
      if (v && v !== (original[k] ?? "").trim()) {
        merged[k] = v;
        changed.push(k);
      }
    }
    if (changed.length > 0) {
      // Reject any issue the correction INTRODUCED — matched by field+reason so a
      // cross-field break (e.g. gross < net, which attaches to a field they didn't
      // edit) can't slip past a "only validate the changed field" filter.
      const sig = (i: { field: string; reason: string }) => `${i.field}:${i.reason}`;
      const before = new Set(validateExtracted(original).map(sig));
      const introduced = validateExtracted(merged).filter((i) => !before.has(sig(i)));
      if (introduced.length > 0) return { ok: false, error: introduced.map((i) => i.reason).join("; ") };
      merged["_drafted"] = JSON.stringify(readDraftedFields(merged).filter((f) => !changed.includes(f)));
      merged["_needed"] = JSON.stringify(readNeededFields(merged).filter((f) => !changed.includes(f)));
      const conf = readStoredConfidence(merged);
      for (const k of changed) conf[k] = 0.99;
      merged["_confidence"] = JSON.stringify(conf);
      await admin.from("shipments").update({ extracted_data: merged }).eq("id", shipmentId);
      await admin.from("audit_operator_action").insert({
        operator_id: null,
        shipment_id: shipmentId,
        action_type: "extract",
        old_value: null,
        new_value: { event: "fields_corrected", via: "portal", fields: changed },
      });
    }
  }

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
  // Approval moves to the G3 goods-ready gate (not straight to the CHA): docs are
  // approved + locked, but the pack only goes to the broker once the exporter
  // confirms the goods are ready to ship.
  const { data: claimed } = await admin
    .from("shipments")
    .update({ status: "awaiting_goods_ready" })
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
      status_changed_to: "awaiting_goods_ready",
    },
  });

  // Approved + locked — now ask the G3 goods-ready question on WhatsApp too.
  after(async () => {
    await notifyCustomerWhatsApp(
      admin,
      auth.customerId,
      `✅ Your documents for ${auth.referenceNumber} are approved and locked. One last step: when your goods are ready to ship, confirm it in your portal (or reply READY here) and we'll hand everything to your customs broker.`
    );
  });

  revalidatePath(`/portal/${token}/${shipmentId}`);
  return { ok: true };
}

// G3 — goods readiness (exporter-owned). The exporter confirms the goods are ready
// to ship; only then is the approved pack handed to the CHA for filing. Claims
// awaiting_goods_ready -> customer_approved (idempotent), then auto-hands-off to the
// broker if the operator enabled it. Mirrors the WhatsApp READY path.
export async function portalConfirmGoodsReady(token: string, shipmentId: string): Promise<Result> {
  if (portalWriteRateLimited(`act:${token}`)) return { ok: false, error: "Please wait a moment and try again." };
  const auth = await authorize(token, shipmentId, "awaiting_goods_ready");
  if (!auth) return { ok: false, error: "This can't be confirmed right now." };

  const admin = createSupabaseServerClient();
  const { data: claimed } = await admin
    .from("shipments")
    .update({ status: "customer_approved" })
    .eq("id", shipmentId)
    .eq("status", "awaiting_goods_ready")
    .select("id");
  if (!claimed || claimed.length === 0) return { ok: true }; // already moving

  await admin.from("audit_operator_action").insert({
    operator_id: null,
    shipment_id: shipmentId,
    action_type: "note",
    old_value: { status: "awaiting_goods_ready" },
    new_value: { event: "goods_ready_confirmed", confirmed_by: "customer", via: "portal" },
  });

  after(async () => {
    await notifyCustomerWhatsApp(
      admin,
      auth.customerId,
      `🚚 Thanks — goods marked ready for ${auth.referenceNumber}. We're handing your documents to your customs broker now.`
    );
    await autoSendChaIfEnabled(shipmentId, "customer_approved");
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

// Optional documents the exporter can pull on demand from the portal: the
// proforma invoice (a pre-order quote) and the certificate of origin (needed
// only for some destinations). Both are plain template PDFs — no model call —
// drafted from the same order data, and appear in the documents list above once
// generated. generatedBy null = exporter-initiated via the portal. Does not
// touch shipment status, so it's safe at any stage.
export async function portalGenerateDoc(
  token: string,
  shipmentId: string,
  kind: "proforma_invoice" | "certificate_of_origin"
): Promise<Result> {
  if (portalWriteRateLimited(`act:${token}`)) return { ok: false, error: "Please wait a moment and try again." };
  if (kind !== "proforma_invoice" && kind !== "certificate_of_origin") {
    return { ok: false, error: "Unknown document." };
  }
  const customer = await resolveCustomerByPortalToken(token);
  if (!customer) return { ok: false, error: "This link has expired — please reopen it." };

  const admin = createSupabaseServerClient();
  // Scope to THIS customer — never draft against another exporter's shipment.
  const { data: ship } = await admin
    .from("shipments")
    .select("id")
    .eq("id", shipmentId)
    .eq("customer_id", customer.id)
    .maybeSingle();
  if (!ship) return { ok: false, error: "Shipment not found." };

  const result =
    kind === "proforma_invoice"
      ? await generateProformaInvoiceCore(shipmentId, null)
      : await generateCertificateOfOriginCore(shipmentId, null);
  if (!result.ok) {
    // Keep the actionable "fill these fields first" hint; never surface a raw
    // storage/DB message to the exporter.
    const friendly = result.error.startsWith("Fill these fields first")
      ? result.error
      : "Couldn't generate that document — please try again in a moment.";
    return { ok: false, error: friendly };
  }

  revalidatePath(`/portal/${token}/${shipmentId}`);
  return { ok: true };
}
