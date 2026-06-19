import Link from "next/link";
import Image from "next/image";
import { getChaSession } from "@/lib/supabase/cha-auth";
import { ChaSignOut } from "./cha-signout";

// Per-request + auth-gated — never prerender at build (Supabase reads runtime env).
export const dynamic = "force-dynamic";

// The broker (CHA) seat. Chrome only — each page gates with ensureCha(); the
// login page lives under here too, so the layout itself must not redirect.
export default async function ChaLayout({ children }: { children: React.ReactNode }) {
  const session = await getChaSession();
  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <header className="text-white" style={{ backgroundColor: "#0b1e44" }}>
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/cha" className="inline-flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center overflow-hidden rounded-md bg-white">
              <Image src="/logo.png" alt="Qra" width={48} height={48} className="h-full w-full scale-[1.18] object-cover" />
            </span>
            <span className="text-lg font-semibold tracking-tight">Qra</span>
            <span className="text-xs text-slate-300">· CHA desk</span>
          </Link>
          {session && (
            <div className="flex items-center gap-3 text-sm">
              <span className="text-white/55 hidden sm:inline">{session.email}</span>
              <ChaSignOut />
            </div>
          )}
        </div>
      </header>
      <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
