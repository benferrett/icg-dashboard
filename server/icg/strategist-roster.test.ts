import test from "node:test";
import assert from "node:assert/strict";
import { isStrategistOwner, ownerName, STRATEGIST_NAME_TOKENS, isBookingConsultant } from "./reference";
import { resolveConsultant } from "./consultant-scorecard";

test("Christina Su is a recognised strategist (owner 368676161)", () => {
  assert.ok(isStrategistOwner("368676161"));
  assert.equal(ownerName("368676161"), "Christina Su");
  assert.equal(STRATEGIST_NAME_TOKENS.christina, "368676161");
  assert.ok(!isBookingConsultant("368676161"));
  assert.equal(resolveConsultant({ hubspot_owner_id: "368676161" }), "Christina Su");
});
