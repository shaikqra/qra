"use client";

import type { ChaContactInput } from "@/lib/profile-fields";

// Edit a list of customs brokers (CHAs). An exporter can have several, so this
// renders one card per broker with an "add another" button and a default radio.
// Shared by the operator settings form and the customer onboarding form.

export function emptyCha(isDefault: boolean): ChaContactInput {
  return { name: "", email: "", port: "", is_default: isDefault };
}

export function ChaListEditor({
  value,
  onChange,
  accent = "zinc",
}: {
  value: ChaContactInput[];
  onChange: (next: ChaContactInput[]) => void;
  accent?: "emerald" | "zinc";
}) {
  const ring = accent === "emerald" ? "focus:ring-emerald-600" : "focus:ring-zinc-900";
  const input = `rounded-md border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 ${ring}`;

  function update(i: number, patch: Partial<ChaContactInput>) {
    onChange(value.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }

  function add() {
    onChange([...value, emptyCha(value.length === 0)]);
  }

  function remove(i: number) {
    const next = value.filter((_, idx) => idx !== i);
    // If the removed broker was the default, promote the first remaining one.
    if (next.length > 0 && !next.some((c) => c.is_default)) next[0].is_default = true;
    onChange(next.length > 0 ? next : [emptyCha(true)]);
  }

  function setDefault(i: number) {
    onChange(value.map((c, idx) => ({ ...c, is_default: idx === i })));
  }

  return (
    <div className="flex flex-col gap-3">
      {value.map((c, i) => (
        <div key={i} className="rounded-lg border border-zinc-200 bg-white p-3 flex flex-col gap-2">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              type="text"
              value={c.name}
              onChange={(e) => update(i, { name: e.target.value })}
              placeholder="CHA / broker firm name"
              className={input}
            />
            <input
              type="email"
              value={c.email}
              onChange={(e) => update(i, { email: e.target.value })}
              placeholder="broker@example.com"
              className={input}
            />
            <input
              type="text"
              value={c.port}
              onChange={(e) => update(i, { port: e.target.value })}
              placeholder="Port / label (optional)"
              className={input}
            />
          </div>
          <div className="flex items-center justify-between text-xs">
            <label className="flex items-center gap-1.5 text-zinc-600">
              <input
                type="radio"
                name="cha-default"
                checked={c.is_default}
                onChange={() => setDefault(i)}
              />
              Default broker (gets the documents)
            </label>
            {value.length > 1 && (
              <button
                type="button"
                onClick={() => remove(i)}
                className="text-red-600 hover:underline"
              >
                Remove
              </button>
            )}
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="self-start rounded-md border border-dashed border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:border-zinc-400 hover:text-zinc-900"
      >
        + Add another CHA
      </button>
    </div>
  );
}
