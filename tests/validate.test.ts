// Tests for the G1 trust-gate rules (src/lib/docs/validate.ts) — the compliance
// spine. These deterministic checks can veto what the AI extracted and route a
// shipment to a human. Each test locks in one rule so a future refactor can't
// silently weaken the gate.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateExtracted,
  lowConfidenceFields,
  verifyConfirmedSnapshot,
} from "../src/lib/docs/validate";

// Helpers: does any issue target this field / match this phrase?
const hasField = (issues: { field: string }[], field: string) =>
  issues.some((i) => i.field === field);
const reasonFor = (issues: { field: string; reason: string }[], field: string) =>
  issues.find((i) => i.field === field)?.reason ?? "";

// A fully clean, self-consistent FOB shipment — the golden happy path.
const CLEAN = {
  buyer_name: "Global Foods LLC",
  product_description: "Basmati rice",
  quantity: "1000",
  quantity_unit: "kg",
  unit_price: "2",
  unit_price_basis: "kg",
  value_amount: "2000",
  value_currency: "USD",
  incoterm: "FOB Mundra",
  net_weight: "1000",
  gross_weight: "1050",
  number_of_packages: "20",
  hs_code: "10063020",
};

describe("validateExtracted — happy path", () => {
  it("passes a clean, self-consistent shipment with no issues", () => {
    assert.deepEqual(validateExtracted(CLEAN), []);
  });
});

describe("validateExtracted — ambiguous European thousands", () => {
  it('flags an ambiguous "25.155" quantity for confirmation', () => {
    const issues = validateExtracted({ quantity: "25.155" });
    assert.ok(hasField(issues, "quantity"));
    assert.match(reasonFor(issues, "quantity"), /ambiguous/);
    // The confirm prompt offers both readings: 25155 (whole) or 25.155 (decimal).
    assert.match(reasonFor(issues, "quantity"), /25155/);
  });

  it('flags an ambiguous "53.352" (dot form) rather than parsing it silently', () => {
    // NOTE: the dot form is deliberately flagged, never auto-read as 53352.
    const issues = validateExtracted({ unit_price: "53.352" });
    assert.ok(hasField(issues, "unit_price"));
    assert.match(reasonFor(issues, "unit_price"), /ambiguous/);
  });

  it("does NOT flag package COUNT for thousands-dot (a plain integer field)", () => {
    // number_of_packages is excluded from the ambiguity list by design.
    const issues = validateExtracted({ number_of_packages: "10.500" });
    assert.equal(hasField(issues, "number_of_packages"), false);
  });

  it("exempts a value the exporter already confirmed at the gate (no loop)", () => {
    const issues = validateExtracted({
      quantity: "25.155",
      _verify_confirmed: JSON.stringify({ quantity: "25.155" }),
    });
    assert.deepEqual(issues, []);
  });
});

describe("validateExtracted — qty x unit_price reconciliation", () => {
  it("flags a >2% mismatch on an FOB (goods-value) shipment", () => {
    // 1000 kg x 2 = 2000, but stated 5000 => 150% off => flag.
    const issues = validateExtracted({
      incoterm: "FOB Nhava Sheva",
      quantity: "1000",
      quantity_unit: "kg",
      unit_price: "2",
      unit_price_basis: "kg",
      value_currency: "USD",
      value_amount: "5000",
    });
    assert.ok(hasField(issues, "value_amount"));
    assert.match(reasonFor(issues, "value_amount"), /match/);
  });

  it("does NOT flag a mismatch under 2%", () => {
    // 1000 kg x 2 = 2000, stated 2010 => 0.5% off => within tolerance.
    const issues = validateExtracted({
      incoterm: "FOB Mundra",
      quantity: "1000",
      quantity_unit: "kg",
      unit_price: "2",
      unit_price_basis: "kg",
      value_currency: "USD",
      value_amount: "2010",
    });
    assert.equal(hasField(issues, "value_amount"), false);
  });

  it("does NOT reconcile on CIF (value legitimately bundles freight/insurance)", () => {
    const issues = validateExtracted({
      incoterm: "CIF Rotterdam",
      quantity: "1000",
      quantity_unit: "kg",
      unit_price: "2",
      unit_price_basis: "kg",
      value_currency: "USD",
      value_amount: "5000",
    });
    assert.equal(hasField(issues, "value_amount"), false);
  });

  it("does NOT reconcile when the incoterm is absent (never guesses)", () => {
    const issues = validateExtracted({
      quantity: "1000",
      quantity_unit: "kg",
      unit_price: "2",
      unit_price_basis: "kg",
      value_currency: "USD",
      value_amount: "5000",
    });
    assert.equal(hasField(issues, "value_amount"), false);
  });
});

