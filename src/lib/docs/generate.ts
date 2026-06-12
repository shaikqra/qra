import { createHash } from "crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildCommercialInvoicePdf } from "@/lib/pdf/commercial-invoice";
import { buildPackingListPdf } from "@/lib/pdf/packing-list";
import { buildCertificateOfOriginPdf } from "@/lib/pdf/certificate-of-origin";
import { buildShippingBillPackPdf } from "@/lib/pdf/shipping-bill-pack";

// Shared document-generation engine. Called by the dashboard buttons
// (generatedBy = operator id) and by the WhatsApp auto-pipeline
// (generatedBy = null = system).

export type GenerateResult =
  | { ok: true; storagePath: string; downloadUrl: string }
  | { ok: false; error: string };

const INVOICE_GENERATOR = "pdf-lib / commercial-invoice@v2";
const PACKING_GENERATOR = "pdf-lib / packing-list@v1";
const COO_GENERATOR = "pdf-lib / certificate-of-origin@v1";
const PROFORMA_GENERATOR = "pdf-lib / proforma-invoice@v1";
const SBPACK_GENERATOR = "pdf-lib / shipping-bill-pack@v1";

const DEMO_SELLER = {
  name: "[Exporter — set in Settings]",
  address: "",
  iec: "",
};

async function loadShipmentAndProfile(shipmentId: string) {
  const admin = createSupabaseServerClient();

  const { data: shipment, error } = await admin
    .from("shipments")
    .select("id, customer_id, reference_number, extracted_data")
    .eq("id", shipmentId)
    .maybeSingle();

  if (error || !shipment) return { admin, shipment: null, d: {}, p: {} };

  // Prefer the profile of this shipment's exporter; fall back to the default
  // profile for customers that don't have their own yet.
  let { data: profile } = await admin
    .from("exporter_profiles")
    .select("*")
    .eq("customer_id", shipment.customer_id)
    .maybeSingle();
  if (!profile) {
    const { data: fallback } = await admin
      .from("exporter_profiles")
      .select("*")
      .eq("is_default", true)
      .maybeSingle();
    profile = fallback;
  }

  return {
    admin,
    shipment,
    d: (shipment.extracted_data ?? {}) as Record<string, string>,
    p: (profile ?? {}) as Record<string, string>,
  };
}

async function storeDocument(opts: {
  admin: ReturnType<typeof createSupabaseServerClient>;
  shipmentId: string;
  customerId: string;
  docType:
    | "commercial_invoice"
    | "packing_list"
    | "certificate_of_origin"
    | "proforma_invoice"
    | "shipping_bill_pack";
  fileSlug: string;
  generator: string;
  pdfBytes: Uint8Array;
  sourceData: Record<string, string>;
  generatedBy: string | null;
}): Promise<GenerateResult> {
  const { admin } = opts;
  const buffer = Buffer.from(opts.pdfBytes);
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const storagePath = `${opts.customerId}/${opts.shipmentId}/${opts.fileSlug}-${Date.now()}.pdf`;

  const { error: upErr } = await admin.storage
    .from("generated-docs")
    .upload(storagePath, buffer, { contentType: "application/pdf", upsert: false });
  if (upErr) return { ok: false, error: `Upload failed: ${upErr.message}` };

  const { error: insErr } = await admin.from("generated_documents").insert({
    shipment_id: opts.shipmentId,
    customer_id: opts.customerId,
    doc_type: opts.docType,
    storage_path: storagePath,
    output_sha256: sha256,
    source_data: opts.sourceData,
    generator: opts.generator,
    generated_by: opts.generatedBy,
  });
  if (insErr) {
    await admin.storage.from("generated-docs").remove([storagePath]);
    return { ok: false, error: `Record failed: ${insErr.message}` };
  }

  const { data: signed } = await admin.storage
    .from("generated-docs")
    .createSignedUrl(storagePath, 60 * 10);

  return { ok: true, storagePath, downloadUrl: signed?.signedUrl ?? "" };
}

