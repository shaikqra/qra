import { createSupabaseServerClient } from "@/lib/supabase/server";
import { screenPartyName } from "./csl";
import { screenLocalName, localListStatus } from "./local-lists";

// What this screening DOES and DOES NOT cover — recorded verbatim on every
// audit note so the record is self-explanatory years later.
const SCREENING_SCOPE = {
  screened_parties: "buyer, consignee, notify-party (when named)",
  lists: "US Consolidated Screening List (~13 US lists incl. OFAC SDN) + UN Security Council Consolidated List + EU Consolidated Financial Sanctions List",
  not_screened: ["India DGFT/SCOMET", "freight forwarder", "carrier", "vessel", "bank"],
};

export type ShipmentParty = { role: string; name: string };

type PartyHit = {
  role: string;
  name: string;
  provider: string;
  matches: { name: string; list: string; score: number | null }[];
};

// Screen one party against every list (US CSL + local UN/etc). Returns its
// matches and any provider that couldn't screen it.
async function screenOneParty(
  party: ShipmentParty
): Promise<{ hits: PartyHit[]; unavailable: string[] }> {
  const hits: PartyHit[] = [];
  const unavailable: string[] = [];

  const us = await screenPartyName(party.name);
  if (us.status === "potential_match") {
    hits.push({ role: party.role, name: party.name, provider: "US CSL", matches: us.matches });
  } else if (us.status === "unchecked") {
    unavailable.push("US CSL");
  }

  const local = await screenLocalName(party.name);
  for (const p of local.uncheckedProviders) unavailable.push(p);
  if (local.matches.length > 0) {
    hits.push({
      role: party.role,
      name: party.name,
      provider: "local",
      matches: local.matches.map((m) => ({
        name: m.full_name,
        list: m.provider,
        score: m.score,
      })),
    });
  }
  return { hits, unavailable };
}

// Screen every named party (buyer + consignee + notify) against all lists and
// record the outcome on the audit trail. Every non-clear outcome fails closed.
export async function screenShipmentParties(
  shipmentId: string,
  parties: ShipmentParty[]
): Promise<{ proceed: boolean; flagged: boolean }> {
  const admin = createSupabaseServerClient();
  const screenedAt = new Date().toISOString();
  // Record how fresh each local list was at screening time, so staleness is
  // provable from the audit record years later.
  const listFreshness = await localListStatus();

  const note = async (newValue: Record<string, unknown>): Promise<boolean> => {
    const { error } = await admin.from("audit_operator_action").insert({
      operator_id: null,
      shipment_id: shipmentId,
      action_type: "note",
      old_value: null,
      new_value: {
        ...newValue,
        scope: SCREENING_SCOPE,
        screened_at: screenedAt,
        local_list_freshness: listFreshness,
      },
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
    const recorded = await note({ event: "sanctions_screening_unavailable", reason: "no_party_name" });
    if (!recorded) console.error("sanctions_unavailable_not_recorded", { shipmentId });
    return { proceed: false, flagged: true };
  }

  const allHits: PartyHit[] = [];
  const unavailable = new Set<string>();
  for (const party of toScreen) {
    const { hits, unavailable: un } = await screenOneParty(party);
    allHits.push(...hits);
    for (const u of un) unavailable.add(u);
  }

  if (allHits.length > 0) {
    const strongest = Math.max(
      ...allHits.flatMap((h) => h.matches.map((m) => m.score ?? 0)),
      0
    );
    const recorded = await note({
      event: "sanctions_potential_match",
      // Tiering is an operator triage signal, never a release decision:
      // weak matches still stop the pipeline and still need a human.
      match_strength: strongest >= 0.95 ? "strong" : "weak",
      flagged_parties: allHits,
    });
    if (!recorded) console.error("sanctions_match_not_recorded", { shipmentId });
    console.log("sanctions_match_flagged", { shipmentId, partyCount: allHits.length });
    return { proceed: false, flagged: true };
  }

  if (unavailable.size > 0) {
    const recorded = await note({
      event: "sanctions_screening_unavailable",
      reason: "lists_unavailable",
      providers: [...unavailable],
    });
    if (!recorded) console.error("sanctions_unavailable_not_recorded", { shipmentId });
    console.log("sanctions_screening_unavailable", { shipmentId });
    return { proceed: false, flagged: true };
  }

  const recorded = await note({
    event: "sanctions_screened_clear",
    parties_screened: toScreen.map((p) => p.role),
  });
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
