import { headers } from "next/headers";
import { validateInvite, onboardingRateLimited } from "@/lib/onboarding";
import { OnboardForm } from "./onboard-form";

export const dynamic = "force-dynamic";

export default async function OnboardPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const hdrs = await headers();
  const ip = (hdrs.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  const invite = onboardingRateLimited(ip) ? null : await validateInvite(token);

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="max-w-3xl mx-auto px-6 h-14 flex items-center">
          <span className="text-lg font-semibold tracking-tight">Qra</span>
          <span className="ml-3 text-sm text-zinc-500">Exporter setup</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10">
        {invite ? (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">
              Set up your company on Qra
            </h1>
            <p className="mt-2 text-sm text-zinc-600 max-w-xl">
              Fill this in once — these details go on every export document Qra prepares for
              you (invoices, packing lists, certificates). Takes about 10 minutes. Skip
              anything you don&apos;t have handy; it can be added later.
            </p>
            <div className="mt-8 rounded-xl border border-zinc-200 bg-white p-6">
              <OnboardForm token={token} />
            </div>
            <p className="mt-4 text-xs text-zinc-400">
              This is a secure one-time link. Your details are used only to prepare your
              export documents and are never shared.
            </p>
          </>
        ) : (
          <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center">
            <div className="text-3xl mb-2">⏰</div>
            <h1 className="text-xl font-semibold">This link has expired or was already used</h1>
            <p className="mt-2 text-sm text-zinc-600">
              Ask your Qra contact to send you a fresh setup link — it takes them one click.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
