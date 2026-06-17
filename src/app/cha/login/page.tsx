import { LoginForm } from "@/app/internal/login/login-form";

// Auth page — render at request time, never prerendered at build (the Supabase
// client reads env that only exists at runtime / in the deployment env).
export const dynamic = "force-dynamic";

// CHA sign-in — same magic-link mechanism as the operator login, but it
// redirects into /cha after the link is used.
export default async function ChaLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  return (
    <div className="max-w-md mx-auto mt-10">
      <h1 className="text-2xl font-semibold tracking-tight mb-2">CHA sign-in</h1>
      <p className="text-sm text-zinc-600 mb-6">
        Enter the email your exporter has on file for you and we&apos;ll send a one-tap sign-in
        link.
      </p>
      <LoginForm initialError={params.error} next="/cha" />
      <p className="text-xs text-zinc-400 mt-6">
        Don&apos;t have access yet? Ask your exporter to add your email as their CHA in Qra.
      </p>
    </div>
  );
}
