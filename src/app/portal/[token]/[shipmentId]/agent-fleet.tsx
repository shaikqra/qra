import type { AgentCard } from "@/lib/portal/agent-fleet";

// Agent cards in the exporter console: what the fleet is doing on this shipment.
// Done = green check, Working = amber pulse, Review = indigo, Pending = greyed.
const STYLES: Record<AgentCard["state"], { dot: string; text: string; badge: string; label: string }> = {
  done: { dot: "bg-emerald-500", text: "text-slate-800", badge: "text-emerald-700", label: "✓ done" },
  working: { dot: "bg-amber-500 animate-pulse", text: "text-slate-900", badge: "text-amber-700", label: "● working" },
  review: { dot: "bg-indigo-500", text: "text-slate-800", badge: "text-indigo-700", label: "● in review" },
  pending: { dot: "bg-slate-300", text: "text-slate-500", badge: "text-slate-400", label: "up next" },
  later: { dot: "bg-slate-200", text: "text-slate-400", badge: "text-slate-300", label: "later" },
};

export function AgentFleet({ cards }: { cards: AgentCard[] }) {
  if (cards.length === 0) return null;
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Your agents</h2>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {cards.map((c) => {
          const s = STYLES[c.state];
          return (
            <div
              key={c.key}
              className={`flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3.5 ${
                c.state === "pending" || c.state === "later" ? "opacity-70" : ""
              }`}
            >
              <span className="text-lg">{c.icon}</span>
              <div className="min-w-0">
                <div className={`text-sm font-semibold ${s.text}`}>{c.name}</div>
                <div className="truncate text-xs text-slate-500">{c.note}</div>
              </div>
              <div className="ml-auto flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${s.dot}`} />
                <span className={`text-[11px] font-semibold ${s.badge}`}>{s.label}</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
