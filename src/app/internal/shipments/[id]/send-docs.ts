"use server";

import { revalidatePath } from "next/cache";
import { getOperatorSession } from "@/lib/supabase/auth";
import { sendDocsToCustomerCore } from "@/lib/docs/send-to-customer";

type Result = { ok: true; sent: number } | { ok: false; error: string };

// Operator approval: send the latest generated documents to the customer on
// WhatsApp and move the shipment to awaiting_customer_approval.
export async function approveAndSendDocs(shipmentId: string): Promise<Result> {
  try {
    const session = await getOperatorSession();
    if (!session) return { ok: false, error: "Not authorized" };

    const result = await sendDocsToCustomerCore(shipmentId, session.userId);
    if (!result.ok) return result;

    revalidatePath(`/internal/shipments/${shipmentId}`);
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("approveAndSendDocs failed:", msg);
    return { ok: false, error: "Could not send the documents — please try again." };
  }
}
