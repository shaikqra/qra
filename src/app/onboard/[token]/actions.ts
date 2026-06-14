"use server";

import { headers } from "next/headers";
import type { ExporterProfileInput, ChaContactInput } from "@/lib/profile-fields";
import { submitInviteProfile, onboardingRateLimited } from "@/lib/onboarding";

type Result = { ok: true } | { ok: false; error: string };

// Public action — the one-time invite token IS the authorization.
export async function submitOnboarding(
  token: string,
  input: ExporterProfileInput,
  chas: ChaContactInput[]
): Promise<Result> {
  try {
    const hdrs = await headers();
    const ip = (hdrs.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
    if (onboardingRateLimited(ip)) {
      return { ok: false, error: "Too many attempts — wait a minute and try again." };
    }
    return await submitInviteProfile(token, input, chas);
  } catch (e) {
    console.error("submitOnboarding failed:", e instanceof Error ? e.name : "unknown");
    return { ok: false, error: "Something went wrong — please try again." };
  }
}
