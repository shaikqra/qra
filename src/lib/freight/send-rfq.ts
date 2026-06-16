import { createHash } from "crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Send a drafted carrier RFQ by email (Resend). This is where the Freight agent's
// draft becomes a real outbound action — so it ALWAYS writes an audit row (who
// sent it, to which carrier, a hash of the exact content). It sends one plain
// email; it books nothing and moves no money.

export type FreightSendResult =
  | { ok: true; audited: boolean }
  | { ok: false; reason: "not_configured" | "bad_email" | "empty" | "no_shipment" | "send_failed"; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function sendFreightRfqCore(
  shipmentId: string,
  sentBy: string | null,
  carrierEmail: string,
  subject: string,
  body: string
): Promise<FreightSendResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM?.trim();
  if (!apiKey || !from) return { ok: false, reason: "not_configured", error: "Email is not configured yet." };

  const to = carrierEmail.trim();
  if (!EMAIL_RE.test(to) || to.length > 200) {
    return { ok: false, reason: "bad_email", error: "Enter a valid carrier email address." };
  }
  const subj = subject.trim().slice(0, 200);
  const text = body.trim().slice(0, 6000);
  if (!subj || !text) return { ok: false, reason: "empty", error: "Nothing to send — draft the RFQ first." };

  const admin = createSupabaseServerClient();

  // Confirm the shipment exists BEFORE sending. This validates the id AND
  // guarantees the audit row's shipment_id foreign key will be valid — so a real
  // outbound email can never end up with no durable record.
  const { data: shipment } = await admin
    .from("shipments")
    .select("id")
    .eq("id", shipmentId)
    .maybeSingle();
  if (!shipment) return { ok: false, reason: "no_shipment", error: "Shipment not found." };

  let res: Response;
  try {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject: subj, text }),
    });
  } catch (e) {
    console.error("sendFreightRfqCore fetch failed:", e instanceof Error ? e.name : "unknown");
    return { ok: false, reason: "send_failed", error: "Could not reach the email service." };
  }
  if (!res.ok) {
    console.error("sendFreightRfqCore email failed:", res.status);
    return { ok: false, reason: "send_failed", error: `Email rejected (code ${res.status}).` };
  }

  // Audit the external send: who, to which carrier, a hash of the content. An
  // outbound on the exporter's behalf with no audit row is a compliance hole — so
  // if the audit write fails we report it (audited:false) rather than a false "ok".
  const contentHash = createHash("sha256").update(`${subj}\n${text}`).digest("hex");
  const { error: auditErr } = await admin.from("audit_operator_action").insert({
    operator_id: sentBy,
    shipment_id: shipmentId,
    action_type: "note",
    old_value: null,
    new_value: {
      event: "freight_rfq_sent",
      carrier_email: to,
      content_sha256: contentHash,
      sent_by: sentBy ? "operator" : "system",
    },
  });
  if (auditErr) {
    console.error("freight_rfq_audit_write_failed", { shipmentId });
    return { ok: true, audited: false };
  }

  return { ok: true, audited: true };
}
