import twilio from "twilio";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type SendDocsResult = { ok: true; sent: number } | { ok: false; error: string };

const DOC_LABELS: Record<string, string> = {
  commercial_invoice: "Commercial Invoice",
  packing_list: "Packing List",
  certificate_of_origin: "Certificate of Origin",
  proforma_invoice: "Proforma Invoice",
};

// Broker-facing documents that should not go to the customer on WhatsApp.
const NOT_FOR_CUSTOMER = new Set(["shipping_bill_pack"]);

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
  let brokerOnlyCount = 0;
  for (const doc of (docs ?? []) as { doc_type: string; storage_path: string }[]) {
    if (NOT_FOR_CUSTOMER.has(doc.doc_type)) {
      brokerOnlyCount++;
      continue;
    }
    if (!latest.has(doc.doc_type)) latest.set(doc.doc_type, doc.storage_path);
  }
  if (latest.size === 0) {
    return {
      ok: false,
      error:
        brokerOnlyCount > 0
          ? "Only broker-facing documents exist (the Shipping Bill sheet isn't sent to customers) — generate the invoice/packing list first."
          : "No generated documents to send",
    };
  }

  const client = twilio(sid, token);
  let sent = 0;

  // WhatsApp via Twilio allows one file per message, so the documents go out
  // back-to-back labeled by name only, followed by a single approval prompt.
  for (const [docType, path] of latest) {
    const { data: signed } = await admin.storage
      .from("generated-docs")
      .createSignedUrl(path, 60 * 60); // Twilio fetches within the hour
    if (!signed?.signedUrl) continue;

    await client.messages.create({
      from: fromNumber,
      to,
      body: `${DOC_LABELS[docType] ?? docType} — shipment ${shipment.reference_number}`,
      mediaUrl: [signed.signedUrl],
    });
    sent++;
  }

  if (sent === 0) return { ok: false, error: "Could not prepare document links" };

  await client.messages.create({
    from: fromNumber,
    to,
    body: `That's all ${sent} document(s) for shipment ${shipment.reference_number}. Reply APPROVE to approve them all, or tell us what to change.`,
  });

  await admin
    .from("shipments")
    .update({ status: "awaiting_customer_approval" })
    .eq("id", shipmentId);

  await admin.from("audit_operator_action").insert({
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
