"use client";

import { useRef, useState, useTransition } from "react";
import { portalChat } from "./chat-actions";

type Msg = { id: number; role: "you" | "qra"; text: string };

const PROMPTS = [
  "What do I need to do next?",
  "What's the status?",
  "What documents are ready?",
  "Do I file with customs?",
];

const BRAND = "#3f5bd9";

export function PortalChat({ token, shipmentId }: { token: string; shipmentId: string }) {
  const idRef = useRef(0);
  const [log, setLog] = useState<Msg[]>([
    {
      id: 0,
      role: "qra",
      text: "Hi! I'm Qra. Ask me anything about this shipment — what's happening, what's ready, or what you need to do next.",
    },
  ]);
  const [input, setInput] = useState("");
  const [pending, start] = useTransition();

  function send(raw: string) {
    const msg = raw.trim();
    if (!msg || pending) return;
    setLog((l) => [...l, { id: ++idRef.current, role: "you", text: msg }]);
    setInput("");
    start(async () => {
      const r = await portalChat(token, shipmentId, msg);
      setLog((l) => [...l, { id: ++idRef.current, role: "qra", text: r.ok ? r.reply : r.error }]);
    });
  }

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Ask Qra</h2>
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex max-h-80 flex-col gap-2.5 overflow-y-auto p-4">
          {log.map((m) => (
            <div key={m.id} className={`flex ${m.role === "you" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                  m.role === "you" ? "rounded-br-sm text-white" : "rounded-bl-sm bg-slate-100 text-slate-800"
                }`}
                style={m.role === "you" ? { backgroundColor: BRAND } : undefined}
              >
                {m.text}
              </div>
            </div>
          ))}
          {pending && <div className="text-xs text-slate-400">Qra is typing…</div>}
        </div>
        <div className="flex flex-wrap gap-2 px-4 pb-2">
          {PROMPTS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => send(p)}
              disabled={pending}
              className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              {p}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="flex items-center gap-2 border-t border-slate-100 p-3"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your shipment…"
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#3f5bd9]"
          />
          <button
            type="submit"
            disabled={pending || !input.trim()}
            className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: BRAND }}
          >
            Send
          </button>
        </form>
      </div>
    </section>
  );
}
