import { createSupabaseServerClient } from "@/lib/supabase/server";
import { notifyCustomerWhatsApp } from "@/lib/whatsapp/notify";
import type { PoFields, PoConfidence } from "@/lib/ai/extract-po";
import {
  generateCommercialInvoiceCore,
  generatePackingListCore,
} from "@/lib/docs/generate";
import { missingRequiredFields, missingPackingFields, OPTIONAL_PACKING_LABELS } from "@/lib/docs/required-fields";
import { missingFieldLines } from "@/lib/docs/gap-message";
import { sendDocsToCustomerCore } from "@/lib/docs/send-to-customer";
import { validateExtracted, lowConfidenceFields } from "@/lib/docs/validate";
import { screenShipmentParties, partiesFromExtracted } from "@/lib/screening/screen-shipment";

// A one-line, human-readable summary of the drafted order for the confirm ask.
// Only safe-to-show business fields; empty string if nothing extracted.
function orderSummary(d: Record<string, string>): string {
  const parts: string[] = [];
  if (d.buyer_name) parts.push(`from ${d.buyer_name}`);
  if (d.product_description) parts.push(d.product_description);
  const qty = [d.quantity, d.quantity_unit].filter(Boolean).join(" ");
  if (qty) parts.push(qty);
  const val = [d.value_currency, d.value_amount].filter(Boolean).join(" ");
  if (val) parts.push(val);
  if (d.incoterm) parts.push(d.incoterm);
  return parts.join(", ");
}

// Rebuild the {fields, confidence} an extract closure would return, from the
// data already stored on the shipment — used to RESUME the pipeline after the
// exporter confirms an emailed order (no second paid extraction).
export async function loadStoredExtraction(
  shipmentId: string
): Promise<{ fields: PoFields; confidence: PoConfidence }> {
  const admin = createSupabaseServerClient();
  const { data } = await admin
    .from("shipments")
    .select("extracted_data")
    .eq("id", shipmentId)
    .maybeSingle();
  const stored = (data?.extracted_data ?? {}) as Record<string, string>;
  let confidence = {} as PoConfidence;
  try {
    confidence = JSON.parse(stored["_confidence"] ?? "{}");
  } catch {
    confidence = {} as PoConfidence;
  }
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(stored)) {
    if (k !== "_confidence") fields[k] = v;
  }
  return { fields: fields as PoFields, confidence };
}

// The automation: runs in the background after a PO lands on WhatsApp.
//   extract fields -> save -> generate documents -> set status for review.
// Statuses: po_received -> data_extracting -> generating_documents ->
//   bucket_b_review (docs ready) or awaiting_customer_info (fields missing).
// confirmFirst (email intake): after extraction, park at awaiting_order_confirm
//   and ask the exporter to confirm before generating anything — see migration 019.
// Every system action is written to audit_operator_action with
// operator_id = NULL (meaning: the system acted).
// Never throws — failures log (no PII) and the shipment returns to
// po_received so the operator handles it manually.

