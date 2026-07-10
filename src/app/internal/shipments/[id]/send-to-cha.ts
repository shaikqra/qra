"use server";

import { revalidatePath } from "next/cache";
import { getOperatorSession } from "@/lib/supabase/auth";
import { sendDocsToChaCore } from "@/lib/docs/send-to-cha-core";

type Result = { ok: true; sent: number } | { ok: false; error: string };

// Operator button: email the document set to the customs broker now.
export async function sendDocsToCha(shipmentId: string): Promise<Result> {
  try {
    const session = await getOperatorSession();
    if (!session) return { ok: false, error: "Not authorized" };

    const result = await sendDocsToChaCore(shipmentId, session.userId);
    if (!result.ok) {
      const friendly =
        result.reason === "no_cha_email"
          ? "Set the CHA email in Settings first."
          : result.reason === "not_configured"
            ? "Email isn't configured yet — add the Resend keys."
            : result.reason === "no_docs"
              ? "No documents to send — generate documents first."
              : result.reason === "already_sent"
                ? "These documents were already sent to the CHA."
                : // "error" and "not_approved" carry operator-safe messages (e.g.
                  // send is only allowed once the customer has approved + confirmed
                  // goods ready, or a regenerated doc still needs their approval).
                  result.reason === "error" || result.reason === "not_approved"
                  ? result.error
                  : "Could not send the email to the CHA. Check the Resend setup.";
      return { ok: false, error: friendly };
    }

    revalidatePath(`/internal/shipments/${shipmentId}`);
    return { ok: true, sent: result.sent };
  } catch (e) {
    console.error("sendDocsToCha failed:", e instanceof Error ? e.name : "unknown");
    return { ok: false, error: "Could not send the documents — please try again." };
  }
}
