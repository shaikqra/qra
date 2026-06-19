"use client";

import { useState, useTransition } from "react";
import { requestPortalLink } from "./actions";

export function PortalLoginForm() {
  const [number, setNumber] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    start(async () => {
      const r = await requestPortalLink(number);
      setMsg({ ok: r.ok, text: r.message });
    });
  }

  return (
    <form onSubmit={submit} className="mt-5">
      <input
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        value={number}
        onChange={(e) => setNumber(e.target.value)}
        placeholder="+91 81234 56789"
        className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#3f5bd9]"
      />
      <button
        type="submit"
        disabled={pending || !number.trim()}
        className="mt-3 w-full rounded-lg px-4 py-2.5 text-sm font-medium text-white transition-opacity disabled:opacity-50"
        style={{ backgroundColor: "#3f5bd9" }}
      >
        {pending ? "Sending…" : "Send my link"}
      </button>
      {msg && (
        <p className={`mt-3 text-sm ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</p>
      )}
    </form>
  );
}
