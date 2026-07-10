"use server";

import { revalidatePath } from "next/cache";
import { getChaSession } from "@/lib/supabase/cha-auth";
import { createSupabaseAuthClient } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { notifyCustomerWhatsApp } from "@/lib/whatsapp/notify";

type Result = { ok: true } | { ok: false; error: string };

// Best-effort WhatsApp ping to the exporter after the CHA acts. The RPC already
// re-checked broker ownership before this runs, so a service-role lookup of the
// shipment's customer is safe here. Never blocks or fails the CHA action.
async function notifyExporter(shipmentId: string, build: (ref: string) => string): Promise<void> {
  try {
    const admin = createSupabaseServerClient();
    const { data: ship } = await admin
      .from("shipments")
      .select("customer_id, reference_number")
      .eq("id", shipmentId)
      .maybeSingle();
    if (!ship?.customer_id) return;
    await notifyCustomerWhatsApp(
      admin,
      ship.customer_id as string,
      build((ship.reference_number as string) ?? shipmentId)
    );
  } catch {
    // notify is best-effort; the CHA action already succeeded.
  }
}

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
    // The RPC RAISEs this when the exporter hasn't approved the documents yet.
    // Map it to a clear line for the broker; never surface the raw DB error.
    const friendly = (error.message ?? "").includes("customer approval required")
      ? "This shipment isn't approved by the exporter yet — filing can't be recorded until they approve the documents."
      : "Could not save — please try again.";
    return { ok: false, error: friendly };
  }
  await notifyExporter(
    shipmentId,
    (ref) => `✅ Your CHA has filed shipment ${ref} on ICEGATE. Nothing more needed from you.`
  );
  revalidatePath(`/cha/${shipmentId}`);
  revalidatePath("/cha");
  return { ok: true };
}

export async function chaRequestChanges(shipmentId: string, note: string): Promise<Result> {
  const session = await getChaSession();
  if (!session) return { ok: false, error: "Not authorized" };
  // Cap the broker's note: it's stored and forwarded to the exporter's WhatsApp.
  // Uncapped, a paste could bloat the message (Twilio bills per segment).
  const reason = note?.trim().slice(0, 1000) ?? "";
  if (!reason) return { ok: false, error: "Please describe the change needed." };
  const supabase = await createSupabaseAuthClient();
  const { error } = await supabase.rpc("cha_request_changes", {
    p_shipment: shipmentId,
    p_note: reason,
  });
  if (error) {
    console.error("cha_request_changes_failed", { code: error.code });
    return { ok: false, error: "Could not save — please try again." };
  }
  // Re-open the shipment so the exporter's reply (and the operator's AI-correct)
  // can actually act on it. Without this the shipment stays at customer_approved /
  // filed_with_cha, where a WhatsApp reply matches no gate handler and is silently
  // dropped. awaiting_customer_approval is both operator-correctable and
  // exporter-re-approvable, so the change request re-enters the pipeline.
  const admin = createSupabaseServerClient();
  await admin
    .from("shipments")
    .update({ status: "awaiting_customer_approval" })
    .eq("id", shipmentId)
    .in("status", ["customer_approved", "filed_with_cha"]);
  // Fence the broker's words inside quotes + an explicit attribution line so a
  // forwarded note can't be mistaken for Qra asking the exporter for something.
  await notifyExporter(
    shipmentId,
    (ref) =>
      `⚠️ Your CHA reviewed shipment ${ref} and needs a change before filing.\n\nTheir note:\n"${reason}"\n\nReply here with the correction and I'll update your documents.`
  );
  revalidatePath(`/cha/${shipmentId}`);
  revalidatePath("/cha");
  return { ok: true };
}