// Commercial invoice and proforma invoice share one data mapping — the
// proforma differs only in title, note, number prefix and stored doc type.
async function generateInvoiceVariantCore(
  shipmentId: string,
  generatedBy: string | null,
  variant: "commercial" | "proforma"
): Promise<GenerateResult> {
  const { admin, shipment, d, p } = await loadShipmentAndProfile(shipmentId);
  if (!shipment) return { ok: false, error: "Shipment not found" };

  const get = (k: string) => (d[k] ?? "").trim();
  const prof = (k: string) => (p[k] ?? "").trim();

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

  const isProforma = variant === "proforma";
  const pdfBytes = await buildCommercialInvoicePdf({
    title: isProforma ? "PROFORMA INVOICE" : undefined,
    titleNote: isProforma
      ? "For quotation / advance payment — not a tax invoice."
      : undefined,
    invoiceNumber: `${isProforma ? "PI" : "CI"}-${shipment.reference_number}`,
    invoiceDate: new Date().toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }),
    seller: {
      name: prof("legal_name") || DEMO_SELLER.name,
      address: prof("address"),
      factoryAddress: prof("factory_address") || undefined,
      iec: prof("iec") || undefined,
      gstin: prof("gstin") || undefined,
      cin: prof("cin") || undefined,
      organicCode: prof("organic_code") || undefined,
    },
    buyer: { name: get("buyer_name"), address: get("buyer_address") },
    destinationCountry: get("destination_country"),
    incoterm: (get("incoterm") || prof("default_incoterm")).toUpperCase(),
    currency: (get("value_currency") || prof("default_currency")).toUpperCase(),
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
      name: prof("bank_name") || undefined,
      branch: prof("bank_branch") || undefined,
      swift: prof("bank_swift") || undefined,
      account: prof("bank_account") || undefined,
      beneficiary: prof("bank_beneficiary") || undefined,
    },
    declarations: {
      lut: prof("declaration_lut") || undefined,
      rodtep: prof("declaration_rodtep") || undefined,
      origin: prof("declaration_origin") || undefined,
    },
  });

  return storeDocument({
    admin,
    shipmentId,
    customerId: shipment.customer_id as string,
    docType: isProforma ? "proforma_invoice" : "commercial_invoice",
    fileSlug: isProforma ? "proforma-invoice" : "commercial-invoice",
    generator: isProforma ? PROFORMA_GENERATOR : INVOICE_GENERATOR,
    pdfBytes,
    sourceData: d,
    generatedBy,
  });
}

export async function generateCommercialInvoiceCore(
  shipmentId: string,
  generatedBy: string | null
): Promise<GenerateResult> {
  return generateInvoiceVariantCore(shipmentId, generatedBy, "commercial");
}

export async function generateProformaInvoiceCore(
  shipmentId: string,
  generatedBy: string | null
): Promise<GenerateResult> {
  return generateInvoiceVariantCore(shipmentId, generatedBy, "proforma");
}

export async function generatePackingListCore(
  shipmentId: string,
  generatedBy: string | null
): Promise<GenerateResult> {
  const { admin, shipment, d, p } = await loadShipmentAndProfile(shipmentId);
  if (!shipment) return { ok: false, error: "Shipment not found" };

  const get = (k: string) => (d[k] ?? "").trim();
  const prof = (k: string) => (p[k] ?? "").trim();

  const required: [string, string][] = [
    ["buyer_name", "Buyer name"],
    ["product_description", "Product description"],
    ["number_of_packages", "No. of packages"],
    ["package_type", "Package type"],
    ["net_weight", "Net weight"],
    ["gross_weight", "Gross weight"],
  ];
  const missing = required.filter(([k]) => !get(k)).map(([, label]) => label);
  if (missing.length > 0) {
    return { ok: false, error: `Fill these fields first: ${missing.join(", ")}` };
  }

  const pdfBytes = await buildPackingListPdf({
    reference: shipment.reference_number as string,
    date: new Date().toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }),
    seller: {
      name: prof("legal_name") || DEMO_SELLER.name,
      address: prof("address"),
      iec: prof("iec"),
    },
    buyer: { name: get("buyer_name"), address: get("buyer_address") },
    destinationCountry: get("destination_country"),
    hsCode: get("hs_code"),
    productDescription: get("product_description"),
    quantity: get("quantity"),
    quantityUnit: get("quantity_unit"),
    numberOfPackages: get("number_of_packages"),
    packageType: get("package_type"),
    netWeight: get("net_weight"),
    grossWeight: get("gross_weight"),
    weightUnit: get("weight_unit"),
  });

  return storeDocument({
    admin,
    shipmentId,
    customerId: shipment.customer_id as string,
    docType: "packing_list",
    fileSlug: "packing-list",
    generator: PACKING_GENERATOR,
    pdfBytes,
    sourceData: d,
    generatedBy,
  });
}

