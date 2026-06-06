import { createSupabaseServerClient } from "@/lib/supabase/server";
import { extractPoFields, type SupportedMediaType } from "@/lib/ai/extract-po";
import {
  generateCommercialInvoiceCore,
  generatePackingListCore,
} from "@/lib/docs/generate";

// The automation: runs in the background after a PO lands on WhatsApp.
//   extract fields -> save -> generate documents -> set status for review.
// Statuses: po_received -> data_extracting -> generating_documents ->
//   bucket_b_review (docs ready) or awaiting_customer_info (fields missing).
// Never throws — failures log (no PII) and the shipment returns to
// po_received so the operator handles it manually.

export async function runAutoPipeline(args: {
  shipmentId: string;
  fileBase64: string;
  mediaType: SupportedMediaType;
}): Promise<void> {
  const admin = createSupabaseServerClient();
  const setStatus = async (status: string) => {
    await admin.from("shipments").update({ status }).eq("id", args.shipmentId);
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
    const merged = { ...((ship?.extracted_data ?? {}) as Record<string, string>) };
    for (const [k, v] of Object.entries(fields)) {
      if (v) merged[k] = v;
    }
    await admin
      .from("shipments")
      .update({ extracted_data: merged, status: "generating_documents" })
      .eq("id", args.shipmentId);

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
