import test from "node:test";
import assert from "node:assert/strict";
import { attendanceRows, classifyAttendance, recoverMembershipAssociations, loadAttendanceContext } from "./attendance";
import { attendanceReviews } from "./attendance-reviews";
import { hubspot } from "./hubspot";

const now = Date.parse("2026-09-17T06:00:00Z");
const meeting = (id = "m1", start = "2026-09-16T05:30:00Z") => ({
  id, properties: { hs_meeting_start_time: start, hs_meeting_title: "Same client name", hs_meeting_outcome: "SCHEDULED" },
});
const satDeal = { pipeline: "1448193481", dealstage: "2400252397" };

test("reviewed evidence counts attended even when CRM remains Booked", () => {
  const review = attendanceReviews[0];
  const result = classifyAttendance(meeting(review.meetingId, review.startTime),
    [review.dealId], { [review.dealId]: { dealstage: "2870714823" } }, now);
  assert.equal(result.status, "sat");
  assert.ok(result.evidenceUrl?.includes(review.dealId));
  assert.ok(result.reason.includes(review.noteId));
});
test("review is scoped to exact meeting, deal and held time", () => {
  const r = attendanceReviews[0];
  for (const [m, ids] of [
    [meeting("other"), [r.dealId]],
    [meeting(r.meetingId), ["other"]],
    [meeting(r.meetingId, "2026-09-15T05:30:00Z"), [r.dealId]],
  ] as const) assert.notEqual(classifyAttendance(m, [...ids], {}, now).status, "sat");
});
test("Booked and SCHEDULED are awaiting confirmation, never a no-show", () => {
  assert.equal(classifyAttendance(meeting(), ["d"], { d: { dealstage: "2870714823" } }, now).status, "awaiting_confirmation");
});
test("raw COMPLETED and NO_SHOW outcomes are not attendance authority", () => {
  for (const outcome of ["COMPLETED", "NO_SHOW", "CANCELED"]) {
    const m = meeting();
    m.properties.hs_meeting_outcome = outcome;
    assert.equal(classifyAttendance(m, ["d"], {}, now).status, "awaiting_confirmation");
  }
});
test("DS Sat - Missed is attended; explicit CRM no-show is separately labelled", () => {
  assert.equal(classifyAttendance(meeting(), ["d"], { d: { dealstage: "2400252399" } }, now).status, "sat");
  assert.equal(classifyAttendance(meeting(), ["d"], { d: { dealstage: "2868125118" } }, now).status, "no_show_or_reschedule");
});
test("future and in-progress sessions never count as sat", () => {
  assert.equal(classifyAttendance(meeting("m", "2026-09-18T05:00:00Z"), ["d"], { d: satDeal }, now).status, "upcoming");
  const m = { ...meeting(), properties: { ...meeting().properties, hs_meeting_end_time: "2026-09-18T05:00:00Z" } };
  assert.equal(classifyAttendance(m, ["d"], { d: satDeal }, now).status, "upcoming");
  assert.equal(classifyAttendance(m, [], {}, now).status, "upcoming");
});
test("late stage updates do not change the held date", () => {
  assert.equal(classifyAttendance(meeting(), ["d"], {
    d: { ...satDeal, hs_v2_date_entered_2400252397: "2026-09-17T02:00:00Z" },
  }, now).status, "sat");
});
test("missing direct deal link recovers unique membership via contact", () => {
  const resolved = recoverMembershipAssociations([meeting()], {}, { m1: ["c"] },
    { c: ["property", "d"] }, { property: { pipeline: "1527507417" }, d: satDeal });
  assert.deepEqual(resolved.m1, ["d"]);
});
test("consultant/DNQ pipeline links are retained, including no-shows", () => {
  assert.deepEqual(recoverMembershipAssociations([meeting()], { m1: ["d"] }, {}, {},
    { d: { pipeline: "1446363635", dealstage: "2868125118" } }).m1, ["d"]);
});
test("ambiguous memberships are not silently attributed", () => {
  assert.deepEqual(recoverMembershipAssociations([meeting()], {}, { m1: ["c"] },
    { c: ["a", "b"] }, { a: satDeal, b: satDeal }).m1, []);
});
test("shared grouping reconciles numerator, denominator and rows", () => {
  const rows = attendanceRows([meeting(), meeting("m2"), meeting("m3")],
    { m1: ["d"], m2: ["d"], m3: ["e"] }, {}, { d: satDeal }, now);
  assert.equal(rows.length, 2);
  assert.equal(rows.filter((r) => r.attendance.status === "sat").length, 1);
  assert.equal(rows[1].attendance.status, "awaiting_confirmation");
});
test("identical display names do not merge different CRM people", () => {
  assert.equal(attendanceRows([meeting(), meeting("m2")],
    { m1: ["d"], m2: ["e"] }, {}, { d: satDeal, e: satDeal }, now).length, 2);
});
test("a reviewed cancellation cannot be overwritten by a later sale stage", () => {
  const r = attendanceReviews.find((x) => x.status === "cancelled")!;
  assert.equal(classifyAttendance(meeting(r.meetingId, r.startTime),
    [r.dealId], { [r.dealId]: satDeal }, now).status, "cancelled");
});
test("association loader recovers missing links and propagates CRM errors", async () => {
  const read = hubspot.batchRead;
  const assoc = hubspot.batchAssociations;
  try {
    hubspot.batchRead = async () => ({ d: satDeal });
    hubspot.batchAssociations = async () => ({ c: ["d"] });
    const loaded = await loadAttendanceContext([meeting()], {}, { m1: ["c"] });
    assert.deepEqual(loaded.dealAssoc.m1, ["d"]);
    hubspot.batchAssociations = async () => { throw new Error("CRM unavailable"); };
    await assert.rejects(loadAttendanceContext([meeting()], {}, { m1: ["c"] }), /CRM unavailable/);
  } finally {
    hubspot.batchRead = read;
    hubspot.batchAssociations = assoc;
  }
});
