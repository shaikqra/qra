"use server";

import { getOperatorSession } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { assessShipmentStatus, type ShipmentStatus } from "@/lib/ai/tracking-agent";

type StatusResult = { ok: true; status: ShipmentStatus } | { ok: false; error: string };

const RATE_MAX = 6;
const RATE_WINDOW_MS = 60_000;
const buckets = new Map<string, number[]>();
function rateLimited(key: string): boolean {
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  const hits = (buckets.get(key) ?? []).filter((t) => t > cutoff);
  if (hits.length >= RATE_MAX) {
    buckets.set(key, hits);
    return true;
  }
  hits.push(now);
  buckets.set(key, hits);
  return false;
}

// Tracking agent — read a carrier status update into a clean status + ETA, with a
// demurrage-risk note using the awarded carrier's free days. Advisory; nothing stored.
export async function assessStatusAction(shipmentId: string, rawText: string): Promise<StatusResult> {
  const session = await getOperatorSession();
  if (!session) return { ok: false, error: "Not authorized" };
  if (rateLimited(`track:${session.userId}`)) return { ok: false, error: "Please wait a moment and try again." };
  if (!rawText.trim()) return { ok: false, error: "Paste the carrier's update first." };

  const admin = createSupabaseServerClient();
  const { data: ship } = await admin.from("shipments").select("id").eq("id", shipmentId).maybeSingle();
  if (!ship) return { ok: false, error: "Shipment not found." };

  // Free days from the awarded carrier, if any — context for the demurrage check.
  const { data: awarded } = await admin
    .from("freight_quotes")
    .select("free_days")
    .eq("shipment_id", shipmentId)
    .eq("decision", "awarded")
    .limit(1)
    .maybeSingle();
  const freeDays = awarded?.free_days;
  const freeDaysNote =
    freeDays != null ? `Free days at destination (from the awarded carrier): ${freeDays}.` : "";

  const status = await assessShipmentStatus(rawText, freeDaysNote);
  if (!status) return { ok: false, error: "Couldn't read the update — paste the carrier's status text." };
  return { ok: true, status };
}
