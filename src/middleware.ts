import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return response;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isInternal = pathname.startsWith("/internal");
  const isLogin = pathname === "/internal/login";

  if (isInternal && !isLogin && !user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/internal/login";
    return NextResponse.redirect(loginUrl);
  }

  if (isLogin && user) {
    const dashUrl = request.nextUrl.clone();
    dashUrl.pathname = "/internal/shipments";
    return NextResponse.redirect(dashUrl);
  }

  // CHA seat: must be signed in. We don't redirect signed-in users away from the
  // broker login (a logged-in non-broker would loop) — the /cha layout checks
  // the broker role and shows a friendly message instead.
  const isCha = pathname.startsWith("/cha");
  const isChaLogin = pathname === "/cha/login";
  if (isCha && !isChaLogin && !user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/cha/login";
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/whatsapp|api/health|auth/callback).*)",
  ],
};
