import test from "node:test";
import assert from "node:assert/strict";
import { consultantGrossMemberships, consultantMembershipSummary, grossMembershipEligible, membershipSaleMs, membershipBooker } from "./consultant-memberships";
import { consultantTeam } from "./metrics";
import { hubspot } from "./hubspot";
import { MEMBERSHIP_REFUND_STAGE, MEMBERSHIP_SOLD_STAGES } from "./reference";
import type { PeriodRange } from "./period";

const range: PeriodRange = { key: "custom", label: "September", start: "2026-08-31T14:00:00Z", end: "2026-09-30T14:00:00Z" };
const soldStage = MEMBERSHIP_SOLD_STAGES[1];
const deal = (id: string, properties: Record<string, string>) => ({ id, properties: {
  dealname: `Sample membership ${id}`, pipeline: "1448193481", dealstage: soldStage, ...properties,
} });

test("paid calendar date overrides creation/close date and matches AEST report boundaries", () => {
  for (const paid of ["2026-09-01", "2026-09-01T00:00:00Z", String(Date.parse("2026-09-01"))]) {
    assert.equal(membershipSaleMs({ membership_paid_date: paid, createdate: "2026-08-02", closedate: "2026-10-02" }), Date.parse(range.start));
  }
  assert.equal(membershipSaleMs({ membership_paid_date: "2026-10-01" }), Date.parse(range.end));
  assert.equal(membershipSaleMs({ closedate: "2026-09-24T03:40:16Z" }), Date.parse("2026-09-24T03:40:16Z"));
  assert.equal(membershipSaleMs({ membership_paid_date: "invalid", closedate: "2026-09-24T03:40:16Z" }), Date.parse("2026-09-24T03:40:16Z"));
  assert.ok(Number.isNaN(membershipSaleMs({ membership_paid_date: "2026-02-31", createdate: "2026-09-01" })));
  assert.ok(Number.isNaN(membershipSaleMs({ createdate: "2026-09-01", hs_v2_date_entered_3152097752: "2026-09-01" })));
});

test("gross eligibility retains refunded/progressed memberships, excludes tests and referrals", () => {
  assert.equal(grossMembershipEligible({ dealstage: MEMBERSHIP_REFUND_STAGE }), true);
  assert.equal(grossMembershipEligible({ pipeline: "1448193481", dealstage: "progressed", membership_paid_date: "2026-09-01" }), true);
  assert.equal(grossMembershipEligible({ pipeline: "1578114550", dealstage: "progressed", membership_paid_date: "2026-09-01" }), false);
  assert.equal(grossMembershipEligible({ dealstage: soldStage, dealname: "Test-Membership" }), false);
  assert.equal(grossMembershipEligible({ dealstage: "2872614380", membership_paid_date: "2026-09-01" }), false);
  assert.equal(grossMembershipEligible({ dealstage: MEMBERSHIP_REFUND_STAGE, hs_v2_date_entered_2872614380: "2026-08-01" }), false);
  assert.equal(grossMembershipEligible({ dealstage: MEMBERSHIP_REFUND_STAGE, hs_v2_date_entered_2872614380: "2026-08-01", [`hs_v2_date_entered_${soldStage}`]: "2026-09-01" }), true);
});

test("a cancellation cannot overwrite the original sale month when paid date is missing", () => {
  const cancelled = { dealstage: MEMBERSHIP_REFUND_STAGE, closedate: "2026-09-19", hs_v2_date_entered_3152097752: "2026-09-08" };
  assert.ok(Number.isNaN(membershipSaleMs(cancelled)));
  assert.equal(membershipSaleMs({ ...cancelled, [`hs_v2_date_entered_${soldStage}`]: "2026-07-25T05:00:00Z" }), Date.parse("2026-07-25T05:00:00Z"));
  assert.equal(membershipSaleMs({ ...cancelled, closedate: "2026-08-18T05:00:00Z" }), Date.parse("2026-08-18T05:00:00Z"));
  assert.equal(membershipSaleMs({ ...cancelled, membership_paid_date: "2026-08-18" }), Date.parse("2026-08-17T14:00:00Z"));
});

