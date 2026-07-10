import { createHash } from "crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildCommercialInvoicePdf } from "@/lib/pdf/commercial-invoice";
import { buildPackingListPdf } from "@/lib/pdf/packing-list";
import { buildCertificateOfOriginPdf } from "@/lib/pdf/certificate-of-origin";
import { buildShippingBillPackPdf } from "@/lib/pdf/shipping-bill-pack";
import { buildExportDeclarationPdf } from "@/lib/pdf/export-declaration";
import { buildLcCoverPdf } from "@/lib/pdf/lc-cover";
import { DOC_LABELS } from "@/lib/docs/send-to-cha-core";
import { isEuDestination } from "@/lib/docs/destinations";
import { readDraftedFields } from "@/lib/docs/verify-gate";
import { writeAudit } from "@/lib/audit";

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
const EXPORT_DECL_GENERATOR = "pdf-lib / export-declaration@v1";
const LC_COVER_GENERATOR = "pdf-lib / lc-cover-letter@v1";

const DEMO_SELLER = {
  name: "[Exporter — set in Settings]",
  address: "",
  iec: "",
};

// A customer's documents carry THEIR OWN legal identity — their IEC on their own
// shipping bill (the T&C liability model). The minimum legal identity we require
// before stamping any customs document is the legal name + IEC. We never borrow
// another tenant's (or the default) profile, so a customer without these can't have
// identity-bearing documents generated — the pipeline holds them for onboarding.
export function hasOwnLegalIdentity(p: Record<string, string>): boolean {
  return !!(p["legal_name"] ?? "").trim() && !!(p["iec"] ?? "").trim();
}

export const IDENTITY_REQUIRED_ERROR =
  "Your company profile isn't complete yet — add your legal name and IEC in Settings before we can prepare export documents.";

