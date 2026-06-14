import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAuthClient } from "@/lib/supabase/auth";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  // Only ever redirect to an internal path. `next` is attacker-controllable, so
  // resolve it and confirm it stays on our own origin — otherwise it's an open
  // redirect (a phishing vector on the sign-in surface).
  const rawNext = url.searchParams.get("next") ?? "/internal/shipments";
  let next = "/internal/shipments";
  try {
    const cand = new URL(rawNext, url.origin);
    if (cand.origin === url.origin) next = cand.pathname + cand.search;
  } catch {
    // malformed next — keep the safe default
  }
  // Send sign-in errors back to whichever login the link came from.
  const loginPath = next.startsWith("/cha") ? "/cha/login" : "/internal/login";

  if (!code) {
    return NextResponse.redirect(new URL(`${loginPath}?error=missing_code`, request.url));
  }

  const supabase = await createSupabaseAuthClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(new URL(`${loginPath}?error=exchange_failed`, request.url));
  }

  return NextResponse.redirect(new URL(next, request.url));
}
