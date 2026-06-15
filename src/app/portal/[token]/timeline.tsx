import { PORTAL_STAGES, portalStageIndex, portalStopped } from "@/lib/portal/stages";

// Read-only vertical stepper showing where the exporter's shipment is.
export function Timeline({ status }: { status: string }) {
  if (portalStopped(status)) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">
        This shipment was stopped and is no longer being processed.
      </div>
    );
  }

  const current = portalStageIndex(status);

  return (
    <ol className="flex flex-col">
      {PORTAL_STAGES.map((stage, i) => {
        const done = i < current;
        const active = i === current;
        const last = i === PORTAL_STAGES.length - 1;
        return (
          <li key={stage.key} className="flex items-stretch gap-3">
            <div className="flex flex-col items-center">
              <span
                className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  done
                    ? "bg-emerald-600 text-white"
                    : active
                      ? "bg-emerald-100 text-emerald-700 ring-2 ring-emerald-500"
                      : "bg-zinc-100 text-zinc-400"
                }`}
              >
                {done ? "✓" : i + 1}
              </span>
              {!last && <span className={`w-0.5 grow ${done ? "bg-emerald-500" : "bg-zinc-200"}`} />}
            </div>
            <span
              className={`pt-0.5 pb-5 text-sm ${
                active
                  ? "font-semibold text-emerald-800"
                  : done
                    ? "text-zinc-700"
                    : "text-zinc-400"
              }`}
            >
              {stage.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
