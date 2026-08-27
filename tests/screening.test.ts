// Tests for the FAIL-CLOSED sanctions-screening decision logic.
//   - src/lib/screening/csl.ts  (US Consolidated Screening List lookup)
//   - src/lib/screening/list-utils.ts  (list parsing sanity floor)
// The one rule that matters: a broken, empty, or malformed response must NEVER
// read as "clear". It must become UNCHECKED so the pipeline holds for a human.
//
// No real network calls are made: globalThis.fetch is temporarily replaced with a
// canned response for each case, then restored.

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { screenPartyName } from "../src/lib/screening/csl";
import { finalizeEntries, normalizeName, decodeXml } from "../src/lib/screening/list-utils";

const realFetch = globalThis.fetch;
const realKey = process.env.TRADE_GOV_API_KEY;

// Replace fetch with a canned HTTP response (or an error) for one test.
function stubFetch(opts: { ok?: boolean; status?: number; body?: unknown; throws?: boolean }) {
  globalThis.fetch = (async () => {
    if (opts.throws) throw new Error("network down");
    return {
      ok: opts.ok ?? true,
      status: opts.status ?? 200,
      json: async () => opts.body ?? {},
    };
  }) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.TRADE_GOV_API_KEY;
  else process.env.TRADE_GOV_API_KEY = realKey;
});

describe("screenPartyName — fail closed", () => {
  it("returns unchecked/not_configured when no API key is set", async () => {
    delete process.env.TRADE_GOV_API_KEY;
    const r = await screenPartyName("Global Foods LLC");
    assert.equal(r.status, "unchecked");
    assert.equal(r.status === "unchecked" && r.reason, "not_configured");
  });

  it("returns unchecked on an empty party name (cannot screen the un-named)", async () => {
    process.env.TRADE_GOV_API_KEY = "test-key";
    const r = await screenPartyName("   ");
    assert.equal(r.status, "unchecked");
  });

  it("returns unchecked on an HTTP error (never clear)", async () => {
    process.env.TRADE_GOV_API_KEY = "test-key";
    stubFetch({ ok: false, status: 500 });
    const r = await screenPartyName("Global Foods LLC");
    assert.equal(r.status, "unchecked");
  });

  it("returns unchecked on an unrecognised response shape (never clear)", async () => {
    process.env.TRADE_GOV_API_KEY = "test-key";
    stubFetch({ body: { unexpected: true } });
    const r = await screenPartyName("Global Foods LLC");
    assert.equal(r.status, "unchecked");
  });

  it("returns unchecked when total>0 but results are empty (contradiction)", async () => {
    // THE critical case: the API says there are hits but hands back nothing —
    // declaring the party clear here would be catastrophic.
    process.env.TRADE_GOV_API_KEY = "test-key";
    stubFetch({ body: { total: 3, results: [] } });
    const r = await screenPartyName("Global Foods LLC");
    assert.equal(r.status, "unchecked");
  });

  it("throws inside fetch => unchecked (network exception fails closed)", async () => {
    process.env.TRADE_GOV_API_KEY = "test-key";
    stubFetch({ throws: true });
    const r = await screenPartyName("Global Foods LLC");
    assert.equal(r.status, "unchecked");
  });

  it("returns clear only on positive evidence of zero hits (total 0, empty results)", async () => {
    process.env.TRADE_GOV_API_KEY = "test-key";
    stubFetch({ body: { total: 0, results: [] } });
    const r = await screenPartyName("Global Foods LLC");
    assert.equal(r.status, "clear");
  });

  it("returns potential_match when the list returns a hit", async () => {
    process.env.TRADE_GOV_API_KEY = "test-key";
    stubFetch({
      body: {
        total: 1,
        results: [{ name: "BAD ACTOR CO", score: 0.98, source: { abbreviation: "SDN" } }],
      },
    });
    const r = await screenPartyName("Bad Actor Co");
    assert.equal(r.status, "potential_match");
    assert.equal(r.status === "potential_match" && r.matches[0].name, "BAD ACTOR CO");
  });
});

describe("finalizeEntries — refuse a half-parsed list", () => {
  it("throws below the minimum count (won't screen against incomplete data)", () => {
    assert.throws(
      () => finalizeEntries([{ entryType: "entity", fullName: "Acme Corp" }], 5, "TEST"),
      /refusing/
    );
  });

  it("dedupes, drops too-short names, and returns when the floor is met", () => {
    const out = finalizeEntries(
      [
        { entryType: "entity", fullName: "Acme Corp" },
        { entryType: "entity", fullName: "Acme Corp" }, // duplicate
        { entryType: "individual", fullName: "Ba" }, // too short (<4 chars)
      ],
      1,
      "TEST"
    );
    assert.deepEqual(out, [{ entryType: "entity", fullName: "Acme Corp" }]);
  });
});

describe("normalizeName / decodeXml", () => {
  it("folds accents to ASCII and lowercases so accented names still match", () => {
    assert.equal(normalizeName("Café Irán"), "cafe iran");
  });
  it("decodes XML entities", () => {
    assert.equal(decodeXml("Smith &amp; Sons"), "Smith & Sons");
  });
});
