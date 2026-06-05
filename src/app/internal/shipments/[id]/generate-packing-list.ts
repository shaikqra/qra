"use server";

import { createHash } from "crypto";
import { revalidatePath } from "next/cache";
import { getOperatorSession } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildPackingListPdf } from "@/lib/pdf/packing-list";

const GENERATOR = "pdf-lib / packing-list@v1";

const DEMO_SELLER = {
  name: "NAVA-MGE Exports",
  address: "Hyderabad, Telangana, India",
  iec: "",
};

type Result = { ok: true; downloadUrl: string } | { ok: false; error: string };

export async function generatePackingList(shipmentId: string): Promise<Result> {
  try {
    return await runGeneration(shipmentId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("generatePackingList failed:", msg);
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

  // A packing list needs the parties, the goods, and — its whole point — the
  // packages and weights. Block and say exactly what's missing.
  const required: [string, string][] = [
    ["buyer_name", "Buyer name"],
    ["product_description", "Product description"],
    ["number_of_packages", "No. of packages"],
    ["package_type", "Package type"],
    ["net_weight", "Net weight"],
    ["gross_weight", "Gross weight"],
  ];
  const missing = required.filter(([k]) => !(d[k] ?? "").trim()).map(([, label]) => label);
  if (missing.length > 0) {
    return { ok: false, error: `Fill these fields first: ${missing.join(", ")}` };
  }

  const pdfBytes = await buildPackingListPdf({
    reference: shipment.reference_number,
    date: new Date().toLocaleDateString("en-GB", {
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
    hsCode: (d.hs_code ?? "").trim(),
    productDescription: d.product_description.trim(),
    quantity: (d.quantity ?? "").trim(),
    quantityUnit: (d.quantity_unit ?? "").trim(),
    numberOfPackages: d.number_of_packages.trim(),
    packageType: d.package_type.trim(),
    netWeight: d.net_weight.trim(),
    grossWeight: d.gross_weight.trim(),
    weightUnit: (d.weight_unit ?? "").trim(),
  });

  const buffer = Buffer.from(pdfBytes);
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const storagePath = `${shipment.customer_id}/${shipmentId}/packing-list-${Date.now()}.pdf`;

  const { error: upErr } = await admin.storage
    .from("generated-docs")
    .upload(storagePath, buffer, { contentType: "application/pdf", upsert: false });
  if (upErr) return { ok: false, error: `Upload failed: ${upErr.message}` };

  const { error: insErr } = await admin.from("generated_documents").insert({
    shipment_id: shipmentId,
    customer_id: shipment.customer_id,
    doc_type: "packing_list",
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
