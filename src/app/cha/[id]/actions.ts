"use server";

import { revalidatePath } from "next/cache";
import { getChaSession } from "@/lib/supabase/cha-auth";
import { createSupabaseAuthClient } from "@/lib/supabase/auth";

type Result = { ok: true } | { ok: false; error: string };

// The broker confirms they've filed the shipping bill on ICEGATE. The RPC
// re-checks (server-side) that this shipment really belongs to this broker.
export async function chaMarkFiled(shipmentId: string, note: string): Promise<Result> {
  const session = await getChaSession();
  if (!session) return { ok: false, error: "Not authorized" };
  const supabase = await createSupabaseAuthClient();
  const { error } = await supabase.rpc("cha_mark_filed", {
    p_shipment: shipmentId,
    p_note: note?.trim() ? note.trim() : null,
  });
  if (error) {
    console.error("cha_mark_filed_failed", { code: error.code });
    return { ok: false, error: "Could not save — please try again." };
  }
  revalidatePath(`/cha/${shipmentId}`);
  revalidatePath("/cha");
  return { ok: true };
}

export async function chaRequestChanges(shipmentId: string, note: string): Promise<Result> {
  const session = await getChaSession();
  if (!session) return { ok: false, error: "Not authorized" };
  if (!note?.trim()) return { ok: false, error: "Please describe the change needed." };
  const supabase = await createSupabaseAuthClient();
  const { error } = await supabase.rpc("cha_request_changes", {
    p_shipment: shipmentId,
    p_note: note.trim(),
  });
  if (error) {
    console.error("cha_request_changes_failed", { code: error.code });
    return { ok: false, error: "Could not save — please try again." };
  }
  revalidatePath(`/cha/${shipmentId}`);
  revalidatePath("/cha");
  return { ok: true };
}
