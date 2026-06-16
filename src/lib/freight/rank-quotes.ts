// Deterministic, explainable ranking of carrier quotes — NO fabricated
// "reliability" scores. Quotes with a numeric rate are ranked: lowest rate first,
// then shorter transit, then more free days. Quotes without a rate sink below the
// rated ones. If rated quotes are in different currencies, we flag it — we never
// invent an FX conversion. The ranking is a recommendation; the exporter decides
// at G4.

export type FreightQuote = {
  id: string;
  carrierName: string;
  rateAmount: number | null;
  rateCurrency: string;
  transitDays: number | null;
  freeDays: number | null;
  surcharges: string;
  validity: string;
};

export type RankedQuote = FreightQuote & { rank: number };

export type RankedQuotes = {
  ranked: RankedQuote[];
  recommendationId: string | null;
  reason: string;
};

export function rankFreightQuotes(quotes: FreightQuote[]): RankedQuotes {
  const rated = quotes.filter((q) => q.rateAmount !== null);
  const unrated = quotes.filter((q) => q.rateAmount === null);

  rated.sort((a, b) => {
    if (a.rateAmount! !== b.rateAmount!) return a.rateAmount! - b.rateAmount!;
    const at = a.transitDays ?? Infinity;
    const bt = b.transitDays ?? Infinity;
    if (at !== bt) return at - bt;
    return (b.freeDays ?? 0) - (a.freeDays ?? 0);
  });

  const ranked: RankedQuote[] = [...rated, ...unrated].map((q, i) => ({ ...q, rank: i + 1 }));
  const top = rated[0] ?? null;

  let reason = "";
  if (top) {
    const currencies = new Set(rated.map((q) => q.rateCurrency).filter(Boolean));
    const mixed = currencies.size > 1;
    const rate = [top.rateCurrency, top.rateAmount].filter((v) => v !== "" && v !== null).join(" ");
    const transit = top.transitDays !== null ? `, ${top.transitDays}-day transit` : "";
    reason =
      `Recommended: ${top.carrierName || "this carrier"} — lowest rate (${rate})${transit}.` +
      (mixed ? " Note: quotes are in different currencies — compare carefully (no FX applied)." : "");
  } else if (quotes.length > 0) {
    reason = "No quote has a numeric rate yet — can't rank. Add the carriers' rates.";
  }

  return { ranked, recommendationId: top?.id ?? null, reason };
}
