// Period (date-range) model for the dashboard's global period selector.
// All boundaries are computed in Australia/Melbourne local time (UTC+10, no DST
// in the business's operating window) and returned as UTC ISO instants.

export type PeriodKey =
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "this_year";

export const PERIOD_KEYS: PeriodKey[] = [
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "this_year",
];

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  this_week: "This Week",
  last_week: "Last Week",
  this_month: "This Month",
  last_month: "Last Month",
  this_year: "This Year",
};

export interface PeriodRange {
  key: PeriodKey;
  label: string;
  start: string; // inclusive, UTC ISO
  end: string; // exclusive, UTC ISO (= now for current periods)
}

const MEL_OFFSET_MS = 10 * 60 * 60 * 1000; // Australia/Melbourne

// Convert a Melbourne wall-clock Y/M/D (midnight) to the true UTC instant.
function melMidnightUtc(y: number, m: number, d: number): number {
  return Date.UTC(y, m, d, 0, 0, 0) - MEL_OFFSET_MS;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

export function resolvePeriod(key: PeriodKey): PeriodRange {
  const nowMs = Date.now();
  const nowMel = new Date(nowMs + MEL_OFFSET_MS);
  const y = nowMel.getUTCFullYear();
  const m = nowMel.getUTCMonth(); // 0-based
  const d = nowMel.getUTCDate();
  const dow = nowMel.getUTCDay(); // 0=Sun..6=Sat
  const daysSinceMon = (dow + 6) % 7;

  let startMs: number;
  let endMs: number;

  switch (key) {
    case "this_week": {
      startMs = melMidnightUtc(y, m, d - daysSinceMon);
      endMs = nowMs;
      break;
    }
    case "last_week": {
      startMs = melMidnightUtc(y, m, d - daysSinceMon - 7);
      endMs = melMidnightUtc(y, m, d - daysSinceMon);
      break;
    }
    case "this_month": {
      startMs = melMidnightUtc(y, m, 1);
      endMs = nowMs;
      break;
    }
    case "last_month": {
      // First day of previous month -> first day of this month.
      startMs = melMidnightUtc(y, m - 1, 1);
      endMs = melMidnightUtc(y, m, 1);
      break;
    }
    case "this_year": {
      startMs = melMidnightUtc(y, 0, 1); // 1 Jan, calendar year
      endMs = nowMs;
      break;
    }
  }

  return { key, label: PERIOD_LABELS[key], start: iso(startMs), end: iso(endMs) };
}

export function parsePeriod(raw?: string | null): PeriodRange {
  const key = (raw && (PERIOD_KEYS as string[]).includes(raw) ? raw : "this_week") as PeriodKey;
  return resolvePeriod(key);
}
