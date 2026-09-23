import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesOutstandingAmount } from "../../shared/membership-receipts";

test("receipt picker only matches the outstanding amount in cents", () => {
  assert.equal(matchesOutstandingAmount(6000, 6000), true);
  assert.equal(matchesOutstandingAmount(5999.99, 6000), false);
  assert.equal(matchesOutstandingAmount(6000.01, 6000), false);
  assert.equal(matchesOutstandingAmount(997, 6000), false);
  assert.equal(matchesOutstandingAmount(5000, 5000), true, "part-paid member uses remainder");
  assert.equal(matchesOutstandingAmount(6000, 5000), false, "original total is excluded after part payment");
  assert.equal(matchesOutstandingAmount(0.1 + 0.2, 0.3), true);
  for (const value of [0, -1, NaN, Infinity]) {
    assert.equal(matchesOutstandingAmount(value, value), false);
  }
});
