import twilio from "twilio";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NOT_FOR_CUSTOMER } from "@/lib/docs/doc-visibility";
import { writeAudit } from "@/lib/audit";

export type SendDocsResult = { ok: true; sent: number } | { ok: false; error: string };

const DOC_LABELS: Record<string, string> = {
  commercial_invoice: "Commercial Invoice",
  packing_list: "Packing List",
  certificate_of_origin: "Certificate of Origin",
  proforma_invoice: "Proforma Invoice",
  export_declaration: "Export Declaration / Annexure",
  shipping_bill_pack: "Shipping Bill Data Sheet",
  lc_cover_letter: "LC Cover Letter",
};

// Send the latest generated document of each type to the shipment's customer
// on WhatsApp and move the shipment to awaiting_customer_approval. Called by
// the operator dashboard (sentBy = operator id) and by the auto-pipeline
// (sentBy = null = system). One file per message, then a single APPROVE prompt.
export async function sendDocsToCustomerCore(
  shipmentId: string,
  sentBy: string | null
): Promise<SendDocsResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER?.trim();
  if (!sid || !token) return { ok: false, error: "Twilio is not configured" };
  if (!fromNumber) {
    return { ok: false, error: "TWILIO_WHATSAPP_NUMBER is not set in Vercel env" };
  }

  const admin = createSupabaseServerClient();

  const { data: shipment } = await admin
    .from("shipments")
    .select("id, customer_id, reference_number, status")
    .eq("id", shipmentId)
    .maybeSingle();
  if (!shipment) return { ok: false, error: "Shipment not found" };

  // A shipment parked at sanctions_screening has an UNRESOLVED denied-party hold.
  // Never send its documents to the customer — the operator must resolve screening
  // first (move it out of this status, which re-runs the check and fails closed if
  // still flagged). The auto-pipeline clears the hold before it ever sends, so this
  // only blocks genuinely-unresolved holds, never the happy path.
  if (shipment.status === "sanctions_screening") {
    return {
      ok: false,
      error: "Resolve sanctions screening for this shipment before sending documents to the customer.",
    };
  }

  const { data: customer } = await admin
    .from("customers")
    .select("whatsapp_number")
    .eq("id", shipment.customer_id)
    .maybeSingle();
  const to = (customer?.whatsapp_number ?? "").trim();
  if (!to) {
    return {
      ok: false,
      error: "Customer's WhatsApp number unknown — ask them to send any message, then retry",
    };
  }

  // Latest document of each type.
  const { data: docs } = await admin
    .from("generated_documents")
    .select("doc_type, storage_path, generated_at")
    .eq("shipment_id", shipmentId)
    .order("generated_at", { ascending: false });

  const latest = new Map<string, string>();
  for (const doc of (docs ?? []) as { doc_type: string; storage_path: string }[]) {
    if (NOT_FOR_CUSTOMER.has(doc.doc_type)) continue;
    if (!latest.has(doc.doc_type)) latest.set(doc.doc_type, doc.storage_path);
  }
  if (latest.size === 0) {
    return { ok: false, error: "No generated documents to send" };
  }

  const client = twilio(sid, token);
  let sent = 0;
  let lastErr: string | null = null;

  // WhatsApp via Twilio allows one file per message, so the documents go out
  // back-to-back labeled by name only, followed by a single approval prompt. Each
  // send is isolated: one document failing (a closed sandbox session, a bad number)
  // is logged with its Twilio code and skipped, rather than aborting the whole batch.
  for (const [docType, path] of latest) {
    const { data: signed } = await admin.storage
      .from("generated-docs")
      .createSignedUrl(path, 60 * 60); // Twilio fetches within the hour
    if (!signed?.signedUrl) continue;

    try {
      await client.messages.create({
        from: fromNumber,
        to,
        body: `${DOC_LABELS[docType] ?? docType} — shipment ${shipment.reference_number}`,
        mediaUrl: [signed.signedUrl],
      });
      sent++;
    } catch (e) {
      const code = (e as { code?: number | string } | null)?.code;
      lastErr = code != null ? String(code) : e instanceof Error ? e.name : "unknown";
      console.error("whatsapp_doc_send_failed", { shipmentId, docType, code: lastErr });
    }
  }

  if (sent === 0) {
    // Every send failed — surface the Twilio code so it's diagnosable
    // (e.g. 63016 = no open WhatsApp session / sandbox window closed).
    return {
      ok: false,
      error: `Could not send the documents on WhatsApp${lastErr ? ` (Twilio ${lastErr})` : ""}.`,
    };
  }

  try {
    await client.messages.create({
      from: fromNumber,
      to,
      body: `That's all ${sent} document(s) for shipment ${shipment.reference_number}. Reply APPROVE to approve them all, or tell us what to change.`,
    });
  } catch (e) {
    console.error("whatsapp_approve_prompt_failed", { shipmentId, name: e instanceof Error ? e.name : "unknown" });
  }

  // Don't let a stale/duplicate send knock an already-approved shipment backward
  // (e.g. an operator re-clicking "send" after the customer has approved).
  const FORWARD = [
    "awaiting_goods_ready", "customer_approved", "filed_with_cha",
    "customs_cleared", "in_transit", "delivered", "completed", "order_declined", "rejected",
  ];
  if (!FORWARD.includes(shipment.status as string)) {
    await admin
      .from("shipments")
      .update({ status: "awaiting_customer_approval" })
      .eq("id", shipmentId);
  }

  await writeAudit(admin, {
    operator_id: sentBy,
    shipment_id: shipmentId,
    action_type: sentBy ? "approve" : "status_change",
    old_value: { status: shipment.status },
    new_value: {
      status: "awaiting_customer_approval",
      documents_sent: sent,
      sent_by: sentBy ? "operator" : "system",
    },
  });

  return { ok: true, sent };
}
