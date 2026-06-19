import { type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";

// The /portal tree is token-gated and reads cookies/headers — never prerender it.
export const dynamic = "force-dynamic";

export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="text-white" style={{ backgroundColor: "#0b1e44" }}>
        <div className="mx-auto flex max-w-6xl items-center gap-2.5 px-5 py-3.5">
          <Link href="/" className="inline-flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center overflow-hidden rounded-md bg-white">
              <Image src="/logo.png" alt="Qra" width={48} height={48} className="h-full w-full scale-[1.18] object-cover" />
            </span>
            <span className="text-lg font-semibold tracking-tight">Qra</span>
          </Link>
          <span className="text-xs text-slate-300">· Your export console</span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-5">{children}</main>
      <footer className="mx-auto max-w-6xl px-5 pb-8 text-xs text-slate-400">
        Qra prepares and checks your documents; you approve every step. The AI proposes · rules check · you approve.
      </footer>
    </div>
  );
}
