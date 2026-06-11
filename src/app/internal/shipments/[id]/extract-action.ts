"use server";

import { getOperatorSession } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  extractPoFields,
  type PoFields,
  type SupportedMediaType,
} from "@/lib/ai/extract-po";

type Result = { ok: true; fields: PoFields } | { ok: false; error: string };

// Map a stored file path's extension to a Claude-supported media type.
function mediaTypeForPath(path: string): SupportedMediaType | null {
  if (/\.pdf$/i.test(path)) return "application/pdf";
  if (/\.(jpe?g)$/i.test(path)) return "image/jpeg";
  if (/\.png$/i.test(path)) return "image/png";
  if (/\.webp$/i.test(path)) return "image/webp";
  return null;
}

export async function extractShipmentFields(shipmentId: string): Promise<Result> {
  try {
    const session = await getOperatorSession();
    if (!session) return { ok: false, error: "Not authorized" };

    const admin = createSupabaseServerClient();

    // Find the PO files attached to this shipment.
    const { data: ingestRows, error } = await admin
      .from("audit_po_ingest")
      .select("storage_path, created_at")
      .eq("shipment_id", shipmentId)
      .order("created_at", { ascending: true });

    if (error) return { ok: false, error: "Could not load the PO files" };

    const rows = (ingestRows ?? []) as { storage_path: string }[];
    // Pick the first file Claude can actually read (PDF or image).
    const readable = rows
      .map((r) => ({ path: r.storage_path, media: mediaTypeForPath(r.storage_path) }))
      .find((r) => r.media !== null);

    if (!readable || !readable.media) {
      return { ok: false, error: "No PDF or image PO file to read on this shipment" };
    }

    const { data: blob, error: dlErr } = await admin.storage
      .from("purchase-orders")
      .download(readable.path);

    if (dlErr || !blob) return { ok: false, error: "Could not open the PO file" };

    const base64 = Buffer.from(await blob.arrayBuffer()).toString("base64");
    const { fields } = await extractPoFields(base64, readable.media);

    return { ok: true, fields };
  } catch (e) {
    // Message only — never log the document contents or extracted PII.
    const msg = e instanceof Error ? e.message : String(e);
    console.error("extractShipmentFields failed:", msg);
    return { ok: false, error: `Extraction failed: ${msg}` };
  }
}
