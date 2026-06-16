import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveChaEmail } from "@/lib/cha-contacts";

export type ChaSendResult =
  | { ok: true; sent: number }
  | {
      ok: false;
      reason: "no_cha_email" | "no_docs" | "not_configured" | "send_failed" | "already_sent" | "error";
      error: string;
    };

// Put a claimed status back if the send fails, so it can be retried.
async function revertClaim(
  admin: ReturnType<typeof createSupabaseServerClient>,
  shipmentId: string,
  toStatus: string
) {
  await admin
    .from("shipments")
    .update({ status: toStatus })
    .eq("id", shipmentId)
    .eq("status", "filed_with_cha");
}

const DOC_LABELS: Record<string, string> = {
  commercial_invoice: "Commercial Invoice",
  packing_list: "Packing List",
  certificate_of_origin: "Certificate of Origin",
  proforma_invoice: "Proforma Invoice",
  shipping_bill_pack: "Shipping Bill Data Sheet",
  export_declaration: "Export Declaration / Annexure",
};

// Email the latest generated document of each type to the exporter's customs
// broker (CHA) via Resend, then mark the shipment filed-with-CHA. Shared by the
// operator button (sentBy = operator id) and the automatic post-approval send
// (sentBy = null = system). Returns a typed reason so callers can tell a real
// failure from "no CHA email yet" (which should not be treated as an error).
// requireStatus (automatic path) atomically claims that status transition to
// filed_with_cha before sending, so the broker is emailed exactly once. The
// operator path omits it (an explicit re-send is allowed).
export async function sendDocsToChaCore(
  shipmentId: string,
  sentBy: string | null,
  requireStatus?: string
): Promise<ChaSendResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM?.trim();
  if (!apiKey || !from) {
    return { ok: false, reason: "not_configured", error: "Email is not configured yet." };
  }

  const admin = createSupabaseServerClient();

  const { data: shipment } = await admin
    .from("shipments")
    .select("id, customer_id, reference_number, status")
    .eq("id", shipmentId)
    .maybeSingle();
  if (!shipment) return { ok: false, reason: "error", error: "Shipment not found" };
  const ref = shipment.reference_number as string;

  // This exporter's default broker (or the first with an email). We never fall
  // back to another exporter's broker — better to flag "no CHA" than misdeliver.
  const chaEmail = await resolveChaEmail(admin, shipment.customer_id);
  if (!chaEmail) {
    return { ok: false, reason: "no_cha_email", error: "No CHA email is set for this exporter." };
  }

  const { data: docs } = await admin
    .from("generated_documents")
    .select("doc_type, storage_path, generated_at")
    .eq("shipment_id", shipmentId)
    .order("generated_at", { ascending: false });

  const latest = new Map<string, string>();
  for (const doc of (docs ?? []) as { doc_type: string; storage_path: string }[]) {
    if (!latest.has(doc.doc_type)) latest.set(doc.doc_type, doc.storage_path);
  }
  if (latest.size === 0) {
    return { ok: false, reason: "no_docs", error: "No documents to send." };
  }

  const attachments: { filename: string; content: string }[] = [];
  const sentTypes: string[] = [];
  for (const [docType, path] of latest) {
    const { data: blob, error: dlErr } = await admin.storage.from("generated-docs").download(path);
    if (dlErr || !blob) continue;
    const content = Buffer.from(await blob.arrayBuffer()).toString("base64");
    attachments.push({ filename: `${docType}-${ref}.pdf`, content });
    sentTypes.push(docType);
  }
  if (attachments.length === 0) {
    return { ok: false, reason: "no_docs", error: "Could not read the documents to send." };
  }

  // Automatic path: claim the status transition so the CHA is emailed exactly
  // once. A losing claim means another run already handed it over.
  if (requireStatus) {
    const { data: claimed } = await admin
      .from("shipments")
      .update({ status: "filed_with_cha" })
      .eq("id", shipmentId)
      .eq("status", requireStatus)
      .select("id");
    if (!claimed || claimed.length === 0) {
      return { ok: false, reason: "already_sent", error: "Already handed to the CHA." };
    }
  }

  const bodyText = [
    `Please find attached the export documents for shipment ${ref}.`,
    "",
    "Documents attached:",
    ...sentTypes.map((t) => `- ${DOC_LABELS[t] ?? t}`),
    "",
    "These were approved by the exporter's customer. Please review and proceed with the Shipping Bill filing.",
    "",
    "Sent via Qra.",
  ].join("\n");

  let res: Response;
  try {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [chaEmail],
        subject: `Export documents — ${ref}`,
        text: bodyText,
        attachments,
      }),
    });
  } catch (e) {
    console.error("sendDocsToChaCore fetch failed:", e instanceof Error ? e.name : "unknown");
    if (requireStatus) await revertClaim(admin, shipmentId, requireStatus);
    return { ok: false, reason: "send_failed", error: "Could not reach the email service." };
  }

  if (!res.ok) {
    console.error("sendDocsToChaCore email failed:", res.status);
    if (requireStatus) await revertClaim(admin, shipmentId, requireStatus);
    return { ok: false, reason: "send_failed", error: `Email rejected (code ${res.status}).` };
  }

  // The automatic path already flipped status via the claim; the operator path
  // sets it now. Either way, the audit row is the durable record of the send.
  if (!requireStatus) {
    const { error: statusErr } = await admin
      .from("shipments")
      .update({ status: "filed_with_cha" })
      .eq("id", shipmentId);
    if (statusErr) console.error("cha_send_status_write_failed", { shipmentId });
  }

  const { error: auditErr } = await admin.from("audit_operator_action").insert({
    operator_id: sentBy,
    shipment_id: shipmentId,
    action_type: "status_change",
    old_value: { status: requireStatus ?? shipment.status },
    new_value: {
      status: "filed_with_cha",
      emailed_to_cha: true,
      documents_sent: attachments.length,
      sent_by: sentBy ? "operator" : "system",
    },
  });
  // A PII send with no audit row is a compliance hole — never silent.
  if (auditErr) console.error("cha_send_audit_write_failed", { shipmentId });

  return { ok: true, sent: attachments.length };
}
