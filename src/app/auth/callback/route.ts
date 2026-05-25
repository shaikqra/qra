import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAuthClient } from "@/lib/supabase/auth";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/internal/shipments";

  if (!code) {
    return NextResponse.redirect(new URL("/internal/login?error=missing_code", request.url));
  }

  const supabase = await createSupabaseAuthClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      new URL("/internal/login?error=exchange_failed", request.url)
    );
  }

  return NextResponse.redirect(new URL(next, request.url));
}
