import { createSupabaseServerClient } from "@/lib/supabase/server";
import { screenPartyName, type ScreeningResult } from "./csl";

// What this screening DOES and DOES NOT cover — recorded verbatim on every
// audit note so the record is self-explanatory years later.
const SCREENING_SCOPE = {
  screened_parties: "buyer, consignee, notify-party (when named)",
  lists: "US Consolidated Screening List (~13 US lists incl. OFAC SDN)",
  not_screened: ["EU consolidated", "UN consolidated", "India DGFT/SCOMET", "bank"],
};

export type ShipmentParty = { role: string; name: string };

// Screen every named party on a shipment (buyer + consignee + notify, etc.)
// against denied-party lists and record the outcome on the audit trail.
// Returns whether the agent may proceed. Every non-clear outcome fails closed —
// a match on ANY party, a lookup error (when configured), or screening not
// configured all stop the pipeline: documents never auto-send unscreened.
export async function screenShipmentParties(
  shipmentId: string,
  parties: ShipmentParty[]
): Promise<{ proceed: boolean; flagged: boolean }> {
  const admin = createSupabaseServerClient();
  const screenedAt = new Date().toISOString();

  const note = async (newValue: Record<string, unknown>): Promise<boolean> => {
    const { error } = await admin.from("audit_operator_action").insert({
      operator_id: null,
      shipment_id: shipmentId,
      action_type: "note",
      old_value: null,
      new_value: { ...newValue, scope: SCREENING_SCOPE, screened_at: screenedAt },
    });
    return !error;
  };

  // Distinct, non-empty party names (case-insensitive dedupe).
  const seen = new Set<string>();
  const toScreen = parties.filter((p) => {
    const n = p.name.trim().toLowerCase();
    if (!n || seen.has(n)) return false;
    seen.add(n);
    return true;
  });

  if (toScreen.length === 0) {
    // No screenable party name — cannot vouch for the shipment.
    await note({ event: "sanctions_screening_unavailable", reason: "no_party_name" });
    return { proceed: false, flagged: true };
  }

  const matches: { role: string; name: string; result: ScreeningResult }[] = [];
  let anyUnavailable = false;
  for (const party of toScreen) {
    const result = await screenPartyName(party.name);
    if (result.status === "potential_match") {
      matches.push({ role: party.role, name: party.name, result });
    } else if (result.status === "unchecked") {
      anyUnavailable = true;
    }
  }

  if (matches.length > 0) {
    const strongest = Math.max(
      ...matches.flatMap((m) =>
        m.result.status === "potential_match" ? m.result.matches.map((x) => x.score ?? 0) : [0]
      )
    );
    await note({
      event: "sanctions_potential_match",
      provider: "trade.gov CSL (US lists incl. OFAC SDN)",
      // Tiering is a triage signal for the operator, never a release decision:
      // weak matches still stop the pipeline and still need a human.
      match_strength: strongest >= 95 ? "strong" : "weak",
      flagged_parties: matches.map((m) => ({
        role: m.role,
        name: m.name,
        matches: m.result.status === "potential_match" ? m.result.matches : [],
      })),
    });
    console.log("sanctions_match_flagged", { shipmentId, partyCount: matches.length });
    return { proceed: false, flagged: true };
  }

  if (anyUnavailable) {
    // Some party could not be screened (not configured, or lookup error).
    // Fail closed — never auto-send a shipment with an unscreened party.
    await note({ event: "sanctions_screening_unavailable", reason: "lookup_unavailable" });
    console.log("sanctions_screening_unavailable", { shipmentId });
    return { proceed: false, flagged: true };
  }

  const recorded = await note({
    event: "sanctions_screened_clear",
    provider: "trade.gov CSL (US lists incl. OFAC SDN)",
    parties_screened: toScreen.map((p) => p.role),
  });
  // A clear we failed to record is not a clear we can stand behind — the audit
  // row IS the compliance artifact.
  if (!recorded) {
    console.error("sanctions_clear_not_recorded", { shipmentId });
    return { proceed: false, flagged: true };
  }
  return { proceed: true, flagged: false };
}

// Build the party list from a shipment's extracted fields.
export function partiesFromExtracted(d: Record<string, string>): ShipmentParty[] {
  return [
    { role: "buyer", name: (d["buyer_name"] ?? "").trim() },
    { role: "consignee", name: (d["consignee_name"] ?? "").trim() },
    { role: "notify_party", name: (d["notify_party_name"] ?? "").trim() },
  ].filter((p) => p.name);
}
