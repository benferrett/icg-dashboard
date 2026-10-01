import type { Dashboard } from "./api";

type ConsultantPerformance = Pick<
  Dashboard["consultants"][number],
  "dsBooked" | "dsScheduled" | "dsSat" | "sold"
>;

// Reuse the existing Consultant Performance payload. Do not introduce a
// second attribution query or mix booking-created and held-window denominators.
export function scorecardOutcomes(row?: ConsultantPerformance) {
  return {
    dsBooked: row?.dsBooked ?? null,
    dsScheduled: row?.dsScheduled ?? null,
    dsSat: row?.dsSat ?? null,
    members: row?.sold ?? null,
    sitRate: row && row.dsScheduled > 0
      ? Math.round(row.dsSat / row.dsScheduled * 100) : null,
    membershipConversion: row && row.dsSat > 0
      ? Math.round(row.sold / row.dsSat * 100) : null,
  };
}

export type ScorecardOutcomes = ReturnType<typeof scorecardOutcomes>;
