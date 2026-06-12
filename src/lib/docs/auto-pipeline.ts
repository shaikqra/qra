import twilio from "twilio";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { extractPoFields, type SupportedMediaType } from "@/lib/ai/extract-po";
import {
  generateCommercialInvoiceCore,
  generatePackingListCore,
} from "@/lib/docs/generate";
import { missingRequiredFields, labelsFor } from "@/lib/docs/required-fields";
import { sendDocsToCustomerCore } from "@/lib/docs/send-to-customer";
import { validateExtracted, lowConfidenceFields } from "@/lib/docs/validate";
import { screenShipmentBuyer } from "@/lib/screening/screen-shipment";

// Best-effort WhatsApp text to the shipment's customer. Returns whether the
// message was sent so callers can surface a failed notification.
async function sendWhatsAppText(
  admin: ReturnType<typeof createSupabaseServerClient>,
  customerId: string,
  text: string
): Promise<boolean> {
  try {
    const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
    const token = process.env.TWILIO_AUTH_TOKEN?.trim();
    const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER?.trim();
    if (!sid || !token || !fromNumber) return false;

    const { data: customer } = await admin
      .from("customers")
      .select("whatsapp_number")
      .eq("id", customerId)
      .maybeSingle();
    const to = (customer?.whatsapp_number ?? "").trim();
    if (!to) return false;

    await twilio(sid, token).messages.create({ from: fromNumber, to, body: text });
    return true;
  } catch (err) {
    console.error("gap_fill_notify_failed", {
      name: err instanceof Error ? err.name : "unknown",
    });
    return false;
  }
}

// The automation: runs in the background after a PO lands on WhatsApp.
//   extract fields -> save -> generate documents -> set status for review.
// Statuses: po_received -> data_extracting -> generating_documents ->
//   bucket_b_review (docs ready) or awaiting_customer_info (fields missing).
// Every system action is written to audit_operator_action with
// operator_id = NULL (meaning: the system acted).
// Never throws — failures log (no PII) and the shipment returns to
// po_received so the operator handles it manually.

export async function runAutoPipeline(args: {
  shipmentId: string;
  fileBase64: string;
  mediaType: SupportedMediaType;
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

    const { fields, confidence } = await extractPoFields(args.fileBase64, args.mediaType);

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
        const notified = await sendWhatsAppText(
          admin,
          shipRow.customer_id as string,
          `I've read your PO (ref ${shipRow.reference_number}). To finish your documents I still need:\n` +
            labelsFor(missing).map((l) => `• ${l}`).join("\n") +
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
    if (issues.length > 0 || shaky.length > 0) {
      await setStatus("bucket_b_review");
      await admin.from("audit_operator_action").insert({
        operator_id: null,
        shipment_id: args.shipmentId,
        action_type: "note",
        old_value: null,
        new_value: {
          event: "trust_gate_flagged",
          validation_issues: issues,
          low_confidence_fields: shaky,
        },
      });
      console.log("auto_pipeline_trust_gate", {
        shipmentId: args.shipmentId,
        issueCount: issues.length,
        lowConfidenceCount: shaky.length,
      });
      return;
    }

    // Denied-party screening on the buyer — deterministic list lookup.
    // A potential match (or a screening failure once configured) stops the
    // agent; the operator reviews the matches on the audit trail.
    const screening = await screenShipmentBuyer(args.shipmentId, merged["buyer_name"] ?? "");
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