describe("validateExtracted — weights", () => {
  it("flags gross weight below net weight", () => {
    const issues = validateExtracted({ net_weight: "100", gross_weight: "90" });
    assert.ok(hasField(issues, "gross_weight"));
  });

  it("accepts gross >= net", () => {
    const issues = validateExtracted({ net_weight: "100", gross_weight: "120" });
    assert.equal(hasField(issues, "gross_weight"), false);
  });
});

describe("validateExtracted — currency shape", () => {
  it("flags a currency that is not a 3-letter code", () => {
    assert.ok(hasField(validateExtracted({ value_currency: "US" }), "value_currency"));
    assert.ok(hasField(validateExtracted({ value_currency: "US$" }), "value_currency"));
  });
  it("accepts a 3-letter code (any case)", () => {
    assert.equal(hasField(validateExtracted({ value_currency: "usd" }), "value_currency"), false);
  });
});

describe("validateExtracted — incoterm whitelist (first token)", () => {
  it("accepts a known term with a place (FOB Mundra)", () => {
    assert.equal(hasField(validateExtracted({ incoterm: "FOB Mundra" }), "incoterm"), false);
  });
  it("accepts a known term in lower case (cif rotterdam)", () => {
    assert.equal(hasField(validateExtracted({ incoterm: "cif rotterdam" }), "incoterm"), false);
  });
  it("flags an unrecognised term", () => {
    assert.ok(hasField(validateExtracted({ incoterm: "XYZ Mundra" }), "incoterm"));
  });
});

describe("validateExtracted — HS code digits", () => {
  it("accepts an 8-digit ITC-HS code", () => {
    assert.equal(hasField(validateExtracted({ hs_code: "10063020" }), "hs_code"), false);
  });
  it("accepts a dotted 8-digit code (dots stripped)", () => {
    assert.equal(hasField(validateExtracted({ hs_code: "1006.30.20" }), "hs_code"), false);
  });
  it("flags a 6-digit code and asks for the full 8 digits", () => {
    const issues = validateExtracted({ hs_code: "100630" });
    assert.ok(hasField(issues, "hs_code"));
    assert.match(reasonFor(issues, "hs_code"), /8-digit/);
  });
  it("flags a non-numeric code", () => {
    const issues = validateExtracted({ hs_code: "10AB3020" });
    assert.ok(hasField(issues, "hs_code"));
    assert.match(reasonFor(issues, "hs_code"), /digits only/);
  });
});

describe("validateExtracted — quantity unit sanity", () => {
  it("flags a unit with no letters (1000 of WHAT)", () => {
    assert.ok(hasField(validateExtracted({ quantity_unit: "1000" }), "quantity_unit"));
  });
  it("accepts any word unit (bags)", () => {
    assert.equal(hasField(validateExtracted({ quantity_unit: "bags" }), "quantity_unit"), false);
  });
});

describe("validateExtracted — plain number checks", () => {
  it("flags a non-numeric quantity", () => {
    assert.match(reasonFor(validateExtracted({ quantity: "abc" }), "quantity"), /not a plain number/);
  });
  it("flags a zero/negative quantity", () => {
    assert.match(reasonFor(validateExtracted({ quantity: "0" }), "quantity"), /greater than zero/);
  });
});

describe("lowConfidenceFields", () => {
  it("flags a critical field below its elevated threshold (quantity 0.8 < 0.9)", () => {
    assert.deepEqual(lowConfidenceFields({ quantity: "100" }, { quantity: 0.8 }), ["quantity"]);
  });
  it("does not flag a critical field above threshold (quantity 0.95)", () => {
    assert.deepEqual(lowConfidenceFields({ quantity: "100" }, { quantity: 0.95 }), []);
  });
  it("uses the default threshold for uncatalogued fields (0.7 < 0.75)", () => {
    assert.deepEqual(
      lowConfidenceFields({ product_description: "rice" }, { product_description: 0.7 }),
      ["product_description"]
    );
  });
  it("never flags display-only exempt fields (po_date)", () => {
    assert.deepEqual(lowConfidenceFields({ po_date: "2026-01-01" }, { po_date: 0.1 }), []);
  });
  it("ignores blank fields (gap-fill's job, not confidence's)", () => {
    assert.deepEqual(lowConfidenceFields({ quantity: "" }, { quantity: 0.1 }), []);
  });
});

describe("verifyConfirmedSnapshot", () => {
  it("snapshots only the confirmable fields that are present", () => {
    const snap = verifyConfirmedSnapshot({ quantity: "25.155", value_amount: "5000", buyer_name: "x" });
    assert.deepEqual(JSON.parse(snap), { quantity: "25.155", value_amount: "5000" });
  });
});
