import test from "node:test";
import assert from "node:assert/strict";
import { eoiMilestoneMs, eoiRefundMs, eoiPipelineFilterGroups, isEoiTestRecord } from "./eoi-reporting";
import { hubspot } from "./hubspot";
import { contracts, businessPerformance, monthlyReport2026 } from "./metrics";
import { CONTRACT_EOI_STAGES, CONTRACT_EOI_REFUND_ENTERED_PROP, CONTRACT_EOI_REFUND_STAGE, CONTRACT_PIPELINE, CONTRACT_EOI_PIPELINES } from "./reference";

const entered = `hs_v2_date_entered_${CONTRACT_EOI_STAGES[0]}`;
const otherEntered = `hs_v2_date_entered_${CONTRACT_EOI_STAGES[1]}`;

test("EOI Paid Date wins over later stage entry; valid legacy history is the only fallback", () => {
  assert.equal(eoiMilestoneMs({ eoi_paid_date: "2026-08-31", [entered]: "2026-09-02T01:00:00Z" }), Date.parse("2026-08-31"));
  assert.equal(eoiMilestoneMs({ eoi_paid_date: "invalid", [entered]: "2026-09-03", [otherEntered]: "2026-09-01" }), Date.parse("2026-09-01"));
  assert.ok(Number.isNaN(eoiMilestoneMs({ closedate: "2026-09-01", createdate: "2026-09-01", dealstage: CONTRACT_EOI_STAGES[0] })));
  assert.ok(Number.isNaN(eoiRefundMs({ closedate: "2026-09-01", dealstage: CONTRACT_EOI_REFUND_STAGE })));
  assert.equal(eoiRefundMs({ dealstage: "moved-again", [CONTRACT_EOI_REFUND_ENTERED_PROP]: "2026-10-01" }), Date.parse("2026-10-01"));
  assert.equal(isEoiTestRecord({ dealname: "Test-Raul" }), true);
  assert.equal(isEoiTestRecord({ dealname: "Real client", strategist: "" }), false);
  assert.ok(eoiPipelineFilterGroups()[0].filters[0].values.includes(CONTRACT_EOI_PIPELINES[0]));
});

test("Overview, Business Performance and annual report reconcile gross EOIs and independent refund months", async (t) => {
  t.mock.method(Date, "now", () => Date.parse("2026-10-01T06:49:00Z"));
  const props = (id: string, p: Record<string, string>) => ({
    id, properties: { pipeline: CONTRACT_PIPELINE, dealstage: CONTRACT_EOI_STAGES[0], dealname: `Sample property ${id}`, amount: "100000", ...p },
  });
  const records = [
    props("later-refund", { eoi_paid_date: "2026-09-04", dealstage: CONTRACT_EOI_REFUND_STAGE, [CONTRACT_EOI_REFUND_ENTERED_PROP]: "2026-10-01T01:17:00Z" }),
    props("same-month-refund", { eoi_paid_date: "2026-09-11", dealstage: CONTRACT_EOI_REFUND_STAGE, [CONTRACT_EOI_REFUND_ENTERED_PROP]: "2026-09-28T00:56:00Z" }),
    props("earlier-sale-refund", { eoi_paid_date: "2026-08-30", dealstage: CONTRACT_EOI_REFUND_STAGE, [CONTRACT_EOI_REFUND_ENTERED_PROP]: "2026-09-14T03:16:00Z" }),
    props("moved-property", { eoi_paid_date: "2026-09-12", pipeline: CONTRACT_EOI_PIPELINES[0], dealstage: "another-stage" }),
    props("progressed", { eoi_paid_date: "2026-09-01", dealstage: "3113781723", strategist: "363184380", hs_v2_date_entered_3113781723: "2026-10-01T02:00:00Z" }),
    props("legacy", { [entered]: "2026-09-30T13:59:59Z" }),
    props("boundary", { [entered]: "2026-09-30T14:00:00Z" }),
    props("original-date", { eoi_paid_date: "2026-08-31", [entered]: "2026-09-02T03:51:00Z" }),
    props("test", { dealname: "Test-Raul", eoi_paid_date: "2026-09-01", [CONTRACT_EOI_REFUND_ENTERED_PROP]: "2026-09-02" }),
    props("no-date", { closedate: "2026-09-01" }),
    props("reopened", { eoi_paid_date: "2026-08-02", [CONTRACT_EOI_REFUND_ENTERED_PROP]: "2026-09-03T00:19:00Z" }),
  ];
  t.mock.method(hubspot, "searchDeals", async (query: any) => {
    assert.ok(query.properties.includes("eoi_paid_date"));
    assert.deepEqual(query.filterGroups, eoiPipelineFilterGroups());
    // Emulate HubSpot only returning requested properties.
    return records.map(r => ({ ...r, properties: Object.fromEntries(Object.entries(r.properties).filter(([k]) => query.properties.includes(k))) }));
  });
  t.mock.method(hubspot, "searchObjects", async () => []);
  t.mock.method(hubspot, "countContacts", async () => 0);
  t.mock.method(hubspot, "batchAssociations", async () => ({}));
  t.mock.method(hubspot, "batchRead", async () => ({}));
  const sept = await contracts({ key: "custom", label: "September", start: "2026-08-31T14:00:00Z", end: "2026-09-30T14:00:00Z" });
  const oct = await contracts({ key: "custom", label: "October", start: "2026-09-30T14:00:00Z", end: "2026-10-01T06:49:00Z" });
  const gross = (d: typeof sept) => d.funnel.find(s => s.key === "eoi")!.count;
  assert.equal(gross(sept), 5);
  assert.equal(sept.eoiRefunds, 3);
  assert.equal(sept.deals.filter(d => d.eoiDate).length, 5);
  assert.equal(sept.byStrategist.find(r => r.name === "Unattributed")!.eoi, 4);
  assert.equal(gross(oct), 1);
  assert.equal(oct.eoiRefunds, 1);
  assert.ok(sept.deals.some(d => d.url.endsWith("/later-refund")));
  assert.ok(oct.refunds.some(d => d.url.endsWith("/later-refund")));
  const monthly = await businessPerformance("month");
  for (const [label, overview] of [["Sep 26", sept], ["Oct 26", oct]] as const) {
    const row = monthly.rows.find(r => r.label === label)!;
    assert.equal(row.eois, gross(overview));
    assert.equal(row.eoiRefunds, overview.eoiRefunds);
  }
  assert.equal(monthly.totals.eois, monthly.rows.reduce((s, r) => s + r.eois, 0));
  assert.equal(monthly.totals.eoiRefunds, 4);
  const weekly = await businessPerformance("week");
  assert.equal(weekly.totals.eoiRefunds, 4);
  const annual = await monthlyReport2026(2026);
  const september = annual.rows.find(r => r.label.startsWith("Sep"))!;
  assert.equal(september.eois, gross(sept));
  assert.equal(september.eoiRefunds, sept.eoiRefunds);
});
