import type { DocReviewFlag } from "@/lib/ai/review-documents";

// §12 facsimile: the document's data drawn as an invoice-style sheet, with any
// field the AI flagged highlighted in place. It renders from the shipment data
// (not a second copy of the PDF layout engine) — enough to SEE the flagged field
// on the document and fix it.

const FIELD_LABELS: Record<string, string> = {
  buyer_name: "Buyer",
  consignee_name: "Consignee",
  notify_party_name: "Notify party",
  product_description: "Goods",
  hs_code: "HS code",
  incoterm: "Incoterm",
  quantity: "Quantity",
  quantity_unit: "Unit",
  value_currency: "Currency",
  value_amount: "Value",
  port_of_loading: "Port of loading",
  port_of_discharge: "Port of discharge",
  net_weight: "Net weight",
  gross_weight: "Gross weight",
  number_of_packages: "Packages",
};

const RENDER_KEYS = Object.keys(FIELD_LABELS);

// Loosely map each flag to a data field it's about (rule flags carry the exact
// key; AI flags carry a description we keyword-match).
const LABEL_TO_KEY: [string, string][] = [
  ["hs", "hs_code"],
  ["buyer", "buyer_name"],
  ["consignee", "consignee_name"],
  ["notify", "notify_party_name"],
  ["incoterm", "incoterm"],
  ["gross weight", "gross_weight"],
  ["net weight", "net_weight"],
  ["package", "number_of_packages"],
  ["value", "value_amount"],
  ["currency", "value_currency"],
  ["quantity", "quantity"],
  ["discharge", "port_of_discharge"],
  ["loading", "port_of_loading"],
  ["product", "product_description"],
  ["goods", "product_description"],
];

export function flaggedKeys(flags: DocReviewFlag[]): Set<string> {
  const keys = new Set<string>();
  for (const f of flags) {
    const fl = (f.field ?? "").toLowerCase().trim();
    if (!fl) continue;
    // Exact data-key match (rule flags carry the real key) — most reliable.
    if (RENDER_KEYS.includes(fl)) {
      keys.add(fl);
      continue;
    }
    // AI flags carry a description — match on whole WORDS, not substrings, so
    // "unloading" can't match "loading" and "valuable" can't match "value".
    const words = new Set(fl.split(/[^a-z]+/).filter(Boolean));
    for (const [kw, key] of LABEL_TO_KEY) {
      if (kw.split(" ").every((w) => words.has(w))) keys.add(key);
    }
  }
  return keys;
}

export function DocFacsimile({ data, flagged }: { data: Record<string, string>; flagged: Set<string> }) {
  const Field = ({ k }: { k: string }) => {
    const v = (data[k] ?? "").trim();
    const on = flagged.has(k);
    return (
      <div className={`rounded px-2 py-1 ${on ? "bg-red-50 ring-1 ring-red-300" : ""}`}>
        <div className="text-[10px] uppercase tracking-wide text-zinc-400">
          {FIELD_LABELS[k] ?? k}
          {on && " ⚠"}
        </div>
        <div className={`text-sm ${on ? "font-semibold text-red-700" : "text-zinc-800"}`}>{v || "—"}</div>
      </div>
    );
  };

  return (
    <div className="rounded-lg border border-zinc-300 bg-white p-4">
      <div className="mb-3 border-b border-zinc-200 pb-2 text-center">
        <div className="text-sm font-bold tracking-wide text-zinc-900">COMMERCIAL INVOICE</div>
        <div className="text-[10px] text-zinc-400">preview from shipment data · flagged fields highlighted</div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {RENDER_KEYS.map((k) => (
          <Field key={k} k={k} />
        ))}
      </div>
    </div>
  );
}
