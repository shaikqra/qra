"use server";

import { revalidatePath } from "next/cache";
import { getOperatorSession } from "@/lib/supabase/auth";
import { generateLcCoverLetterCore } from "@/lib/docs/generate";

type Result = { ok: true; downloadUrl: string } | { ok: false; error: string };

export async function generateLcCoverLetter(shipmentId: string): Promise<Result> {
  try {
    const session = await getOperatorSession();
    if (!session) return { ok: false, error: "Not authorized" };

    const result = await generateLcCoverLetterCore(shipmentId, session.userId);
    if (!result.ok) return result;

    revalidatePath(`/internal/shipments/${shipmentId}`);
    return { ok: true, downloadUrl: result.downloadUrl };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("generateLcCoverLetter failed:", msg);
    return { ok: false, error: "Generation failed — please try again." };
  }
}
