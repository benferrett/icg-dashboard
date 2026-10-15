import test from "node:test";
import assert from "node:assert/strict";
import { buildBookingRows, summarise, clientFromTitle } from "./bookings";

const now = Date.parse("2026-10-15T00:00:00Z");
const title = (n: string) => `Inner Circle Group Discovery Session: ${n} With Renee O'Connell Via Zoom`;
const mtg = (id: string, created: string, start: string, end?: string) => ({
  id,
  properties: {
    hs_meeting_title: title(`Client ${id}`),
    hs_createdate: created,
    hs_meeting_start_time: start,
    hs_meeting_end_time: end || start,
    hubspot_owner_id: "363222039",
  },
});

function base() {
  return {
    meetings: [
      mtg("m1", "2026-10-13T01:00:00Z", "2026-10-14T01:00:00Z"), // past, sat
      mtg("m2", "2026-10-13T02:00:00Z", "2026-10-20T01:00:00Z"), // future
      mtg("m3", "2026-10-14T02:00:00Z", "2026-10-21T01:00:00Z"), // rebook of c2
      mtg("m4", "2026-10-14T03:00:00Z", "2026-10-14T05:00:00Z"), // organic lead
      mtg("m5", "2026-10-14T04:00:00Z", "2026-10-14T06:00:00Z"), // no-show
    ],
    dealAssoc: { m1: ["d1"], m2: ["d2"], m3: ["d2"], m4: ["d4"], m5: ["d5"] },
    contactAssoc: { m1: ["c1"], m2: ["c2"], m3: ["c2"], m4: ["c4"], m5: ["c5"] },
    dealProps: {
      d1: { dealstage: "2400252397", booking_consultant: "362741341" },
      d2: { dealstage: "2870714823" },
      d4: { dealstage: "2870714823" },
      d5: { dealstage: "2868125118" },
    },
    contactProps: {
      c1: { firstname: "Ann", lastname: "Lee", createdate: "2026-10-12T00:00:00Z", hs_analytics_source: "PAID_SOCIAL", hs_analytics_first_url: "https://x.com/?utm_content=Fallback&hsa_ad=111" },
      c2: { firstname: "Bob", createdate: "2026-10-10T00:00:00Z", lead_source: "EMBR" },
      c4: { firstname: "Cat", createdate: "2026-10-01T00:00:00Z", hs_analytics_source: "ORGANIC_SEARCH" },
      c5: { firstname: "Dan", createdate: "2026-10-11T00:00:00Z", hs_analytics_source: "PAID_SOCIAL", hs_analytics_first_url: "https://x.com/?utm_campaign=Layer%202&hsa_ad=999" },
    },
    contactHistory: {
      c2: { hubspot_owner_id: [
        { value: "363222039", timestamp: "2026-10-13T00:00:00Z" },
        { value: "362495114", timestamp: "2026-10-10T00:00:00Z" },
      ] },
    },
    contactCalls: { c1: ["k1", "k2", "k3", "k4"], c2: ["k5"] },
    callProps: {
      k1: { hs_call_direction: "OUTBOUND", hs_timestamp: "2026-10-12T01:00:00Z", hs_call_duration: "5000" },
      k2: { hs_call_direction: "OUTBOUND", hs_timestamp: "2026-10-13T00:30:00Z", hs_call_duration: "400000", hs_call_disposition: "f240bbac-87c9-4f6e-bf70-924b57d47db7" },
      k3: { hs_call_direction: "INBOUND", hs_timestamp: "2026-10-12T02:00:00Z" },
      k4: { hs_call_direction: "OUTBOUND", hs_timestamp: "2026-10-13T05:00:00Z" }, // after booking
      k5: { hs_call_direction: "OUTBOUND", hs_timestamp: "2026-10-12T00:00:00Z" },
    },
    ads: { "111": { name: "Video Ad A", campaign: "Layer 2 Lead Generation" } },
    now,
  };
}

test("title parsing", () => {
  assert.equal(clientFromTitle(title("Jane Doe")), "Jane Doe");
});

test("rows: sat, booker, ad, lead date and dials before booking", () => {
  const rows = buildBookingRows(base());
  const r1 = rows.find((r) => r.meetingId === "m1")!;
  assert.equal(r1.client, "Ann Lee");
  assert.equal(r1.status, "sat");
  assert.equal(r1.booker, "Steven Green");
  assert.equal(r1.adName, "Video Ad A");
  assert.equal(r1.campaignName, "Layer 2 Lead Generation");
  assert.equal(r1.leadCreatedAt, "2026-10-12T00:00:00Z");
  assert.equal(r1.dials, 2); // inbound and post-booking calls excluded
  assert.equal(r1.connectedDials, 1);
  assert.equal(r1.strategist, "Renee O'Connell");
  assert.ok(r1.counted);
});

test("booker falls back to earliest consultant owner; EMBR label; future = upcoming", () => {
  const r2 = buildBookingRows(base()).find((r) => r.meetingId === "m2")!;
  assert.equal(r2.booker, "Akhil Venugopal");
  assert.equal(r2.adName, "EMBR lead");
  assert.equal(r2.status, "upcoming");
  assert.equal(r2.dials, 1);
});

test("rebooks and non-paid sources are listed but not counted", () => {
  const rows = buildBookingRows(base());
  assert.equal(rows.find((r) => r.meetingId === "m3")!.excludedReason, "rebook");
  assert.equal(rows.find((r) => r.meetingId === "m4")!.excludedReason, "source");
  const t = summarise(rows);
  assert.equal(t.all, 5);
  assert.equal(t.counted, 3);
  assert.equal(t.sat, 1);
  assert.equal(t.notSat, 1);
  assert.equal(t.upcoming, 1);
});

test("unknown Meta ad falls back to UTM label; no-show stage is a cross", () => {
  const r5 = buildBookingRows(base()).find((r) => r.meetingId === "m5")!;
  assert.equal(r5.adName, "Layer 2");
  assert.equal(r5.status, "no_show_or_reschedule");
});

test("missing CRM update is awaiting confirmation, not no-show", () => {
  const b = base();
  b.dealProps.d1 = { dealstage: "2870714823" } as any;
  const r1 = buildBookingRows(b).find((r) => r.meetingId === "m1")!;
  assert.equal(r1.status, "awaiting_confirmation");
});

test("signed up: paid tier shown; refund flagged; referral ignored", () => {
  const b: any = base();
  b.contactDeals = { c1: ["d1", "x1"], c2: ["d2", "x2"], c5: ["x5"] };
  b.membershipProps = {
    d1: { dealname: "Ann Lee - Membership", pipeline: "1448193481", dealstage: "2399433181", membership_paid_date: "2026-10-14" },
    x2: { dealname: "Bob - Membership", pipeline: "1448193481", dealstage: "3152097752", hs_v2_date_entered_2547683827: "2026-10-01T00:00:00Z" },
    x5: { dealname: "Dan - Referral", pipeline: "1448193481", dealstage: "2872614380" },
  };
  const rows = buildBookingRows(b);
  const r1 = rows.find((r) => r.meetingId === "m1")!;
  assert.equal(r1.membership, "signed_up");
  assert.equal(r1.membershipTier, "Silver");
  assert.ok(r1.membershipDate?.startsWith("2026-10-13T14"));
  const r2 = rows.find((r) => r.meetingId === "m2")!;
  assert.equal(r2.membership, "refunded");
  assert.equal(r2.membershipTier, "Gold");
  assert.equal(rows.find((r) => r.meetingId === "m5")!.membership, null);
  assert.equal(summarise(rows).signedUp, 1);
});
