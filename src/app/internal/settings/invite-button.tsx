"use client";

import { useState, useTransition } from "react";
import { inviteCustomerToOnboard } from "./actions";

// Generates a one-time onboarding link for the selected customer. The
// operator copies it and sends it to the exporter on WhatsApp/email.
export function InviteButton({ customerId }: { customerId: string }) {
  const [pending, startTransition] = useTransition();
  const [url, setUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  return (
    <div className="rounded-md border border-blue-200 bg-blue-50 p-4">
      <div className="text-sm text-blue-900 font-medium mb-1">
        Let this exporter fill their own profile
      </div>
      <p className="text-sm text-blue-800/80 mb-3 max-w-2xl">
        Generate a secure one-time link (valid 7 days) and send it to them — they fill in
        their company details themselves, you just review.
      </p>
      {url ? (
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded bg-white border border-blue-200 px-2 py-1.5 text-xs break-all">
            {url}
          </code>
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
          >
            {copied ? "Copied!" : "Copy link"}
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setMessage(null);
              startTransition(async () => {
                const r = await inviteCustomerToOnboard(customerId);
                if (r.ok) setUrl(r.url);
                else setMessage(r.error);
              });
            }}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {pending ? "Creating…" : "Create onboarding link"}
          </button>
          {message && <span className="text-sm text-red-600">{message}</span>}
        </div>
      )}
    </div>
  );
}
