// Tests for the deterministic invoice-value computer (src/lib/docs/compute-value.ts).
// This is pure arithmetic that must REFUSE to guess: on any ambiguity it returns
// null so the agent asks the customer instead of printing a possibly 1000x-wrong
// total onto a customs document.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeProposedValue } from "../src/lib/docs/compute-value";

describe("computeProposedValue", () => {
  it("multiplies quantity x unit price when units match (basis = 1 unit)", () => {
    const r = computeProposedValue({
      quantity: "10",
      quantity_unit: "kg",
      unit_price: "2",
      unit_price_basis: "kg",
      value_currency: "USD",
    });
    assert.equal(r?.amount, "20.00");
    assert.match(r!.explanation, /USD 20\.00/);
  });

  it("divides by the basis quantity (price per 1000 kg)", () => {
    const r = computeProposedValue({
      quantity: "1000",
      quantity_unit: "kg",
      unit_price: "5",
      unit_price_basis: "1000 kg",
    });
    // (1000 * 5) / 1000 = 5.00
    assert.equal(r?.amount, "5.00");
  });

  it("normalises unit spelling/case before matching (MT vs mt)", () => {
    const r = computeProposedValue({
      quantity: "20",
      quantity_unit: "MT",
      unit_price: "100",
      unit_price_basis: "mt",
    });
    assert.equal(r?.amount, "2000.00");
  });

  it("accepts clean comma thousands grouping (53,352 kg)", () => {
    const r = computeProposedValue({
      quantity: "53,352",
      quantity_unit: "kg",
      unit_price: "2",
      unit_price_basis: "kg",
    });
    assert.equal(r?.amount, "106704.00");
  });

  it("REFUSES ambiguous European thousands-dot in quantity (1.000)", () => {
    const r = computeProposedValue({
      quantity: "1.000",
      quantity_unit: "kg",
      unit_price: "2",
      unit_price_basis: "kg",
    });
    assert.equal(r, null);
  });

  it("REFUSES ambiguous European thousands-dot in unit price (53.352)", () => {
    const r = computeProposedValue({
      quantity: "10",
      quantity_unit: "kg",
      unit_price: "53.352",
      unit_price_basis: "kg",
    });
    assert.equal(r, null);
  });

  it("REFUSES when the quantity unit and price basis unit differ (kg vs MT)", () => {
    const r = computeProposedValue({
      quantity: "1000",
      quantity_unit: "kg",
      unit_price: "2",
      unit_price_basis: "MT",
    });
    assert.equal(r, null);
  });

  it("REFUSES when the price basis is missing", () => {
    const r = computeProposedValue({
      quantity: "10",
      quantity_unit: "kg",
      unit_price: "2",
    });
    assert.equal(r, null);
  });

  it("REFUSES a non-positive quantity (0)", () => {
    const r = computeProposedValue({
      quantity: "0",
      quantity_unit: "kg",
      unit_price: "2",
      unit_price_basis: "kg",
    });
    assert.equal(r, null);
  });
});
