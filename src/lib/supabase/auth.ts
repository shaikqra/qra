import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createSupabaseAuthClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) {
    throw new Error("Supabase auth env vars not configured");
  }
  const cookieStore = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Server Components can't set cookies; middleware handles refresh.
        }
      },
    },
  });
}

export type OperatorSession = {
  userId: string;
  email: string;
  role: "operator" | "admin";
};

export async function getOperatorSession(): Promise<OperatorSession | null> {
  const supabase = await createSupabaseAuthClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("operators")
    .select("id, email, role")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !data) return null;
  return {
    userId: data.id,
    email: data.email,
    role: data.role as "operator" | "admin",
  };
}
