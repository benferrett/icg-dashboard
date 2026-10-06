import test from "node:test";
import assert from "node:assert/strict";
import { finalizeCohort, maturingDaysLeft, ucMilestoneMs, cohortMonthKeys } from "./marketing-new";

test("cohort ratios use the agreed denominators", () => {
  const s = finalizeCohort({ spend: 10000, leads: 100, booked: 20, scheduled: 16, sat: 12, members: 3, eoiDeals: 2, eoiClients: 1, uc: 1 });
  assert.equal(s.cpl, 100);
  assert.equal(s.leadToBooked, 0.2);
  assert.equal(s.showRate, 0.75); // sat ÷ held, not ÷ booked
  assert.equal(s.dsToMember, 0.25);
  assert.equal(s.cac, 10000 / 3);
  assert.equal(s.memberToEoi, 1 / 3); // EOI clients ÷ members
  assert.equal(s.ucCac, 10000);
});

test("empty denominators are null, not zero", () => {
  const s = finalizeCohort({ spend: 500, leads: 0, booked: 0, scheduled: 0, sat: 0, members: 0, eoiDeals: 0, eoiClients: 0, uc: 0 });
  assert.equal(s.cpl, null);
  assert.equal(s.cac, null);
  assert.equal(s.ucCac, null);
});

test("UC uses the Contracts-tab rule and never counts cancelled EOIs", () => {
  assert.ok(Number.isFinite(ucMilestoneMs({ dealstage: "3113781723", hs_v2_date_entered_3113781723: "2026-08-01T00:00:00Z" })));
  assert.ok(Number.isFinite(ucMilestoneMs({ dealstage: "3102861798", pipeline: "1814691263", closedate: "2026-08-01" })));
  assert.ok(Number.isNaN(ucMilestoneMs({ dealstage: "3112795614", pipeline: "1578114550", hs_v2_date_entered_3113781723: "2026-08-01" })));
  assert.ok(Number.isNaN(ucMilestoneMs({ dealstage: "3051561412", pipeline: "1578114550" })));
});

test("maturity flag runs for 90 days after month end", () => {
  const end = "2026-09-30T14:00:00.000Z";
  assert.equal(maturingDaysLeft(end, Date.parse(end) + 10 * 86400000), 80);
  assert.equal(maturingDaysLeft(end, Date.parse(end) + 90 * 86400000), 0);
});

test("cohort months start in January 2026", () => {
  const keys = cohortMonthKeys();
  assert.equal(keys[0], "2026-01");
  assert.ok(keys.length >= 10);
});
