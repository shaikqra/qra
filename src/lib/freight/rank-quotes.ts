// Deterministic, explainable ranking of carrier quotes — NO fabricated
// "reliability" scores, no invented FX. Live quotes (open or being negotiated)
// are ranked: lowest rate first, then shorter transit, then more free days.
// Rejected quotes drop out; an awarded quote closes the gate. The recommendation
// is a proposal — the exporter decides at G4.

export type FreightQuote = {
  id: string;
  carrierName: string;
  rateAmount: number | null;
  rateCurrency: string;
  transitDays: number | null;
  freeDays: number | null;
  surcharges: string;
  validity: string;
  decision: string; // "" | "awarded" | "rejected" | "negotiate"
  negotiateTarget: number | null;
};

export type RankedQuote = FreightQuote & { rank: number };

export type RankedQuotes = {
  ranked: RankedQuote[]; // live quotes (open/negotiate), ranked
  awarded: FreightQuote | null; // the awarded carrier, if the gate is decided
  recommendationId: string | null; // best live quote (null once awarded)
  reason: string;
};

export function rankFreightQuotes(quotes: FreightQuote[]): RankedQuotes {
  const awarded = quotes.find((q) => q.decision === "awarded") ?? null;
  const live = quotes.filter((q) => q.decision !== "awarded" && q.decision !== "rejected");

  const rated = live.filter((q) => q.rateAmount !== null);
  const unrated = live.filter((q) => q.rateAmount === null);

  rated.sort((a, b) => {
    if (a.rateAmount! !== b.rateAmount!) return a.rateAmount! - b.rateAmount!;
    const at = a.transitDays ?? Infinity;
    const bt = b.transitDays ?? Infinity;
    if (at !== bt) return at - bt;
    return (b.freeDays ?? 0) - (a.freeDays ?? 0);
  });

  const ranked: RankedQuote[] = [...rated, ...unrated].map((q, i) => ({ ...q, rank: i + 1 }));
  const top = awarded ? null : rated[0] ?? null;

  let reason = "";
  if (awarded) {
    const rate = [awarded.rateCurrency, awarded.rateAmount].filter((v) => v !== "" && v !== null).join(" ");
    reason = `Freight awarded: ${awarded.carrierName || "this carrier"}${rate ? ` (${rate})` : ""}.`;
  } else if (top) {
    const currencies = new Set(rated.map((q) => q.rateCurrency).filter(Boolean));
    const mixed = currencies.size > 1;
    const rate = [top.rateCurrency, top.rateAmount].filter((v) => v !== "" && v !== null).join(" ");
    const transit = top.transitDays !== null ? `, ${top.transitDays}-day transit` : "";
    reason =
      `Recommended: ${top.carrierName || "this carrier"} — lowest rate (${rate})${transit}.` +
      (mixed ? " Note: quotes are in different currencies — compare carefully (no FX applied)." : "");
  } else if (live.length > 0) {
    reason = "No quote has a numeric rate yet — can't rank. Add the carriers' rates.";
  }

  return { ranked, awarded, recommendationId: top?.id ?? null, reason };
}

// The counter target when the exporter chooses to negotiate: ~1.5% below the
// quoted rate (the Build Bible's x0.985 step), rounded. null if no numeric rate.
export function negotiateTargetFor(rate: number | null): number | null {
  if (rate === null) return null;
  return Math.round(rate * 0.985);
}
