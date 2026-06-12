"use server";

import { revalidatePath } from "next/cache";
import { getOperatorSession } from "@/lib/supabase/auth";
import { generateShippingBillPackCore } from "@/lib/docs/generate";

type Result = { ok: true; downloadUrl: string } | { ok: false; error: string };

export async function generateShippingBillPack(shipmentId: string): Promise<Result> {
  try {
    const session = await getOperatorSession();
    if (!session) return { ok: false, error: "Not authorized" };

    const result = await generateShippingBillPackCore(shipmentId, session.userId);
    if (!result.ok) return result;

    revalidatePath(`/internal/shipments/${shipmentId}`);
    return { ok: true, downloadUrl: result.downloadUrl };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("generateShippingBillPack failed:", msg);
    return { ok: false, error: `Generation failed: ${msg}` };
  }
}
