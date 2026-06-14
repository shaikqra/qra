import { redirect } from "next/navigation";
import { createSupabaseAuthClient } from "@/lib/supabase/auth";

// A signed-in customs broker. "Being a CHA" = your login email appears in some
// exporter's cha_contacts list (checked by the current_user_is_cha() function,
// which reads the request JWT). RLS scopes everything else to their own shipments.
export type ChaSession = { userId: string; email: string };

export async function getChaSession(): Promise<ChaSession | null> {
  const supabase = await createSupabaseAuthClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return null;

  const { data, error } = await supabase.rpc("current_user_is_cha");
  if (error || data !== true) return null;

  return { userId: user.id, email: user.email };
}

export async function ensureCha(): Promise<ChaSession> {
  const session = await getChaSession();
  if (!session) redirect("/cha/login");
  return session;
}
