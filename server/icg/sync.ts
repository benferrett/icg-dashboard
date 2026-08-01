// Background sync for the HubSpot response cache (hs-cache.ts).
//
// Pre-executes the dashboard build for the common presets AND a rolling set of
// recent month windows. Each build fans out into many HubSpot reads that are
// now cached by hs-cache. So after a sync:
//   * every preset is instant (also covered by the snapshot warmer), and
//   * arbitrary custom ranges reuse cached day-sliced meeting/call queries and
//     object-id-keyed batch reads (the heaviest part of a cold build), so their
//     first load is dramatically faster even when not fully pre-computed.
//
// Two cadences (driven by routes.ts timers / the scheduled task):
//   * FULL   — rebuild everything from live HubSpot, refreshing all cache
//              entries. Run nightly (off-peak) + once shortly after boot if the
//              cache is empty.
//   * INCREMENTAL — re-run just the current-period builds (this_week/month, and
//              the current month window) so today's numbers stay fresh through
//              the day without a full sweep.

import { buildDashboard, businessPerformance } from "./metrics";
import { metaAds } from "./meta";
import { resolvePeriod, parseCustomRange } from "./period";
import {
  cacheEnabled,
  setHsSyncState,
  getHsSyncState,
  purgeOlderThan,
  hsCacheInfo,
} from "./hs-cache";

// Recent month windows as YYYY-MM-DD custom ranges (Melbourne calendar). We
// cover the trailing `months` calendar months so quarter/month custom picks
// reuse cached slices.
function recentMonthRanges(months: number): Array<{ start: string; end: string }> {
  const MEL = 10 * 60 * 60 * 1000;
  const now = new Date(Date.now() + MEL);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const out: Array<{ start: string; end: string }> = [];
  const fmt = (yy: number, mm: number, dd: number) =>
    `${yy}-${String(mm + 1).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  for (let i = 0; i < months; i++) {
    const first = new Date(Date.UTC(y, m - i, 1));
    const last = new Date(Date.UTC(y, m - i + 1, 0)); // day 0 of next month = last day
    out.push({
      start: fmt(first.getUTCFullYear(), first.getUTCMonth(), 1),
      end: fmt(last.getUTCFullYear(), last.getUTCMonth(), last.getUTCDate()),
    });
  }
  return out;
}

const PRESETS = [
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "last_3_months",
  "this_year",
];

let syncing = false;

// Run a single dashboard build (+ meta + business perf) so all underlying
// HubSpot reads get cached. Errors are swallowed per-target so one failure
// doesn't abort the whole sync.
async function warmTarget(label: string, run: () => Promise<any>) {
  const t0 = Date.now();
  try {
    await run();
    console.log(`[sync] warmed ${label} in ${Math.round((Date.now() - t0) / 1000)}s`);
  } catch (e) {
    console.error(`[sync] ${label} failed:`, (e as any)?.message);
  }
}

export async function runSync(mode: "full" | "incremental"): Promise<void> {
  if (!cacheEnabled()) return;
  if (syncing) {
    console.log("[sync] already running, skipping");
    return;
  }
  syncing = true;
  const started = Date.now();
  try {
    if (mode === "full") {
      // Presets.
      for (const p of PRESETS) {
        await warmTarget(`preset ${p}`, () => buildDashboard(p));
        await warmTarget(`meta ${p}`, () => metaAds(resolvePeriod(p as any)));
      }
      // Business performance (both granularities).
      await warmTarget("bizperf week", () => businessPerformance("week"));
      await warmTarget("bizperf month", () => businessPerformance("month"));
      // Rolling recent month windows so custom month/quarter picks are fast.
      for (const r of recentMonthRanges(6)) {
        const range = parseCustomRange(r.start, r.end);
        if (!range) continue;
        await warmTarget(`month ${r.start}..${r.end}`, () => buildDashboard(range));
        await warmTarget(`meta month ${r.start}`, () => metaAds(range));
      }
      setHsSyncState("last_full", new Date().toISOString());
      // Bound DB growth: drop entries older than 3 days (a full sync refreshes
      // everything we care about well within that).
      const purged = purgeOlderThan(3 * 24 * 60 * 60 * 1000);
      if (purged) console.log(`[sync] purged ${purged} stale cache entries`);
    } else {
      // Incremental: just the in-progress current periods.
      for (const p of ["this_week", "this_month"]) {
        await warmTarget(`preset ${p}`, () => buildDashboard(p));
        await warmTarget(`meta ${p}`, () => metaAds(resolvePeriod(p as any)));
      }
      await warmTarget("bizperf month", () => businessPerformance("month"));
      setHsSyncState("last_incremental", new Date().toISOString());
    }
    console.log(
      `[sync] ${mode} complete in ${Math.round((Date.now() - started) / 1000)}s`,
      hsCacheInfo(),
    );
  } finally {
    syncing = false;
  }
}

export function isSyncing() {
  return syncing;
}

export function lastSync() {
  return {
    full: getHsSyncState("last_full"),
    incremental: getHsSyncState("last_incremental"),
  };
}
