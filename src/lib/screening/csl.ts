// Denied-party screening against the US Consolidated Screening List (CSL) —
// trade.gov's merged feed of ~13 US lists including the OFAC SDN list.
// Deterministic lookup, no AI anywhere in this decision. Coverage is US lists
// only in v1 — a "clear" here never implies EU/UN clearance.

export type ScreeningMatch = {
  name: string;
  list: string;
  score: number | null;
};

export type ScreeningResult =
  | { status: "clear"; provider: string }
  | { status: "potential_match"; provider: string; matches: ScreeningMatch[] }
  | { status: "unchecked"; provider: string; reason: "not_configured" | "error" };

const PROVIDER = "trade.gov CSL (US lists incl. OFAC SDN)";

export async function screenPartyName(name: string): Promise<ScreeningResult> {
  const apiKey = process.env.TRADE_GOV_API_KEY?.trim();
  if (!apiKey) return { status: "unchecked", provider: PROVIDER, reason: "not_configured" };

  // An un-named party cannot be screened — that's "unchecked", never "clear".
  const trimmed = name.trim();
  if (!trimmed) return { status: "unchecked", provider: PROVIDER, reason: "error" };

  try {
    const url =
      "https://data.trade.gov/consolidated_screening_list/v1/search?fuzzy_name=true&name=" +
      encodeURIComponent(trimmed.slice(0, 200));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(url, {
      headers: { "subscription-key": apiKey },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      // Status code only — never the queried name.
      console.error("sanctions_screening_http_error", { status: res.status });
      return { status: "unchecked", provider: PROVIDER, reason: "error" };
    }

    const data = (await res.json()) as {
      total?: number;
      results?: {
        name?: string;
        score?: number;
        source?: { full_name?: string; abbreviation?: string } | string;
      }[];
    };

    // Only trust "clear" when the body actually looks like a CSL response.
    // An unrecognised shape must fail closed, never read as zero hits.
    const hasTotal = typeof data.total === "number";
    const hasResults = Array.isArray(data.results);
    if (!hasTotal && !hasResults) {
      // Key names only — never the queried name or any value.
      console.error("sanctions_screening_bad_shape", { keys: Object.keys(data ?? {}) });
      return { status: "unchecked", provider: PROVIDER, reason: "error" };
    }

    const results = hasResults ? (data.results ?? []) : [];

    // "clear" needs positive evidence of zero hits. If the API reports hits
    // (total > 0) but we have no usable, populated results array — missing,
    // non-array, or an empty array that contradicts the total — fail closed.
    // Never declare a party clear while the API is reporting matches.
    if ((data.total ?? 0) > 0 && results.length === 0) {
      // Count only — never the queried name.
      console.error("sanctions_screening_hits_no_results", { total: data.total });
      return { status: "unchecked", provider: PROVIDER, reason: "error" };
    }

    if (results.length === 0) return { status: "clear", provider: PROVIDER };

    const matches: ScreeningMatch[] = results.slice(0, 10).map((r) => ({
      name: typeof r.name === "string" ? r.name : "(unnamed entry)",
      list:
        typeof r.source === "string"
          ? r.source
          : r.source?.abbreviation ?? r.source?.full_name ?? "unknown list",
      score: typeof r.score === "number" ? r.score : null,
    }));
    return { status: "potential_match", provider: PROVIDER, matches };
  } catch (err) {
    console.error("sanctions_screening_failed", {
      name: err instanceof Error ? err.name : "unknown",
    });
    return { status: "unchecked", provider: PROVIDER, reason: "error" };
  }
}