async function loadShipmentAndProfile(shipmentId: string) {
  const admin = createSupabaseServerClient();

  const { data: shipment, error } = await admin
    .from("shipments")
    .select("id, customer_id, reference_number, extracted_data")
    .eq("id", shipmentId)
    .maybeSingle();

  if (error || !shipment) return { admin, shipment: null, d: {}, p: {}, identityOk: false };

  // Identity/tax/bank/declaration fields come ONLY from THIS customer's own
  // profile. We never fall back to another tenant's (or the default) profile —
  // borrowing an IEC breaks the liability model and can get a shipment seized.
  const { data: profile } = await admin
    .from("exporter_profiles")
    .select("*")
    .eq("customer_id", shipment.customer_id)
    .maybeSingle();

  const p = (profile ?? {}) as Record<string, string>;
  return {
    admin,
    shipment,
    d: (shipment.extracted_data ?? {}) as Record<string, string>,
    p,
    identityOk: hasOwnLegalIdentity(p),
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
    | "shipping_bill_pack"
    | "export_declaration"
    | "lc_cover_letter";
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

  // Chain the generation EVENT into the tamper-evident audit trail. The immutable
  // generated_documents row is the artifact; this puts the event (with its content
  // hash) in the hash chain so "every doc is hash-chained" holds. Best-effort —
  // writeAudit never throws and a failed audit must not block the document.
  await writeAudit(admin, {
    operator_id: opts.generatedBy,
    shipment_id: opts.shipmentId,
    action_type: "note",
    old_value: null,
    new_value: { event: "document_generated", doc_type: opts.docType, storage_path: storagePath, sha256 },
  });

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
  const { admin, shipment, d, p, identityOk } = await loadShipmentAndProfile(shipmentId);
  if (!shipment) return { ok: false, error: "Shipment not found" };
  if (!identityOk) return { ok: false, error: IDENTITY_REQUIRED_ERROR };

  const get = (k: string) => (d[k] ?? "").trim();
  const prof = (k: string) => (p[k] ?? "").trim();

  const required: [string, string][] = [
    ["buyer_name", "Buyer name"],
    ["product_description", "Product description"],
    ["quantity", "Quantity"],
    // The unit is required alongside the quantity (kept in sync with
    // REQUIRED_FIELD_LABELS) — a bare number can't print as the UQC.
    ["quantity_unit", "Quantity unit"],
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
    hsCodeDrafted: readDraftedFields(d).includes("hs_code"),
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
      // The Statement on Origin is the EU GSP/REX self-certification — only valid
      // for EU destinations. Omit it on non-EU shipments (e.g. USA) so a wrong
      // origin claim never lands on the invoice.
      origin: isEuDestination(get("destination_country"))
        ? prof("declaration_origin") || undefined
        : undefined,
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
  const { admin, shipment, d, p, identityOk } = await loadShipmentAndProfile(shipmentId);
  if (!shipment) return { ok: false, error: "Shipment not found" };
  if (!identityOk) return { ok: false, error: IDENTITY_REQUIRED_ERROR };

  const get = (k: string) => (d[k] ?? "").trim();
  const prof = (k: string) => (p[k] ?? "").trim();

  // Packing details (packages, weights) are optional — they rarely appear on a
  // PO. The template renders blanks for any that are missing, to be filled later.
  const required: [string, string][] = [
    ["buyer_name", "Buyer name"],
    ["product_description", "Product description"],
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
  const { admin, shipment, d, p, identityOk } = await loadShipmentAndProfile(shipmentId);
  if (!shipment) return { ok: false, error: "Shipment not found" };
  if (!identityOk) return { ok: false, error: IDENTITY_REQUIRED_ERROR };

  const get = (k: string) => (d[k] ?? "").trim();
  const prof = (k: string) => (p[k] ?? "").trim();

  const required: [string, string][] = [
    ["buyer_name", "Buyer name"],
    ["product_description", "Product description"],
    ["destination_country", "Destination country"],
    ["hs_code", "HS code"],
    ["quantity", "Quantity"],
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
    hsCodeDrafted: readDraftedFields(d).includes("hs_code"),
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

export async function generateExportDeclarationCore(
  shipmentId: string,
  generatedBy: string | null
): Promise<GenerateResult> {
  const { admin, shipment, d, p, identityOk } = await loadShipmentAndProfile(shipmentId);
  if (!shipment) return { ok: false, error: "Shipment not found" };
  if (!identityOk) return { ok: false, error: IDENTITY_REQUIRED_ERROR };

  const get = (k: string) => (d[k] ?? "").trim();
  const prof = (k: string) => (p[k] ?? "").trim();

  const required: [string, string][] = [
    ["buyer_name", "Buyer name"],
    ["product_description", "Product description"],
    ["quantity", "Quantity"],
    ["value_amount", "Invoice value"],
    ["value_currency", "Currency"],
    ["hs_code", "HS code"],
    ["destination_country", "Destination country"],
  ];
  const missing = required.filter(([k]) => !get(k)).map(([, label]) => label);
  if (missing.length > 0) {
    return { ok: false, error: `Fill these fields first: ${missing.join(", ")}` };
  }

  const destination = get("destination_country");
  const pdfBytes = await buildExportDeclarationPdf({
    reference: shipment.reference_number as string,
    date: new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
    invoiceRef: `CI-${shipment.reference_number}`,
    exporter: {
      name: prof("legal_name") || DEMO_SELLER.name,
      address: prof("address"),
      iec: prof("iec"),
      gstin: prof("gstin"),
    },
    buyer: { name: get("buyer_name"), address: get("buyer_address") },
    destinationCountry: destination,
    countryOfOrigin: get("country_of_origin") || "India",
    incoterm: (get("incoterm") || prof("default_incoterm")).toUpperCase(),
    hsCode: get("hs_code"),
    hsCodeDrafted: readDraftedFields(d).includes("hs_code"),
    productDescription: get("product_description"),
    quantity: get("quantity"),
    quantityUnit: get("quantity_unit"),
    value: get("value_amount"),
    currency: (get("value_currency") || prof("default_currency")).toUpperCase(),
    declarations: {
      lut: prof("declaration_lut") || undefined,
      rodtep: prof("declaration_rodtep") || undefined,
      // EU GSP/REX statement only for EU destinations (same rule as the invoice).
      origin: isEuDestination(destination) ? prof("declaration_origin") || undefined : undefined,
    },
  });

  return storeDocument({
    admin,
    shipmentId,
    customerId: shipment.customer_id as string,
    docType: "export_declaration",
    fileSlug: "export-declaration",
    generator: EXPORT_DECL_GENERATOR,
    pdfBytes,
    sourceData: d,
    generatedBy,
  });
}

export async function generateShippingBillPackCore(
  shipmentId: string,
  generatedBy: string | null
): Promise<GenerateResult> {
  const { admin, shipment, d, p, identityOk } = await loadShipmentAndProfile(shipmentId);
  if (!shipment) return { ok: false, error: "Shipment not found" };
  if (!identityOk) return { ok: false, error: IDENTITY_REQUIRED_ERROR };

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
    hsCodeDrafted: readDraftedFields(d).includes("hs_code"),
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

// The LC cover letter: the bank-presentation covering letter listing the documents
// tendered under a Letter of Credit. Built from the LC's own details, which the LC
// check captured into the reserved "_lc_meta" key — so it can only be generated
// after that check has run. Never invents a field: whatever the LC didn't state
// renders as a fill-in line the operator completes by hand.
export async function generateLcCoverLetterCore(
  shipmentId: string,
  generatedBy: string | null
): Promise<GenerateResult> {
  const { admin, shipment, d, p, identityOk } = await loadShipmentAndProfile(shipmentId);
  if (!shipment) return { ok: false, error: "Shipment not found" };
  if (!identityOk) return { ok: false, error: IDENTITY_REQUIRED_ERROR };

  const prof = (k: string) => (p[k] ?? "").trim();

  // Read the LC details captured by the LC check. Precondition: at least the LC
  // number or the issuing bank must be present, else there is nothing to build on.
  let meta: { lc_number?: string; issuing_bank?: string; applicant?: string } = {};
  try {
    const parsed = JSON.parse((d["_lc_meta"] ?? "").trim() || "null");
    if (parsed && typeof parsed === "object") meta = parsed as typeof meta;
  } catch {
    meta = {};
  }
  const lcNumber = String(meta.lc_number ?? "").trim();
  const issuingBank = String(meta.issuing_bank ?? "").trim();
  const applicant = String(meta.applicant ?? "").trim();
  if (!lcNumber && !issuingBank) {
    return { ok: false, error: "Run the LC check first — the cover letter is built from the LC's details." };
  }

  // Documents presented = the latest generated document of each type (excluding
  // the cover letter itself), listed by their exporter-facing labels.
  const { data: gdocs } = await admin
    .from("generated_documents")
    .select("doc_type")
    .eq("shipment_id", shipmentId)
    .order("generated_at", { ascending: false });
  const seen = new Set<string>();
  const documents: string[] = [];
  for (const row of (gdocs ?? []) as { doc_type: string }[]) {
    if (row.doc_type === "lc_cover_letter" || seen.has(row.doc_type)) continue;
    seen.add(row.doc_type);
    documents.push(DOC_LABELS[row.doc_type] ?? row.doc_type);
  }

  // The amount drawn = the shipment's invoice value; banks reconcile the
  // presentation against the LC's available balance by this figure.
  const amountDrawn = [(d["value_currency"] ?? "").trim(), (d["value_amount"] ?? "").trim()]
    .filter(Boolean)
    .join(" ");

  const pdfBytes = await buildLcCoverPdf({
    date: new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
    beneficiary: { name: prof("legal_name") || DEMO_SELLER.name, address: prof("address") },
    reference: shipment.reference_number as string,
    lcNumber,
    issuingBank,
    applicant,
    amountDrawn,
    documents,
  });

  return storeDocument({
    admin,
    shipmentId,
    customerId: shipment.customer_id as string,
    docType: "lc_cover_letter",
    fileSlug: "lc-cover-letter",
    generator: LC_COVER_GENERATOR,
    pdfBytes,
    sourceData: d,
    generatedBy,
  });
}

// The core document set Qra drafts for every shipment and sends to the exporter:
// commercial invoice + packing list (the two ESSENTIALS — they need only the
// minimal order fields), plus the export declaration and shipping-bill data sheet
// when the data supports them (those two also need HS code + destination).
// Best-effort on the latter two: a PO still missing its HS code gets the invoice +
// packing now, and the declaration/sheet are drafted the moment the field arrives
// (the gap-fill reply or an operator correction re-runs this). It never blocks the
// send. Returns whether the two essentials generated, so the caller decides between
// sending to the exporter (essentials ok) and routing to the operator queue.
export async function generateCoreDocSet(
  shipmentId: string,
  generatedBy: string | null
): Promise<{ essentialOk: boolean; generated: string[]; skipped: string[] }> {
  const generated: string[] = [];
  const skipped: string[] = [];
  const run = async (docType: string, fn: Promise<GenerateResult>) => {
    const r = await fn;
    (r.ok ? generated : skipped).push(docType);
    return r.ok;
  };

  const invoiceOk = await run("commercial_invoice", generateCommercialInvoiceCore(shipmentId, generatedBy));
  const packingOk = await run("packing_list", generatePackingListCore(shipmentId, generatedBy));
  await run("export_declaration", generateExportDeclarationCore(shipmentId, generatedBy));
  await run("shipping_bill_pack", generateShippingBillPackCore(shipmentId, generatedBy));

  return { essentialOk: invoiceOk && packingOk, generated, skipped };
}
