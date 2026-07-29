// Period (date-range) model for the dashboard's global period selector.
// All boundaries are computed in Australia/Melbourne local time (UTC+10, no DST
// in the business's operating window) and returned as UTC ISO instants.

export type PeriodKey =
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "last_3_months"
  | "this_year"
  | "custom";

export const PERIOD_KEYS: PeriodKey[] = [
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "last_3_months",
  "this_year",
];

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  this_week: "This Week",
  last_week: "Last Week",
  this_month: "This Month",
  last_month: "Last Month",
  last_3_months: "Last 3 Months",
  this_year: "This Year",
  custom: "Custom Range",
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
    case "last_3_months": {
      // Rolling 3 calendar months: first day of the month 2 months ago
      // through now (current month included, in progress).
      startMs = melMidnightUtc(y, m - 2, 1);
      endMs = nowMs;
      break;
    }
    case "this_year": {
      startMs = melMidnightUtc(y, 0, 1); // 1 Jan, calendar year
      endMs = nowMs;
      break;
    }
    default: {
      // "custom" is never resolved here (it comes via parseCustomRange); fall
      // back to this-week so startMs/endMs are always assigned.
      startMs = melMidnightUtc(y, m, d - daysSinceMon);
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

// ---- Custom (user-picked calendar) range ----------------------------------
// Accepts two YYYY-MM-DD dates (Melbourne local calendar days). The range is
// half-open [start 00:00, endDay+1 00:00) so the END DATE IS INCLUSIVE — picking
// 1 Jun -> 30 Jun covers all of June. Boundaries use the same Melbourne-midnight
// -> UTC math as the presets, so custom ranges line up exactly with presets.
// Returns null if the input is malformed or start is after end.
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseCustomRange(
  startRaw?: string | null,
  endRaw?: string | null,
): PeriodRange | null {
  if (!startRaw || !endRaw) return null;
  const ms = DATE_RE.exec(startRaw);
  const me = DATE_RE.exec(endRaw);
  if (!ms || !me) return null;
  const [, sy, sm, sd] = ms.map(Number) as unknown as [string, number, number, number];
  const [, ey, em, ed] = me.map(Number) as unknown as [string, number, number, number];
  const startMs = melMidnightUtc(sy, sm - 1, sd);
  // End date inclusive -> exclusive boundary is the following midnight.
  const endMs = melMidnightUtc(ey, em - 1, ed + 1);
  if (!(startMs < endMs)) return null;
  const label = `${sd} ${MONTH_ABBR_SHORT[sm - 1]} – ${ed} ${MONTH_ABBR_SHORT[em - 1]}`;
  return { key: "custom", label, start: iso(startMs), end: iso(endMs) };
}

const MONTH_ABBR_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

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