export async function runAutoPipeline(args: {
  shipmentId: string;
  extract: () => Promise<{ fields: PoFields; confidence: PoConfidence }>;
  confirmFirst?: boolean;
}): Promise<void> {
  const admin = createSupabaseServerClient();

  const audit = async (
    actionType: "extract" | "status_change",
    oldValue: unknown,
    newValue: unknown
  ) => {
    await admin.from("audit_operator_action").insert({
      operator_id: null, // system
      shipment_id: args.shipmentId,
      action_type: actionType,
      old_value: oldValue,
      new_value: newValue,
    });
  };

  let lastStatus = "po_received";
  const setStatus = async (status: string) => {
    await admin.from("shipments").update({ status }).eq("id", args.shipmentId);
    await audit("status_change", { status: lastStatus }, { status });
    lastStatus = status;
  };

  try {
    await setStatus("data_extracting");

    const { fields, confidence } = await args.extract();

    // Merge non-empty extracted values over whatever already exists.
    const { data: ship } = await admin
      .from("shipments")
      .select("extracted_data")
      .eq("id", args.shipmentId)
      .maybeSingle();
    const current = (ship?.extracted_data ?? {}) as Record<string, string>;
    const merged = { ...current };
    for (const [k, v] of Object.entries(fields)) {
      if (v) merged[k] = v;
    }
    // Persist the per-field confidence under a reserved key so the gap-fill
    // path can re-check it later. Forms and doc generators read named fields
    // only, so this never leaks into a document.
    merged["_confidence"] = JSON.stringify(confidence);
    await admin
      .from("shipments")
      .update({ extracted_data: merged })
      .eq("id", args.shipmentId);
    await audit("extract", current, merged);

    // Order-confirm gate (email intake only): the PO was passively forwarded,
    // so the exporter must confirm the drafted order before we generate
    // anything (blueprint intake-agent human_gate = order.confirm). Park and
    // ask on WhatsApp; the reply is handled by the webhook's order-confirm
    // branch, which resumes this pipeline (confirmFirst off) on CONFIRM.
    if (args.confirmFirst) {
      const { data: shipRow } = await admin
        .from("shipments")
        .select("customer_id, reference_number")
        .eq("id", args.shipmentId)
        .maybeSingle();
      await setStatus("awaiting_order_confirm");
      let notified = false;
      if (shipRow) {
        const summary = orderSummary(merged);
        notified = await notifyCustomerWhatsApp(
          admin,
          shipRow.customer_id as string,
          `📋 I read a new purchase order (ref ${shipRow.reference_number})` +
            (summary ? `:\n${summary}` : ".") +
            `\n\nReply CONFIRM to generate your export documents, or NO if this isn't one to process.`
        );
      }
      if (!notified) {
        // Parked but the exporter was never reached (no WhatsApp number, a send
        // failure, or a missing row). Surface it so the order isn't invisible
        // work that can never be confirmed — the operator must follow up.
        await admin.from("audit_operator_action").insert({
          operator_id: null,
          shipment_id: args.shipmentId,
          action_type: "note",
          old_value: null,
          new_value: { event: "order_confirm_notify_failed" },
        });
      }
      console.log("auto_pipeline_awaiting_confirm", { shipmentId: args.shipmentId, notified });
      return;
    }

    // Gap-fill: if required fields are missing, ask the customer on WhatsApp
    // instead of generating incomplete documents. Their reply is handled by
    // the webhook (awaiting_customer_info branch).
    const missing = missingRequiredFields(merged);
    if (missing.length > 0) {
      const { data: shipRow } = await admin
        .from("shipments")
        .select("customer_id, reference_number")
        .eq("id", args.shipmentId)
        .maybeSingle();
      await setStatus("awaiting_customer_info");
      if (shipRow) {
        const notified = await notifyCustomerWhatsApp(
          admin,
          shipRow.customer_id as string,
          `I've read your PO (ref ${shipRow.reference_number}). To finish your documents I still need:\n` +
            missingFieldLines(missing, merged).join("\n") +
            `\nJust reply with the details here.`
        );
        if (!notified) {
          // Surface the failed ask on the shipment's audit trail so the
          // operator knows the customer was never contacted.
          await admin.from("audit_operator_action").insert({
            operator_id: null,
            shipment_id: args.shipmentId,
            action_type: "note",
            old_value: null,
            new_value: { event: "customer_notify_failed", missing_count: missing.length },
          });
        }
      }
      console.log("auto_pipeline_gap_fill", {
        shipmentId: args.shipmentId,
        missingCount: missing.length,
      });
      return;
    }

    // Trust gate: deterministic rules + extraction confidence. Anything the
    // rules reject or the model wasn't sure about goes to the operator —
    // the agent may not act on data it can't vouch for.
    const issues = validateExtracted(merged);
    const shaky = lowConfidenceFields(merged, confidence);

    // Packing details are optional and vary by PO format, so a shaky packing
    // value must NOT halt the shipment (the same rule the gap-fill and the doc
    // generators already follow). Drop any low-confidence packing value — we
    // won't put a weight we don't trust on a customs document — and let the
    // optional packing-ask below invite the exporter to add it. Only shaky
    // required / critical fields (parties, money, customs) still pause for the
    // operator review desk.
    const optionalPackingKeys = new Set(Object.keys(OPTIONAL_PACKING_LABELS));
    const shakyPacking = shaky.filter((f) => optionalPackingKeys.has(f));
    const shakyBlocking = shaky.filter((f) => !optionalPackingKeys.has(f));
    if (shakyPacking.length > 0) {
      for (const f of shakyPacking) delete merged[f];
      await admin
        .from("shipments")
        .update({ extracted_data: merged })
        .eq("id", args.shipmentId);
      await admin.from("audit_operator_action").insert({
        operator_id: null,
        shipment_id: args.shipmentId,
        action_type: "note",
        old_value: null,
        new_value: { event: "low_confidence_packing_dropped", fields: shakyPacking },
      });
    }

    if (issues.length > 0 || shakyBlocking.length > 0) {
      await setStatus("bucket_b_review");
      await admin.from("audit_operator_action").insert({
        operator_id: null,
        shipment_id: args.shipmentId,
        action_type: "note",
        old_value: null,
        new_value: {
          event: "trust_gate_flagged",
          validation_issues: issues,
          low_confidence_fields: shakyBlocking,
        },
      });
      console.log("auto_pipeline_trust_gate", {
        shipmentId: args.shipmentId,
        issueCount: issues.length,
        lowConfidenceCount: shakyBlocking.length,
      });
      return;
    }

    // Denied-party screening on the buyer — deterministic list lookup.
    // A potential match (or a screening failure once configured) stops the
    // agent; the operator reviews the matches on the audit trail.
    const screening = await screenShipmentParties(args.shipmentId, partiesFromExtracted(merged));
    if (!screening.proceed) {
      await setStatus("sanctions_screening");
      return;
    }

    await setStatus("generating_documents");

    // Generate what the data supports; generatedBy null = system.
    const invoice = await generateCommercialInvoiceCore(args.shipmentId, null);
    const packing = await generatePackingListCore(args.shipmentId, null);

    // Clean path: documents generated — send them straight to the customer
    // for approval (agentic flow; the customer is the human gate). Anything
    // that didn't generate cleanly goes to the operator's review queue.
    let autoSent = false;
    if (invoice.ok && packing.ok) {
      try {
        const sendResult = await sendDocsToCustomerCore(args.shipmentId, null);
        autoSent = sendResult.ok;
        if (!sendResult.ok) {
          await setStatus("bucket_b_review");
        }
      } catch {
        // A partial/thrown send must reach the operator queue, not fall
        // through to the outer catch's po_received reset.
        await setStatus("bucket_b_review");
      }
    } else {
      await setStatus("bucket_b_review");
    }

    // Optional packing details: if the PO didn't carry weights/package count,
    // the documents still went out — but invite the exporter to add them to
    // complete the packing list. Non-blocking: they can reply with them or just
    // approve. Their reply is handled by the webhook (approval branch).
    if (autoSent) {
      const missingPacking = missingPackingFields(merged);
      if (missingPacking.length > 0) {
        const { data: shipRow } = await admin
          .from("shipments")
          .select("customer_id, reference_number")
          .eq("id", args.shipmentId)
          .maybeSingle();
        if (shipRow) {
          const labels = missingPacking.map((k) => OPTIONAL_PACKING_LABELS[k]).join(", ");
          await notifyCustomerWhatsApp(
            admin,
            shipRow.customer_id as string,
            `📦 Optional — to complete the packing list for ${shipRow.reference_number} I can add: ${labels}. Reply with them anytime, or just reply APPROVE to proceed without them.`
          );
        }
      }
    }

    console.log("auto_pipeline_done", {
      shipmentId: args.shipmentId,
      invoiceOk: invoice.ok,
      packingOk: packing.ok,
      autoSent,
    });
  } catch (e) {
    console.error("auto_pipeline_failed", {
      shipmentId: args.shipmentId,
      name: e instanceof Error ? e.name : "unknown",
      message: e instanceof Error ? e.message : "unknown",
    });
    try {
      await setStatus("po_received");
    } catch {
      // best effort
    }
  }
}
