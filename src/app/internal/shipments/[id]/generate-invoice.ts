"use server";

import { createHash } from "crypto";
import { revalidatePath } from "next/cache";
import { getOperatorSession } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildCommercialInvoicePdf } from "@/lib/pdf/commercial-invoice";

const GENERATOR = "pdf-lib / commercial-invoice@v2";

type Result = { ok: true; downloadUrl: string } | { ok: false; error: string };

export async function generateCommercialInvoice(shipmentId: string): Promise<Result> {
  try {
    return await runGeneration(shipmentId);
  } catch (e) {
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
  const get = (k: string) => (d[k] ?? "").trim();

  const required: [string, string][] = [
    ["buyer_name", "Buyer name"],
    ["product_description", "Product description"],
    ["quantity", "Quantity"],
    ["value_amount", "Invoice value"],
    ["value_currency", "Currency"],
  ];
  const missing = required.filter(([k]) => !get(k)).map(([, label]) => label);
  if (missing.length > 0) {
    return { ok: false, error: `Fill these fields first: ${missing.join(", ")}` };
  }

  // Exporter profile holds the static identity / bank / declarations.
  const { data: profile } = await admin
    .from("exporter_profiles")
    .select("*")
    .eq("is_default", true)
    .maybeSingle();
  const p = (profile ?? {}) as Record<string, string>;

  const pdfBytes = await buildCommercialInvoicePdf({
    invoiceNumber: `CI-${shipment.reference_number}`,
    invoiceDate: new Date().toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }),
    seller: {
      name: (p.legal_name ?? "").trim() || "[Exporter — set in Settings]",
      address: (p.address ?? "").trim(),
      factoryAddress: (p.factory_address ?? "").trim() || undefined,
      iec: (p.iec ?? "").trim() || undefined,
      gstin: (p.gstin ?? "").trim() || undefined,
      cin: (p.cin ?? "").trim() || undefined,
      organicCode: (p.organic_code ?? "").trim() || undefined,
    },
    buyer: { name: get("buyer_name"), address: get("buyer_address") },
    destinationCountry: get("destination_country"),
    incoterm: get("incoterm") || (p.default_incoterm ?? "").trim(),
    currency: get("value_currency") || (p.default_currency ?? "").trim(),
    portOfLoading: get("port_of_loading") || undefined,
    portOfDischarge: get("port_of_discharge") || undefined,
    vessel: get("vessel_name") || undefined,
    containerNo: get("container_no") || undefined,
    sealNo: get("seal_no") || undefined,
    hsCode: get("hs_code"),
    productDescription: get("product_description"),
    quantity: get("quantity"),
    unit: get("quantity_unit"),
    totalAmount: get("value_amount"),
    batchCode: get("batch_code") || undefined,
    lotCode: get("lot_code") || undefined,
    netWeight: get("net_weight") ? `${get("net_weight")} ${get("weight_unit")}`.trim() : undefined,
    grossWeight: get("gross_weight") ? `${get("gross_weight")} ${get("weight_unit")}`.trim() : undefined,
    numberOfPackages: get("number_of_packages") || undefined,
    bank: {
      name: (p.bank_name ?? "").trim() || undefined,
      branch: (p.bank_branch ?? "").trim() || undefined,
      swift: (p.bank_swift ?? "").trim() || undefined,
      account: (p.bank_account ?? "").trim() || undefined,
      beneficiary: (p.bank_beneficiary ?? "").trim() || undefined,
    },
    declarations: {
      lut: (p.declaration_lut ?? "").trim() || undefined,
      rodtep: (p.declaration_rodtep ?? "").trim() || undefined,
      origin: (p.declaration_origin ?? "").trim() || undefined,
    },
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
    await admin.storage.from("generated-docs").remove([storagePath]);
    return { ok: false, error: `Record failed: ${insErr.message}` };
  }

  const { data: signed } = await admin.storage
    .from("generated-docs")
    .createSignedUrl(storagePath, 60 * 10);

  revalidatePath(`/internal/shipments/${shipmentId}`);
  return { ok: true, downloadUrl: signed?.signedUrl ?? "" };
}
