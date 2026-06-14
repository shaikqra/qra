"use client";

import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export function ChaSignOut() {
  const router = useRouter();
  async function signOut() {
    await createSupabaseBrowserClient().auth.signOut();
    router.push("/cha/login");
    router.refresh();
  }
  return (
    <button onClick={signOut} className="text-white/70 hover:text-white text-sm">
      Sign out
    </button>
  );
}
