import { LoginForm } from "./login-form";

// Auth page — render at request time, never prerendered at build.
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  return (
    <div className="max-w-md mx-auto mt-16">
      <h1 className="text-2xl font-semibold tracking-tight mb-2">Operator sign-in</h1>
      <p className="text-sm text-zinc-600 mb-6">
        Enter your email and we&apos;ll send you a magic link.
      </p>
      <LoginForm initialError={params.error} />
    </div>
  );
}
