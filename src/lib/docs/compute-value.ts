// Deterministic computation of a total invoice value from a stated unit price.
// No AI — pure arithmetic, and only when the quantity unit and the price basis
// unit match unambiguously. If anything is uncertain it returns null and the
// agent simply asks the customer instead of guessing a number.

function parseNum(v: string): number | null {
  let c = v.replace(/\s+/g, "");
  // Accept clean comma thousands-grouping ("53,352" / "1,635.00").
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(c)) c = c.replace(/,/g, "");
  // Refuse ambiguous European thousands-dot like "1.000" or "53.352" — three
  // digits after a single dot could be 1000 or 1.000. Don't guess; the caller
  // falls back to asking the customer. Blank beats a 1000x-wrong total.
  if (/^\d+\.\d{3}$/.test(c)) return null;
  if (!/^\d+(\.\d+)?$/.test(c)) return null;
  const n = Number(c);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Canonical token for a weight/quantity unit, for safe comparison.
function normUnit(u: string): string {
  const s = u.trim().toLowerCase().replace(/[.\s]/g, "");
  if (["kg", "kgs", "kilogram", "kilograms"].includes(s)) return "kg";
  if (["mt", "ton", "tons", "tonne", "tonnes", "metricton", "metrictons"].includes(s)) return "mt";
  if (["pc", "pcs", "piece", "pieces", "unit", "units", "nos", "no"].includes(s)) return "pcs";
  if (["lb", "lbs", "pound", "pounds"].includes(s)) return "lb";
  return s;
}

export type ComputedValue = { amount: string; explanation: string };

// Returns a proposed total invoice value, computed cleanly, or null.
export function computeProposedValue(d: Record<string, string>): ComputedValue | null {
  const qty = parseNum(d["quantity"] ?? "");
  const qtyUnit = normUnit(d["quantity_unit"] ?? "");
  const price = parseNum(d["unit_price"] ?? "");
  const basisRaw = (d["unit_price_basis"] ?? "").trim();
  if (qty === null || price === null || !basisRaw) return null;

  // basis like "1000 kg" / "kg" / "MT": optional leading number (default 1) + unit.
  const m = basisRaw.match(/^([\d.,]+)?\s*([a-zA-Z]+)/);
  if (!m) return null;
  const basisQty = m[1] ? parseNum(m[1]) : 1;
  const basisUnit = normUnit(m[2] ?? "");
  if (basisQty === null || basisQty <= 0) return null;

  // Units must match to multiply safely; if either is unknown, don't guess.
  if (!qtyUnit || !basisUnit || qtyUnit !== basisUnit) return null;

  const total = (qty * price) / basisQty;
  if (!Number.isFinite(total) || total <= 0) return null;
  const amount = total.toFixed(2);

  const currency = (d["value_currency"] ?? "").trim().toUpperCase();
  const cur = /^[A-Z]{3}$/.test(currency) ? `${currency} ` : "";
  const basisLabel = basisQty === 1 ? basisUnit : `${basisQty} ${basisUnit}`;
  const explanation = `${qty} ${qtyUnit} × ${cur}${price} per ${basisLabel} = ${cur}${amount}`;
  return { amount, explanation };
}
