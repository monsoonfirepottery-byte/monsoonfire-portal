import assert from "node:assert/strict";
import test from "node:test";
import { calculateFiringPrice, newFiringPricingVersion } from "./firingPricing";

test("new shared rates cap each ticket independently and add fulfilled services outside the cap", () => {
  const price = (heatId: string, quantity: number, extra = {}) => calculateFiringPrice({ version: 2, heatId, billingUnit: "half_shelf", quantity, ...extra }).chargeCents;
  assert.equal(price("low", 1), 2000);
  assert.equal(price("low", 10), 8000);
  assert.equal(price("mid", 3), 10500);
  assert.equal(price("mid", 4), 12000);
  assert.equal(price("mid", 20, { privateFulfilled: true, rushFulfilled: true }), 16000);
  assert.equal(calculateFiringPrice({ version: 2, heatId: "low", billingUnit: "whole_kiln", quantity: 1 }).chargeCents, 8000);
});

test("custom requires a quote and historical rates retain their original calculation", () => {
  assert.equal(calculateFiringPrice({ version: 2, heatId: "custom", billingUnit: "whole_kiln", quantity: 1 }).chargeCents, null);
  assert.equal(calculateFiringPrice({ heatId: "mid", billingUnit: "whole_kiln", quantity: 1 }).chargeCents, 6500);
  assert.equal(calculateFiringPrice({ heatId: "low", billingUnit: "half_shelf", quantity: 2 }).chargeCents, 3000);
  assert.equal(calculateFiringPrice({ version: 99, heatId: "low", billingUnit: "half_shelf", quantity: 1 }).chargeCents, null);
});

test("version 3 cone 10 estimates include the base cap and fulfilled add-ons", () => {
  const price = (quantity: number, extra = {}) => calculateFiringPrice({ version: 3, heatId: "high", billingUnit: "half_shelf", quantity, ...extra }).chargeCents;
  assert.equal(price(1), 4500);
  assert.equal(price(3), 13500);
  assert.equal(price(4), 16000);
  assert.equal(price(20), 16000);
  assert.equal(price(3, { rushFulfilled: true }), 15500);
  assert.equal(price(1, { privateFulfilled: true }), 18000);
  assert.equal(price(3, { privateFulfilled: true, rushFulfilled: true }), 20000);
  assert.equal(calculateFiringPrice({ version: 3, heatId: "high", billingUnit: "custom", quantity: 1 }).chargeCents, null);
  assert.equal(calculateFiringPrice({ version: 2, heatId: "high", billingUnit: "half_shelf", quantity: 3 }).chargeCents, null);
  assert.equal(calculateFiringPrice({ version: 1, heatId: "high", billingUnit: "half_shelf", quantity: 3 }).chargeCents, 6500);
});


test("version 3 is the release default and an explicit pause issues version 2", () => {
  assert.equal(newFiringPricingVersion(""), 3);
  assert.equal(newFiringPricingVersion("true"), 3);
  assert.equal(newFiringPricingVersion("false"), 2);
});