test("booking-consultant credit wins; contact history recovers original booker without crediting strategist", () => {
  const history = { c: { hubspot_owner_id: [
    { value: "363184380", timestamp: "2026-07-01" },
    { value: "362495114", timestamp: "2026-08-02" },
    { value: "362741341", timestamp: "2026-08-01" },
  ] } };
  assert.equal(membershipBooker({ booking_consultant: "367581062" }, ["c"], history), "Patrick Nong");
  assert.equal(membershipBooker({ booking_consultant: "363184380" }, ["c"], history), "Steven Green");
  assert.equal(membershipBooker({ hubspot_owner_id: "363184380" }, [], {}), "Unattributed");
  assert.equal(membershipBooker({ booking_consultant: "362352488" }, [], {}), "Unattributed");
});

test("September counts paid sales from older leads and keeps refunded sales in their original month", async (t) => {
  const records = [
    deal("older-lead", { booking_consultant: "367581062", membership_paid_date: "2026-09-21", createdate: "2026-07-01", closedate: "2026-09-24" }),
    deal("august-refund", { booking_consultant: "362741341", membership_paid_date: "2026-08-18", dealstage: MEMBERSHIP_REFUND_STAGE, hs_v2_date_entered_3152097752: "2026-09-01" }),
    deal("later-refund", { booking_consultant: "367581062", membership_paid_date: "2026-09-10", dealstage: MEMBERSHIP_REFUND_STAGE, hs_v2_date_entered_3152097752: "2026-10-01" }),
    deal("progressed", { booking_consultant: "362495114", membership_paid_date: "2026-09-01", dealstage: "later-stage" }),
    deal("legacy", { booking_consultant: "363811156", closedate: "2026-09-15T08:00:00Z" }),
    deal("unknown", { membership_paid_date: "2026-09-12" }),
    deal("recovered", { membership_paid_date: "2026-09-02" }),
    deal("next-month", { booking_consultant: "362495114", membership_paid_date: "2026-10-01", createdate: "2026-09-01" }),
    deal("test", { dealname: "Test-Membership", membership_paid_date: "2026-09-01" }),
    deal("referral", { dealstage: "2872614380", membership_paid_date: "2026-09-01" }),
    deal("no-date", { booking_consultant: "367581062", createdate: "2026-09-01" }),
  ];
  t.mock.method(hubspot, "searchDeals", async (query: any) => {
    assert.ok(query.properties.includes("membership_paid_date"));
    assert.ok(!JSON.stringify(query.filterGroups).includes("createdate"));
    assert.ok(JSON.stringify(query.filterGroups).includes(MEMBERSHIP_REFUND_STAGE));
    return [...records, records[0]]; // overlapping search groups cannot double-count
  });
  t.mock.method(hubspot, "batchAssociations", async (_from: string, to: string, ids: string[]) =>
    to === "deals" ? Object.fromEntries(ids.map(id => [id, []])) : { recovered: ["client"] });
  t.mock.method(hubspot, "batchReadWithHistory", async () => ({
    client: { hubspot_owner_id: [{ value: "366721097", timestamp: "2026-08-01" }] },
  }));
  const counts = await consultantGrossMemberships(range);
  assert.deepEqual(counts, { "Patrick Nong": 2, "Akhil Venugopal": 1, "Moses Emmanuel": 1, "Unattributed": 1, "Mitchell Saxton": 1 });
  const august = await consultantGrossMemberships({ ...range, start: "2026-07-31T14:00:00Z", end: range.start });
  assert.deepEqual(august, { "Steven Green": 1 });
  const rows = await consultantTeam(range);
  assert.equal(rows.find(r => r.name === "Unattributed")?.sold, 1);
  assert.equal(rows.find(r => r.name === "Patrick Nong")?.sold, 2);
  assert.equal(rows.reduce((sum, r) => sum + r.sold, 0), 6);
  const summary = await consultantMembershipSummary(range);
  assert.equal(summary.undatedByConsultant["Patrick Nong"][0].url.endsWith("/no-date"), true);
  assert.equal(rows.find(r => r.name === "Patrick Nong")?.membershipDateIssues.length, 1);
});

test("incomplete membership retrieval fails instead of presenting a partial gross count", async (t) => {
  t.mock.method(hubspot, "searchDeals", async () => new Array(10000).fill(deal("sample", {})));
  await assert.rejects(consultantGrossMemberships(range), /incomplete gross members/);
});
