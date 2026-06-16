import Anthropic from "@anthropic-ai/sdk";

// Qra's Certification agent. First capability: list the export certificates /
// permits / inspection documents a shipment likely needs, for the product and
// destination. ADVISORY — it issues NOTHING and names who issues each (FSSAI,
// APEDA, Chamber of Commerce / DGFT, an accredited lab, a fumigation agency, the
// destination's import authority). Never invents certificate names.

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export type RequiredCert = { name: string; note: string; issuedBy: string };

const SYSTEM_PROMPT = `You are Qra's Certification agent for Indian exporters. List the export certificates, permits and inspection documents typically required to export the given product FROM INDIA to the given destination.

Rules:
- ADVISORY only — you do NOT issue any certificate. For each, name who issues it (e.g. FSSAI, APEDA, Chamber of Commerce / DGFT eCoO, an accredited testing lab, a fumigation agency, the destination's import authority).
- Cover BOTH the India export-side documents AND the destination-country IMPORT-side requirements (e.g. FDA Food Facility Registration + Prior Notice for the USA; EU health-certificate / TRACES entry). The import-side ones are easy to miss and are often what holds a container.
- Surface CONDITIONAL certificates too: if a document only applies under a condition (e.g. organic labelling, human consumption, wood/timber packaging, cold chain), list it anyway with the condition stated in the note (e.g. "If sold as organic: NOP for the USA or EU-organic certificate required").
- Include only documents genuinely relevant to THIS product + destination. Do not pad or invent certificate names.
- Keep each note to one short, plain line.`;

export async function requiredCertificates(
  product: string,
  destination: string,
  hsCode: string
): Promise<RequiredCert[] | null> {
  if (!product.trim()) return null;
  try {
    const message = await anthropic.messages.create(
      {
        model: "claude-sonnet-4-6",
        max_tokens: 700,
        system: SYSTEM_PROMPT,
        tools: [
          {
            name: "record_certs",
            description: "Record the certificates the shipment likely needs.",
            input_schema: {
              type: "object",
              properties: {
                certs: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string", description: "the certificate / document name" },
                      note: { type: "string", description: "one short line: why / when it's needed" },
                      issued_by: { type: "string", description: "who issues it" },
                    },
                    required: ["name", "note", "issued_by"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["certs"],
              additionalProperties: false,
            },
          },
        ],
        tool_choice: { type: "tool", name: "record_certs" },
        messages: [
          {
            role: "user",
            content:
              `Product: ${product.slice(0, 400)}\n` +
              `Destination: ${destination || "(not specified)"}\n` +
              `HS code: ${hsCode || "(none)"}`,
          },
        ],
      },
      { timeout: 30_000 }
    );
    const toolUse = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const raw = (toolUse?.input ?? {}) as { certs?: unknown };
    const list = Array.isArray(raw.certs) ? raw.certs : [];
    const certs: RequiredCert[] = [];
    for (const c of list.slice(0, 15)) {
      const o = (c ?? {}) as { name?: unknown; note?: unknown; issued_by?: unknown };
      const name = String(o.name ?? "").trim().slice(0, 120);
      if (!name) continue;
      certs.push({
        name,
        note: String(o.note ?? "").trim().slice(0, 200),
        issuedBy: String(o.issued_by ?? "").trim().slice(0, 120),
      });
    }
    return certs;
  } catch (e) {
    console.error("requiredCertificates_failed", e instanceof Error ? e.name : "unknown");
    return null;
  }
}
