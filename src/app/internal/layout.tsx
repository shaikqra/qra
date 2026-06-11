import Link from "next/link";
import { redirect } from "next/navigation";
import { getOperatorSession } from "@/lib/supabase/auth";
import { SignOutButton } from "./sign-out-button";

export default async function InternalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getOperatorSession();

  return (
    <div className="min-h-screen flex flex-col bg-zinc-50 text-zinc-900">
      <header className="border-b border-zinc-200 bg-white">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/internal/shipments" className="font-semibold tracking-tight">
              Qra Internal
            </Link>
            {session && (
              <nav className="flex items-center gap-4 text-sm text-zinc-600">
                <Link href="/internal/shipments" className="hover:text-zinc-900">
                  Shipments
                </Link>
                <Link href="/internal/settings" className="hover:text-zinc-900">
                  Settings
                </Link>
              </nav>
            )}
          </div>
          {session && (
            <div className="flex items-center gap-3 text-sm">
              <span className="text-zinc-500">{session.email}</span>
              <SignOutButton />
            </div>
          )}
        </div>
      </header>
      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-8">{children}</main>
    </div>
  );
}

export async function ensureOperator() {
  const session = await getOperatorSession();
  if (!session) redirect("/internal/login");
  return session;
}
