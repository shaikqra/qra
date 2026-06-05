"use server";

import { createHash } from "crypto";
import { revalidatePath } from "next/cache";
import { getOperatorSession } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildCommercialInvoicePdf } from "@/lib/pdf/commercial-invoice";

const GENERATOR = "pdf-lib / commercial-invoice@v1";

// Fallback exporter for the demo, so the invoice is never blank when the
// seller fields haven't been filled. Real exporter profiles come later.
const DEMO_SELLER = {
  name: "NAVA-MGE Exports",
  address: "Hyderabad, Telangana, India",
  iec: "",
};

type Result = { ok: true; downloadUrl: string } | { ok: false; error: string };

export async function generateCommercialInvoice(shipmentId: string): Promise<Result> {
  try {
    return await runGeneration(shipmentId);
  } catch (e) {
    // Never let a failure white-screen the operator. Log the cause for us
    // (message only — never the customer data) and return a clean message.
    const msg = e instanceof Error ? e.message : String(e);
    console.error("generateCommercialInvoice failed:", msg);
    return { ok: false, error: `Generation failed: ${msg}` };
  }
}

async function runGeneration(shipmentId: string): Promise<Result> {
  const session = await getOperatorSession();
  if (!session) return { ok: false, error: "Not authorized" };

  const admin = createSupabaseServerClient();

  const { data: shipment, error } = await admin
    .from("shipments")
    .select("id, customer_id, reference_number, extracted_data")
    .eq("id", shipmentId)
    .maybeSingle();

  if (error || !shipment) return { ok: false, error: "Shipment not found" };

  const d = (shipment.extracted_data ?? {}) as Record<string, string>;

  // A commercial invoice legally needs at least these. Block generation and
  // tell the operator exactly what's missing, rather than emit a broken doc.
  const required: [string, string][] = [
    ["buyer_name", "Buyer name"],
    ["product_description", "Product description"],
    ["quantity", "Quantity"],
    ["value_amount", "Invoice value"],
    ["value_currency", "Currency"],
  ];
  const missing = required.filter(([k]) => !(d[k] ?? "").trim()).map(([, label]) => label);
  if (missing.length > 0) {
    return { ok: false, error: `Fill these fields first: ${missing.join(", ")}` };
  }

  const pdfBytes = await buildCommercialInvoicePdf({
    invoiceNumber: `CI-${shipment.reference_number}`,
    invoiceDate: new Date().toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }),
    seller: {
      name: (d.seller_name ?? "").trim() || DEMO_SELLER.name,
      address: (d.seller_address ?? "").trim() || DEMO_SELLER.address,
      iec: (d.seller_iec ?? "").trim() || DEMO_SELLER.iec,
    },
    buyer: { name: d.buyer_name.trim(), address: (d.buyer_address ?? "").trim() },
    destinationCountry: (d.destination_country ?? "").trim(),
    incoterm: (d.incoterm ?? "").trim(),
    currency: d.value_currency.trim(),
    hsCode: (d.hs_code ?? "").trim(),
    productDescription: d.product_description.trim(),
    quantity: d.quantity.trim(),
    unit: (d.quantity_unit ?? "").trim(),
    totalAmount: d.value_amount.trim(),
  });

  const buffer = Buffer.from(pdfBytes);
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const storagePath = `${shipment.customer_id}/${shipmentId}/commercial-invoice-${Date.now()}.pdf`;

  const { error: upErr } = await admin.storage
    .from("generated-docs")
    .upload(storagePath, buffer, { contentType: "application/pdf", upsert: false });
  if (upErr) return { ok: false, error: `Upload failed: ${upErr.message}` };

  const { error: insErr } = await admin.from("generated_documents").insert({
    shipment_id: shipmentId,
    customer_id: shipment.customer_id,
    doc_type: "commercial_invoice",
    storage_path: storagePath,
    output_sha256: sha256,
    source_data: d,
    generator: GENERATOR,
    generated_by: session.userId,
  });
  if (insErr) {
    // Keep storage and audit in sync: undo the upload if the audit row failed.
    await admin.storage.from("generated-docs").remove([storagePath]);
    return { ok: false, error: `Record failed: ${insErr.message}` };
  }

  const { data: signed } = await admin.storage
    .from("generated-docs")
    .createSignedUrl(storagePath, 60 * 10);

  revalidatePath(`/internal/shipments/${shipmentId}`);
  return { ok: true, downloadUrl: signed?.signedUrl ?? "" };
}
