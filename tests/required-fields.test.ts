// Tests for required-field resolution (src/lib/docs/required-fields.ts). These
// decide when a shipment has enough data to generate documents vs. when the agent
// must go back and ask.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  missingRequiredFields,
  missingPackingFields,
  labelsFor,
} from "../src/lib/docs/required-fields";

const FULL_REQUIRED = {
  buyer_name: "Global Foods LLC",
  product_description: "Basmati rice",
  quantity: "1000",
  quantity_unit: "kg",
  value_amount: "2000",
  value_currency: "USD",
};

describe("missingRequiredFields", () => {
  it("returns every required field when nothing is provided", () => {
    assert.deepEqual(missingRequiredFields({}).sort(), Object.keys(FULL_REQUIRED).sort());
  });

  it("returns nothing when all required fields are present", () => {
    assert.deepEqual(missingRequiredFields(FULL_REQUIRED), []);
  });

  it("treats a whitespace-only value as missing", () => {
    assert.deepEqual(missingRequiredFields({ ...FULL_REQUIRED, buyer_name: "   " }), ["buyer_name"]);
  });

  it("reports only the genuinely missing field", () => {
    const { value_currency, ...partial } = FULL_REQUIRED;
    assert.deepEqual(missingRequiredFields(partial), ["value_currency"]);
  });
});

describe("missingPackingFields", () => {
  it("reports packing fields as missing when absent (but they never block docs)", () => {
    assert.deepEqual(
      missingPackingFields({}).sort(),
      ["number_of_packages", "package_type", "net_weight", "gross_weight"].sort()
    );
  });
});

describe("labelsFor", () => {
  it("maps known keys to human labels and passes unknown keys through", () => {
    assert.deepEqual(labelsFor(["quantity", "made_up_key"]), ["Quantity", "made_up_key"]);
  });
});
