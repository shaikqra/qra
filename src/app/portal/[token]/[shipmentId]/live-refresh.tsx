"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Live updates for the agent cards. While an agent is actively working (reading,
// compliance, drafting, filing), poll the server every few seconds so the cards
// advance on their own. Stops the moment nothing's actively working — the next
// move then waits on a human, whose action refreshes the page anyway. This is the
// stack-fit way to get the Build Bible's "live agent updates" (line 466) on Vercel
// serverless; a true WebSocket push needs a persistent backend service (later).
export function LiveRefresh({ active, intervalMs = 4000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs, router]);
  return null;
}
