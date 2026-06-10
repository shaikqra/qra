import twilio from "twilio";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { extractPoFields, type SupportedMediaType } from "@/lib/ai/extract-po";
import {
  generateCommercialInvoiceCore,
  generatePackingListCore,
} from "@/lib/docs/generate";
import { missingRequiredFields, labelsFor } from "@/lib/docs/required-fields";

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

    const fields = await extractPoFields(args.fileBase64, args.mediaType);

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

    await setStatus("generating_documents");

    // Generate what the data supports; generatedBy null = system.
    const invoice = await generateCommercialInvoiceCore(args.shipmentId, null);
    const packing = await generatePackingListCore(args.shipmentId, null);

    console.log("auto_pipeline_done", {
      shipmentId: args.shipmentId,
      invoiceOk: invoice.ok,
      packingOk: packing.ok,
    });

    await setStatus(invoice.ok ? "bucket_b_review" : "awaiting_customer_info");
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
