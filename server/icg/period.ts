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

// ---- Trend buckets (Business Performance) ---------------------------------
// A contiguous series of time buckets (weeks or months) covering roughly the
// last 12 units up to now, in Australia/Melbourne local time. Each bucket is a
// half-open [start, end) UTC-ISO window plus a short display label. The series
// is oldest-first so charts read left→right in time order.

export type Granularity = "week" | "month";

export interface Bucket {
  label: string; // e.g. "7 Jul" (week start) or "Jul 26" (month)
  start: string; // inclusive, UTC ISO
  end: string; // exclusive, UTC ISO
}

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Build the trailing `count` buckets ending with the CURRENT (in-progress)
// week/month. Boundaries are Melbourne-local midnights converted to UTC.
export function buildBuckets(granularity: Granularity, count = 12): Bucket[] {
  const nowMs = Date.now();
  const nowMel = new Date(nowMs + MEL_OFFSET_MS);
  const y = nowMel.getUTCFullYear();
  const m = nowMel.getUTCMonth();
  const d = nowMel.getUTCDate();
  const buckets: Bucket[] = [];

  if (granularity === "month") {
    // Current month back through (count-1) previous months.
    for (let i = count - 1; i >= 0; i--) {
      const startMs = melMidnightUtc(y, m - i, 1);
      const endMs = melMidnightUtc(y, m - i + 1, 1);
      const label = `${MONTH_ABBR[(((m - i) % 12) + 12) % 12]} ${String(
        new Date(startMs + MEL_OFFSET_MS).getUTCFullYear(),
      ).slice(2)}`;
      buckets.push({ label, start: iso(startMs), end: iso(endMs) });
    }
  } else {
    // Weeks start Monday (Melbourne). Find Monday of the current week.
    const dow = nowMel.getUTCDay(); // 0=Sun..6=Sat
    const daysSinceMon = (dow + 6) % 7;
    for (let i = count - 1; i >= 0; i--) {
      const startMs = melMidnightUtc(y, m, d - daysSinceMon - i * 7);
      const endMs = melMidnightUtc(y, m, d - daysSinceMon - i * 7 + 7);
      const ws = new Date(startMs + MEL_OFFSET_MS);
      const label = `${ws.getUTCDate()} ${MONTH_ABBR[ws.getUTCMonth()]}`;
      buckets.push({ label, start: iso(startMs), end: iso(endMs) });
    }
  }
  return buckets;
}
