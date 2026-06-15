import { type ReactNode } from "react";

// The /portal tree is token-gated and reads cookies/headers — never prerender it.
export const dynamic = "force-dynamic";

export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="bg-emerald-900 text-white">
        <div className="mx-auto max-w-3xl px-4 py-3 flex items-baseline gap-2">
          <span className="text-lg font-bold tracking-tight">
            Q<span className="text-emerald-300">ra</span>
          </span>
          <span className="text-xs text-emerald-200/80">· Your export shipments</span>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
      <footer className="mx-auto max-w-3xl px-4 pb-8 text-xs text-zinc-400">
        Read-only view. To approve documents or send details, reply on WhatsApp.
      </footer>
    </div>
  );
}
