import test from "node:test";
import assert from "node:assert/strict";
import { scorecardOutcomes } from "../../client/src/lib/consultant-scorecard-outcomes";

test("scorecard outcomes reuse consultant figures with the scheduled, not booked, sit denominator", () => {
  assert.deepEqual(scorecardOutcomes({ dsBooked: 20, dsScheduled: 12, dsSat: 9, sold: 3 }), {
    dsBooked: 20, dsScheduled: 12, dsSat: 9, members: 3, sitRate: 75, membershipConversion: 33,
  });
});
test("zero denominators are unavailable, while genuine zero conversion remains zero", () => {
  const none = scorecardOutcomes({ dsBooked: 4, dsScheduled: 0, dsSat: 0, sold: 0 });
  assert.equal(none.sitRate, null);
  assert.equal(none.membershipConversion, null);
  assert.equal(none.members, 0);
  const zero = scorecardOutcomes({ dsBooked: 4, dsScheduled: 3, dsSat: 2, sold: 0 });
  assert.equal(zero.sitRate, 67);
  assert.equal(zero.membershipConversion, 0);
});
test("missing consultant data is unknown rather than an invented zero", () => {
  const missing = scorecardOutcomes();
  assert.equal(missing.dsBooked, null);
  assert.equal(missing.members, null);
  assert.equal(missing.sitRate, null);
  assert.equal(missing.membershipConversion, null);
});
test("period members are not capped to sits or treated as same-cohort outcomes", () => {
  assert.equal(scorecardOutcomes({ dsBooked: 0, dsScheduled: 2, dsSat: 1, sold: 2 }).membershipConversion, 200);
});
