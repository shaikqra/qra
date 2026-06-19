export type Tracking = {
  vessel?: string;
  milestone?: string;
  eta?: string;
  summary?: string;
  riskNote?: string;
};

// The Tracking agent's latest read of the carrier's update, in the exporter
// console: a clean status + ETA, with a demurrage-risk flag. Advisory.
export function TrackingCard({ tracking }: { tracking: Tracking | null }) {
  if (!tracking || !tracking.summary) return null;
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Shipment tracking</h2>
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="text-sm font-semibold text-slate-800">{tracking.summary}</div>
        <div className="mt-2 grid grid-cols-1 gap-1 text-xs text-slate-600 sm:grid-cols-3">
          {tracking.vessel ? (
            <div>
              <span className="text-slate-400">Vessel:</span> {tracking.vessel}
            </div>
          ) : null}
          {tracking.milestone ? (
            <div>
              <span className="text-slate-400">Status:</span> {tracking.milestone}
            </div>
          ) : null}
          {tracking.eta ? (
            <div>
              <span className="text-slate-400">ETA:</span> {tracking.eta}
            </div>
          ) : null}
        </div>
        {tracking.riskNote ? (
          <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            ⚠️ {tracking.riskNote}
          </div>
        ) : null}
      </div>
    </section>
  );
}
