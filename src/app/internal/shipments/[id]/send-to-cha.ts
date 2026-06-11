"use server";

import { revalidatePath } from "next/cache";
import { getOperatorSession } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Result =
  | { ok: true; sent: number; warning?: string }
  | { ok: false; error: string };

const DOC_LABELS: Record<string, string> = {
  commercial_invoice: "Commercial Invoice",
  packing_list: "Packing List",
  certificate_of_origin: "Certificate of Origin",
};

// Emails the latest generated document of each type to the exporter's customs
// broker (CHA) via the Resend REST API, then marks the shipment filed-with-CHA.
export async function sendDocsToCha(shipmentId: string): Promise<Result> {
  try {
    const session = await getOperatorSession();
    if (!session) return { ok: false, error: "Not authorized" };

    const apiKey = process.env.RESEND_API_KEY?.trim();
    const from = process.env.RESEND_FROM?.trim();
    if (!apiKey || !from) {
      return { ok: false, error: "Email is not configured yet. Add the Resend keys first." };
    }

    const admin = createSupabaseServerClient();

    const { data: shipment } = await admin
      .from("shipments")
      .select("id, customer_id, reference_number, status")
      .eq("id", shipmentId)
      .maybeSingle();
    if (!shipment) return { ok: false, error: "Shipment not found" };
    const ref = shipment.reference_number as string;

    // This exporter's own CHA, falling back to the default profile's.
    let { data: profile } = await admin
      .from("exporter_profiles")
      .select("cha_name, cha_email")
      .eq("customer_id", shipment.customer_id)
      .maybeSingle();
    if (!profile) {
      const { data: fallback } = await admin
        .from("exporter_profiles")
        .select("cha_name, cha_email")
        .eq("is_default", true)
        .maybeSingle();
      profile = fallback;
    }
    const chaEmail = (profile?.cha_email ?? "").trim();
    if (!chaEmail) {
      return { ok: false, error: "Set the CHA email in Settings first." };
    }

    // Latest document of each type.
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
      return { ok: false, error: "No documents to send. Generate documents first." };
    }

    // Download each PDF and base64-encode it for the Resend attachment field.
    const attachments: { filename: string; content: string }[] = [];
    const sentTypes: string[] = [];
    for (const [docType, path] of latest) {
      const { data: blob, error: dlErr } = await admin.storage
        .from("generated-docs")
        .download(path);
      if (dlErr || !blob) continue;
      const content = Buffer.from(await blob.arrayBuffer()).toString("base64");
      attachments.push({ filename: `${docType}-${ref}.pdf`, content });
      sentTypes.push(docType);
    }
    if (attachments.length === 0) {
      return { ok: false, error: "Could not read the documents to send." };
    }

    const bodyText = [
      `Please find attached the export documents for shipment ${ref}.`,
      "",
      "Documents attached:",
      ...sentTypes.map((t) => `- ${DOC_LABELS[t] ?? t}`),
      "",
      "Please review and proceed with the Shipping Bill filing.",
      "",
      "Sent via Qra.",
    ].join("\n");

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [chaEmail],
        subject: `Export documents — ${ref}`,
        text: bodyText,
        attachments,
      }),
    });

    if (!res.ok) {
      // Log status only — never the response body (may echo recipient/content).
      console.error("sendDocsToCha email failed:", res.status);
      const hint =
        res.status === 401
          ? "the API key looks wrong"
          : res.status === 403
            ? "the sender domain is not allowed"
            : res.status === 422
              ? "the from/to address format is invalid"
              : `code ${res.status}`;
      return { ok: false, error: `Could not send the email to the CHA (${hint}).` };
    }

    const { error: statusErr } = await admin
      .from("shipments")
      .update({ status: "filed_with_cha" })
      .eq("id", shipmentId);

    const { error: auditErr } = await admin.from("audit_operator_action").insert({
      operator_id: session.userId,
      shipment_id: shipmentId,
      action_type: "status_change",
      old_value: { status: shipment.status },
      new_value: {
        status: "filed_with_cha",
        emailed_to_cha: true,
        documents_sent: attachments.length,
      },
    });

    revalidatePath(`/internal/shipments/${shipmentId}`);

    if (statusErr || auditErr) {
      // The email already went out — flag that the record-keeping didn't stick.
      console.error("sendDocsToCha recordkeeping failed:", {
        status: !!statusErr,
        audit: !!auditErr,
      });
      return {
        ok: true,
        sent: attachments.length,
        warning: "Documents emailed, but updating the status/record failed — refresh and verify.",
      };
    }

    return { ok: true, sent: attachments.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("sendDocsToCha failed:", msg);
    return { ok: false, error: `Send failed: ${msg}` };
  }
}
