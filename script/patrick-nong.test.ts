import assert from "node:assert/strict";
import { test } from "node:test";
import { BOOKING_CONSULTANTS, isBookingConsultant, ownerName } from "../server/icg/reference";
import { OWNER_MAP, SCORECARD_ROSTER, resolveConsultant } from "../server/icg/consultant-scorecard";

test("Patrick Nong is a booking consultant and appears once in the scorecard", () => {
  assert.equal(ownerName("367581062"), "Patrick Nong");
  assert.equal(BOOKING_CONSULTANTS["367581062"], "Patrick Nong");
  assert.equal(isBookingConsultant("367581062"), true);
  assert.equal(OWNER_MAP["367581062"], "Patrick Nong");
  assert.equal(SCORECARD_ROSTER.filter(name => name === "Patrick Nong").length, 1);
  assert.equal(SCORECARD_ROSTER.length, 5);
});

test("owner ID resolves Patrick Nong without changing Patrick Van Orsouw", () => {
  assert.equal(resolveConsultant({ hubspot_owner_id: "367581062" }), "Patrick Nong");
  assert.equal(resolveConsultant({ hubspot_owner_id: "362352488" }), "Patrick Van Orsouw");
  assert.equal(isBookingConsultant("362352488"), false);
});

test("Aircall aliases distinguish Patrick Nong and Patty from the strategist", () => {
  for (const alias of ["Patrick Nong", "Patty", "Patrick Nong 2"]) {
    assert.equal(resolveConsultant({ hs_call_body: `call</span></strong> on <strong>${alias}</strong>` }), "Patrick Nong");
    assert.equal(resolveConsultant({ hs_call_body: `made by <strong>${alias}</strong>` }), "Patrick Nong");
  }
  for (const alias of ["Patrick", "Patrick Van Orsouw"]) {
    assert.equal(resolveConsultant({ hs_call_body: `made by <strong>${alias}</strong>` }), "Patrick Van Orsouw");
  }
});