export async function generateCertificateOfOriginCore(
  shipmentId: string,
  generatedBy: string | null
): Promise<GenerateResult> {
  const { admin, shipment, d, p } = await loadShipmentAndProfile(shipmentId);
  if (!shipment) return { ok: false, error: "Shipment not found" };

  const get = (k: string) => (d[k] ?? "").trim();
  const prof = (k: string) => (p[k] ?? "").trim();

  const required: [string, string][] = [
    ["buyer_name", "Buyer name"],
    ["product_description", "Product description"],
    ["destination_country", "Destination country"],
    ["hs_code", "HS code"],
    ["quantity", "Quantity"],
    ["number_of_packages", "No. of packages"],
  ];
  const missing = required.filter(([k]) => !get(k)).map(([, label]) => label);
  if (missing.length > 0) {
    return { ok: false, error: `Fill these fields first: ${missing.join(", ")}` };
  }

  const pdfBytes = await buildCertificateOfOriginPdf({
    reference: shipment.reference_number as string,
    date: new Date().toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }),
    seller: {
      name: prof("legal_name") || DEMO_SELLER.name,
      address: prof("address"),
      iec: prof("iec"),
    },
    buyer: { name: get("buyer_name"), address: get("buyer_address") },
    countryOfOrigin: "India",
    destinationCountry: get("destination_country"),
    portOfLoading: get("port_of_loading") || undefined,
    portOfDischarge: get("port_of_discharge") || undefined,
    vessel: get("vessel_name") || undefined,
    hsCode: get("hs_code"),
    productDescription: get("product_description"),
    quantity: get("quantity"),
    quantityUnit: get("quantity_unit"),
    numberOfPackages: get("number_of_packages"),
    packageType: get("package_type"),
    grossWeight: get("gross_weight") || undefined,
    weightUnit: get("weight_unit") || undefined,
    invoiceRef: `CI-${shipment.reference_number}`,
  });

  return storeDocument({
    admin,
    shipmentId,
    customerId: shipment.customer_id as string,
    docType: "certificate_of_origin",
    fileSlug: "certificate-of-origin",
    generator: COO_GENERATOR,
    pdfBytes,
    sourceData: d,
    generatedBy,
  });
}

export async function generateShippingBillPackCore(
  shipmentId: string,
  generatedBy: string | null
): Promise<GenerateResult> {
  const { admin, shipment, d, p } = await loadShipmentAndProfile(shipmentId);
  if (!shipment) return { ok: false, error: "Shipment not found" };

  const get = (k: string) => (d[k] ?? "").trim();
  const prof = (k: string) => (p[k] ?? "").trim();

  // The CHA needs the full picture — require the invoice-level fields.
  const required: [string, string][] = [
    ["buyer_name", "Buyer name"],
    ["product_description", "Product description"],
    ["hs_code", "HS code"],
    ["quantity", "Quantity"],
    ["value_amount", "Invoice value"],
    ["value_currency", "Currency"],
    ["destination_country", "Destination country"],
  ];
  const missing = required.filter(([k]) => !get(k)).map(([, label]) => label);
  if (missing.length > 0) {
    return { ok: false, error: `Fill these fields first: ${missing.join(", ")}` };
  }

  const pdfBytes = await buildShippingBillPackPdf({
    reference: shipment.reference_number as string,
    date: new Date().toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }),
    invoiceRef: `CI-${shipment.reference_number}`,
    exporter: {
      name: prof("legal_name") || DEMO_SELLER.name,
      address: prof("address"),
      iec: prof("iec"),
      gstin: prof("gstin"),
    },
    buyer: { name: get("buyer_name"), address: get("buyer_address") },
    consignee: get("consignee_name") || undefined,
    notifyParty: get("notify_party_name") || undefined,
    destinationCountry: get("destination_country"),
    portOfLoading: get("port_of_loading") || undefined,
    portOfDischarge: get("port_of_discharge") || undefined,
    incoterm: (get("incoterm") || prof("default_incoterm")).toUpperCase(),
    hsCode: get("hs_code"),
    productDescription: get("product_description"),
    quantity: get("quantity"),
    quantityUnit: get("quantity_unit"),
    numberOfPackages: get("number_of_packages"),
    packageType: get("package_type"),
    netWeight: get("net_weight"),
    grossWeight: get("gross_weight"),
    weightUnit: get("weight_unit"),
    invoiceValue: get("value_amount"),
    currency: (get("value_currency") || prof("default_currency")).toUpperCase(),
    rodtepIntent: !!prof("declaration_rodtep"),
  });

  return storeDocument({
    admin,
    shipmentId,
    customerId: shipment.customer_id as string,
    docType: "shipping_bill_pack",
    fileSlug: "shipping-bill-pack",
    generator: SBPACK_GENERATOR,
    pdfBytes,
    sourceData: d,
    generatedBy,
  });
}
