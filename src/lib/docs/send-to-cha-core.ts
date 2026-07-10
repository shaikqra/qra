import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveChaEmail } from "@/lib/cha-contacts";
import { isAutoSendChaEnabled } from "@/lib/app-settings";
import { writeAudit } from "@/lib/audit";

export type ChaSendResult =
  | { ok: true; sent: number }
  | {
      ok: false;
      reason:
        | "no_cha_email"
        | "no_docs"
        | "not_approved"
        | "not_configured"
        | "send_failed"
        | "already_sent"
        | "error";
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

export const DOC_LABELS: Record<string, string> = {
  commercial_invoice: "Commercial Invoice",
  packing_list: "Packing List",
  certificate_of_origin: "Certificate of Origin",
  proforma_invoice: "Proforma Invoice",
  shipping_bill_pack: "Shipping Bill Data Sheet",
  export_declaration: "Export Declaration / Annexure",
  lc_cover_letter: "LC Cover Letter",
};

// Email the latest generated document of each type to the exporter's customs
// broker (CHA) via Resend, then mark the shipment filed-with-CHA. Shared by the
// operator button (sentBy = operator id) and the automatic post-approval send
// (sentBy = null = system). Returns a typed reason so callers can tell a real
// failure from "no CHA email yet" (which should not be treated as an error).
// Two guards make the hand-off safe: (1) every newest-of-type doc must carry an
// approved_at stamp — the IMMUTABLE per-doc approval artifact, not the editable
// status flag — so an unapproved or regenerated doc can never reach the broker;
// and (2) BOTH paths atomically claim the status transition to filed_with_cha
// BEFORE emailing (the automatic path from requireStatus, the manual path from
// customer_approved), so the broker is emailed exactly once even under a
// double-click or a race. A losing claim returns already_sent; a fetch/send
// failure reverts the claim so it can retry.
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

  // Operator manual send (no requireStatus): only once the customer has approved
  // AND confirmed goods ready (status customer_approved). Blocks (a) emailing the
  // broker before both human gates pass, and (b) an accidental double-send — after
  // a send the status is filed_with_cha, so a repeat click is refused here.
  if (!requireStatus && shipment.status !== "customer_approved") {
    return shipment.status === "filed_with_cha"
      ? { ok: false, reason: "already_sent", error: "These documents were already sent to the CHA." }
      : {
          ok: false,
          reason: "error",
          error: "Send to the CHA once the customer has approved and confirmed the goods are ready.",
        };
  }

  // This exporter's default broker (or the first with an email). We never fall
  // back to another exporter's broker — better to flag "no CHA" than misdeliver.
  const chaEmail = await resolveChaEmail(admin, shipment.customer_id);
  if (!chaEmail) {
    return { ok: false, reason: "no_cha_email", error: "No CHA email is set for this exporter." };
  }

  const { data: docs } = await admin
    .from("generated_documents")
    .select("doc_type, storage_path, generated_at, approved_at")
    .eq("shipment_id", shipmentId)
    .order("generated_at", { ascending: false });

  const latest = new Map<string, { path: string; approvedAt: string | null }>();
  for (const doc of (docs ?? []) as {
    doc_type: string;
    storage_path: string;
    approved_at: string | null;
  }[]) {
    // The LC cover letter is the exporter's letter to their ISSUING BANK — the
    // CHA files customs and has no role in LC presentation, so it stays out of
    // the filing pack (the exporter gets it via portal / customer send).
    if (doc.doc_type === "lc_cover_letter") continue;
    if (!latest.has(doc.doc_type)) {
      latest.set(doc.doc_type, { path: doc.storage_path, approvedAt: doc.approved_at });
    }
  }
  if (latest.size === 0) {
    return { ok: false, reason: "no_docs", error: "No documents to send." };
  }

  // Gate on the IMMUTABLE approval artifact, not the editable status flag: every
  // newest-of-type doc must carry an approved_at stamp (only ever set null ->
  // timestamp, when the customer approved). If any is unstamped — e.g. a doc was
  // regenerated after approval — refuse the whole send so an unapproved document
  // can never reach the broker. Applies to BOTH the manual and the automatic path.
  for (const { approvedAt } of latest.values()) {
    if (!approvedAt) {
      return {
        ok: false,
        reason: "not_approved",
        error:
          "These documents haven't been approved by the customer yet — get their approval before sending to the CHA.",
      };
    }
  }

  const attachments: { filename: string; content: string }[] = [];
  const sentTypes: string[] = [];
  for (const [docType, { path }] of latest) {
    const { data: blob, error: dlErr } = await admin.storage.from("generated-docs").download(path);
    if (dlErr || !blob) continue;
    const content = Buffer.from(await blob.arrayBuffer()).toString("base64");
    attachments.push({ filename: `${docType}-${ref}.pdf`, content });
    sentTypes.push(docType);
  }
  if (attachments.length === 0) {
    return { ok: false, reason: "no_docs", error: "Could not read the documents to send." };
  }

  // Claim the status transition to filed_with_cha BEFORE emailing, so the CHA is
  // emailed EXACTLY once — the real double-send guard for BOTH paths. The automatic
  // path claims from requireStatus; the manual (operator) path claims from
  // customer_approved. A losing claim (0 rows) means another run/click already
  // handed it over; a fetch/send failure below reverts it so it can retry.
  const claimFrom = requireStatus ?? "customer_approved";
  const { data: claimed } = await admin
    .from("shipments")
    .update({ status: "filed_with_cha" })
    .eq("id", shipmentId)
    .eq("status", claimFrom)
    .select("id");
  if (!claimed || claimed.length === 0) {
    return { ok: false, reason: "already_sent", error: "Already handed to the CHA." };
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
    await revertClaim(admin, shipmentId, claimFrom);
    return { ok: false, reason: "send_failed", error: "Could not reach the email service." };
  }

  if (!res.ok) {
    console.error("sendDocsToChaCore email failed:", res.status);
    await revertClaim(admin, shipmentId, claimFrom);
    return { ok: false, reason: "send_failed", error: `Email rejected (code ${res.status}).` };
  }

  // Both paths already flipped status to filed_with_cha via the atomic claim
  // above; the audit row is the durable record of the send.
  // A PII send with no audit row is a compliance hole — never silent.
  await writeAudit(admin, {
    operator_id: sentBy,
    shipment_id: shipmentId,
    action_type: "status_change",
    old_value: { status: claimFrom },
    new_value: {
      status: "filed_with_cha",
      emailed_to_cha: true,
      documents_sent: attachments.length,
      sent_by: sentBy ? "operator" : "system",
    },
  });

  return { ok: true, sent: attachments.length };
}

// Shared post-gate hand-off: once the exporter clears the goods-ready gate (G3),
// email the CHA exactly once — but ONLY if the operator enabled auto-send.
// requireStatus atomically claims the transition to filed_with_cha. Benign
// reasons (no CHA email yet, not configured, already sent) are not errors — the
// operator picks those up. Used by both the portal and WhatsApp goods-ready paths.
export async function autoSendChaIfEnabled(shipmentId: string, requireStatus: string): Promise<void> {
  try {
    if (!(await isAutoSendChaEnabled())) return;
    const sent = await sendDocsToChaCore(shipmentId, null, requireStatus);
    const benign =
      sent.ok ||
      ["no_cha_email", "not_configured", "already_sent"].includes((sent as { reason?: string }).reason ?? "");
    if (!benign) console.error("auto_cha_send_failed", { shipmentId, reason: (sent as { reason?: string }).reason });
  } catch (err) {
    console.error("auto_cha_send_threw", { shipmentId, name: err instanceof Error ? err.name : "unknown" });
  }
}
