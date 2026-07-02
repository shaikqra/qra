import Anthropic from "@anthropic-ai/sdk";

// Qra's Required-Documents agent. Trade Graph capability #2: list the shipping /
// trade DOCUMENTS a lane (product + destination) needs BEYOND Qra's standard set
// (commercial invoice, packing list, certificate of origin, export declaration /
// shipping bill) — e.g. a legalized/embassy-attested CoO, phytosanitary certificate,
// ISPM-15 treatment certificate, health certificate, import-licence supporting
// docs. ADVISORY — Qra issues/files nothing and never invents a citation; the AI
// draft carries NO source (only an analyst adds one at verification). Same
// {name, note, issuedBy} shape as RequiredCert so the analyst verifies both alike.

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export type RequiredDoc = { name: string; note: string; issuedBy: string };

const SYSTEM_PROMPT = `You are Qra's Required-Documents agent for Indian exporters. List the shipping / trade DOCUMENTS a shipment of the given product to the given destination typically requires, BEYOND the standard set Qra already prepares.

Rules:
- The standard set is already covered — do NOT re-list it: commercial invoice, packing list, certificate of origin, export declaration / shipping bill. Only surface the EXTRA documents this specific product + destination lane needs.
- ADVISORY only — Qra issues and files NOTHING. For each document, name who provides / issues it (e.g. a plant-quarantine office for a phytosanitary certificate, a treatment provider for ISPM-15 (heat-treatment or fumigation — heat-treated wood needs no fumigation), a Chamber of Commerce or the buyer's embassy for legalization / attestation, an accredited lab for a health certificate, the destination's import authority).
- Cover BOTH destination-country import requirements (e.g. legalized / embassy-attested CoO for many GCC buyers, a health or phytosanitary certificate for the EU, a fumigation certificate for wood packaging) AND any India export-side supporting documents that are NOT in the standard set.
- Surface CONDITIONAL documents too, with the condition in the note (e.g. "If wood packaging is used: ISPM-15 treatment certificate (heat-treatment or fumigation)"; "If the buyer's L/C requires it: legalized commercial invoice").
- Include only documents genuinely relevant to THIS product + destination. Do not pad or invent document names.
- Keep each note to one short, plain line. This is a starting point to confirm with the exporter's CHA / buyer, never a final checklist.`;

export async function requiredDocuments(
  product: string,
  destination: string,
  hsCode: string
): Promise<RequiredDoc[] | null> {
  if (!product.trim()) return null;
  try {
    const message = await anthropic.messages.create(
      {
        model: "claude-sonnet-4-6",
        max_tokens: 700,
        system: SYSTEM_PROMPT,
        tools: [
          {
            name: "record_docs",
            description: "Record the extra documents the shipment likely needs.",
            input_schema: {
              type: "object",
              properties: {
                docs: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string", description: "the document name" },
                      note: { type: "string", description: "one short line: why / when it's needed" },
                      issued_by: { type: "string", description: "who provides / issues it" },
                    },
                    required: ["name", "note", "issued_by"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["docs"],
              additionalProperties: false,
            },
          },
        ],
        tool_choice: { type: "tool", name: "record_docs" },
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
    const raw = (toolUse?.input ?? {}) as { docs?: unknown };
    const list = Array.isArray(raw.docs) ? raw.docs : [];
    const docs: RequiredDoc[] = [];
    for (const c of list.slice(0, 15)) {
      const o = (c ?? {}) as { name?: unknown; note?: unknown; issued_by?: unknown };
      const name = String(o.name ?? "").trim().slice(0, 120);
      if (!name) continue;
      docs.push({
        name,
        note: String(o.note ?? "").trim().slice(0, 200),
        issuedBy: String(o.issued_by ?? "").trim().slice(0, 120),
      });
    }
    return docs;
  } catch (e) {
    console.error("requiredDocuments_failed", e instanceof Error ? e.name : "unknown");
    return null;
  }
}
