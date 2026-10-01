import test from "node:test";
import assert from "node:assert/strict";
import { hubspot } from "./hubspot";
import { consultantMembershipSummary, resolveLinkedMembershipDeals } from "./consultant-memberships";
import { MEMBERSHIP_REFUND_STAGE, MEMBERSHIP_SOLD_STAGES } from "./reference";
import type { PeriodRange } from "./period";

const july: PeriodRange = { key: "custom", label: "July", start: "2026-06-30T14:00:00Z", end: "2026-07-31T14:00:00Z" };
const september: PeriodRange = { ...july, label: "September", start: "2026-08-31T14:00:00Z", end: "2026-09-30T14:00:00Z" };
const member = (id: string, properties: Record<string, string> = {}) => ({
  id, properties: { dealname: "Sample client - Membership", pipeline: "1448193481",
    dealstage: MEMBERSHIP_REFUND_STAGE, booking_consultant: "362495114",
    membership_paid_date: "2026-07-21", hs_v2_date_entered_3152097752: "2026-09-01T05:27:17Z", ...properties },
});
const opportunity = (id: string, properties: Record<string, string> = {}) => ({
  id, properties: { dealname: "Sample client - SMSF Opportunity", pipeline: "1448193481",
    dealstage: MEMBERSHIP_REFUND_STAGE, booking_consultant: "362741341",
    closedate: "2026-09-19T23:13:33Z", hs_v2_date_entered_3152097752: "2026-09-08T05:57:30Z", ...properties },
});

test("linked refunded membership clears opportunity warning, preserves July date and booker, counts once", async t => {
  const parent = member("membership");
  const source = opportunity("opportunity");
  t.mock.method(hubspot, "searchDeals", async () => [source, parent, parent]);
  t.mock.method(hubspot, "batchAssociations", async (_from: string, to: string, ids: string[], options: any) => {
    assert.equal(to, "deals");
    assert.equal(options.strict, true);
    assert.deepEqual(ids, ["opportunity"]);
    return { opportunity: ["membership"] };
  });
  assert.deepEqual(await consultantMembershipSummary(july), {
    counts: { "Akhil Venugopal": 1 }, undatedByConsultant: {},
  });
  assert.deepEqual(await consultantMembershipSummary(september), { counts: {}, undatedByConsultant: {} });
  const resolved = await resolveLinkedMembershipDeals([source, parent]);
  assert.deepEqual(resolved.resolvedFrom, { opportunity: "membership" });
  assert.deepEqual(resolved.deals.map(d => d.id), ["membership"]);
  assert.equal(source.properties.closedate, "2026-09-19T23:13:33Z");
  assert.equal("membership_paid_date" in source.properties, false); // no CRM/date copying
});

test("fetches a linked membership missing from the initial result, without copying the opportunity's date", async t => {
  t.mock.method(hubspot, "searchDeals", async () => [opportunity("source", { membership_paid_date: "2026-09-19" })]);
  t.mock.method(hubspot, "batchAssociations", async () => ({ source: ["parent"] }));
  t.mock.method(hubspot, "batchRead", async (type: string, ids: string[], properties: string[], options: any) => {
    assert.equal(type, "deals");
    assert.deepEqual(ids, ["parent"]);
    assert.ok(properties.includes("membership_paid_date"));
    assert.ok(properties.includes("booking_consultant"));
    assert.equal(options.strict, true);
    return { parent: member("parent").properties };
  });
  assert.deepEqual((await consultantMembershipSummary(july)).counts, { "Akhil Venugopal": 1 });
  assert.deepEqual(await consultantMembershipSummary(september), { counts: {}, undatedByConsultant: {} });
});

test("multiple property opportunities linking to one membership do not multiply gross sales", async t => {
  const parent = member("parent");
  t.mock.method(hubspot, "batchAssociations", async () => ({
    a: ["a", "parent", "parent", "b"], b: ["parent"],
  }));
  const resolved = await resolveLinkedMembershipDeals([opportunity("a"), opportunity("b"), parent]);
  assert.deepEqual(resolved.deals.map(d => d.id), ["parent"]);
  assert.deepEqual(resolved.linkIssues, {});
});

test("an undated linked membership gets one warning on the membership, not another on its opportunity", async t => {
  const parent = member("parent", { membership_paid_date: "", closedate: "" });
  t.mock.method(hubspot, "searchDeals", async () => [opportunity("source"), parent]);
  t.mock.method(hubspot, "batchAssociations", async () => ({ source: ["parent"], parent: ["source"] }));
  const summary = await consultantMembershipSummary(july);
  assert.deepEqual(summary.counts, {});
  assert.equal(Object.values(summary.undatedByConsultant).flat().length, 1);
  assert.equal(summary.undatedByConsultant["Akhil Venugopal"][0].url.endsWith("/parent"), true);
});

test("ambiguous links keep a review warning, exclude the opportunity and retain distinct membership sales", async t => {
  const records = [opportunity("source", { membership_paid_date: "2026-07-01" }), member("first"), member("second")];
  t.mock.method(hubspot, "searchDeals", async () => records);
  t.mock.method(hubspot, "batchAssociations", async () => ({ source: ["first", "second"] }));
  const summary = await consultantMembershipSummary(july);
  assert.deepEqual(summary.counts, { "Akhil Venugopal": 2 });
  assert.match(summary.undatedByConsultant["Steven Green"][0].reason!, /Multiple linked/);
});

test("no link, unrelated opportunities, tests and referrals cannot supply a membership date", async t => {
  t.mock.method(hubspot, "batchAssociations", async () => ({
    source: ["property", "test", "referral"], property: [],
  }));
  const resolved = await resolveLinkedMembershipDeals([
    opportunity("source"), opportunity("property"),
    member("test", { dealname: "Test membership" }),
    member("referral", { dealstage: "2872614380" }),
  ]);
  assert.deepEqual(resolved.resolvedFrom, {});
});

test("two undated membership records cannot resolve each other in a cycle", async t => {
  t.mock.method(hubspot, "batchAssociations", async () => ({ a: ["b"], b: ["a"] }));
  const resolved = await resolveLinkedMembershipDeals([
    member("a", { membership_paid_date: "" }), member("b", { membership_paid_date: "" }),
  ]);
  assert.deepEqual(resolved.resolvedFrom, {});
  assert.equal(resolved.deals.length, 2);
});

test("unlinked original memberships retain their existing date and gross eligibility", async t => {
  t.mock.method(hubspot, "batchAssociations", async () => { throw new Error("Should not query dated original memberships"); });
  const dated = member("original", { dealstage: MEMBERSHIP_SOLD_STAGES[0] });
  const resolved = await resolveLinkedMembershipDeals([dated]);
  assert.deepEqual(resolved.deals, [dated]);
});

test("failed or partial link retrieval is not misreported as a missing signup date", async t => {
  t.mock.method(hubspot, "batchAssociations", async () => ({}));
  await assert.rejects(resolveLinkedMembershipDeals([opportunity("source")]), /lookup incomplete/);
  t.mock.method(hubspot, "batchAssociations", async () => ({ source: ["parent"] }));
  t.mock.method(hubspot, "batchRead", async () => ({}));
  await assert.rejects(resolveLinkedMembershipDeals([opportunity("source")]), /details unavailable/);
});
