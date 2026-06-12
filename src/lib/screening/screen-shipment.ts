import { createSupabaseServerClient } from "@/lib/supabase/server";
import { screenPartyName } from "./csl";

// What this screening DOES and DOES NOT cover — recorded verbatim on every
// audit note so the record is self-explanatory years later.
const SCREENING_SCOPE = {
  screened_parties: "buyer_name only",
  lists: "US Consolidated Screening List (~13 US lists incl. OFAC SDN)",
  not_screened: ["EU consolidated", "UN consolidated", "India DGFT/SCOMET", "consignee", "notify party"],
};

// Screen a shipment's buyer against denied-party lists and record the outcome
// on the audit trail. Returns whether the agent may proceed. Every non-clear
// outcome fails closed — including screening not being configured: documents
// must never auto-send unscreened.
export async function screenShipmentBuyer(
  shipmentId: string,
  buyerName: string
): Promise<{ proceed: boolean; flagged: boolean }> {
  const admin = createSupabaseServerClient();
  const result = await screenPartyName(buyerName);
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

  if (result.status === "clear") {
    const recorded = await note({
      event: "sanctions_screened_clear",
      provider: result.provider,
    });
    // A clear that we failed to record is not a clear we can stand behind —
    // the audit row IS the compliance artifact.
    if (!recorded) {
      console.error("sanctions_clear_not_recorded", { shipmentId });
      return { proceed: false, flagged: true };
    }
    return { proceed: true, flagged: false };
  }

  if (result.status === "potential_match") {
    const strongest = Math.max(...result.matches.map((m) => m.score ?? 0));
    await note({
      event: "sanctions_potential_match",
      provider: result.provider,
      // Tiering is a triage signal for the operator, never a release decision:
      // weak matches still stop the pipeline and still need a human.
      match_strength: strongest >= 95 ? "strong" : "weak",
      matches: result.matches,
    });
    console.log("sanctions_match_flagged", {
      shipmentId,
      matchCount: result.matches.length,
    });
    return { proceed: false, flagged: true };
  }

  // Unchecked — either screening isn't configured or the lookup failed.
  // Both fail closed: an unscreened buyer never auto-sends.
  await note({
    event: "sanctions_screening_unavailable",
    reason: result.reason,
  });
  console.log("sanctions_screening_unavailable", { shipmentId, reason: result.reason });
  return { proceed: false, flagged: true };
}
