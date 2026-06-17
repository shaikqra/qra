import Link from "next/link";
import { getChaSession } from "@/lib/supabase/cha-auth";
import { ChaSignOut } from "./cha-signout";

// Per-request + auth-gated — never prerender at build (Supabase reads runtime env).
export const dynamic = "force-dynamic";

// The broker (CHA) seat. Chrome only — each page gates with ensureCha(); the
// login page lives under here too, so the layout itself must not redirect.
export default async function ChaLayout({ children }: { children: React.ReactNode }) {
  const session = await getChaSession();
  return (
    <div className="min-h-screen flex flex-col bg-zinc-50 text-zinc-900">
      <header className="bg-emerald-900 text-white">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/cha" className="font-extrabold tracking-tight">
            Q<span className="text-emerald-300">ra</span>
            <span className="font-normal text-emerald-200/80 text-sm ml-2">· CHA desk</span>
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
