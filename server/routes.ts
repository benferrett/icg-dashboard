import type { Express, Request, Response, NextFunction } from "express";
import { createServer } from "node:http";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { buildDashboard, businessPerformance } from "./icg/metrics";
import { parsePeriod, parseCustomRange } from "./icg/period";
import { metaAds } from "./icg/meta";
import {
  readSnapshot,
  writeSnapshot,
  readAllSnapshots,
  snapshotStoreInfo,
} from "./icg/snapshot-store";
import { hsCacheInfo, getHsSyncState } from "./icg/hs-cache";
import { runSync, isSyncing, lastSync } from "./icg/sync";

// --- Simple session-token auth (no cookies/localStorage; token returned to client) ---
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || "InnerCircle2026$$";
const sessions = new Set<string>();

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers["x-icg-token"] as string | undefined;
  if (token && sessions.has(token)) return next();
  return res.status(401).json({ error: "Unauthorized" });
}

// --- Snapshot cache (stale-while-revalidate, disk-backed) -----------------
// Each entry holds the last computed payload, WHEN it was computed, and HOW to
// rebuild it (`fn`). Two big behaviours make the dashboard feel instant:
//
// 1. STALE-WHILE-REVALIDATE: we ALWAYS serve an existing snapshot immediately —
//    even an expired one — and kick off a background refresh if it's stale. The
//    visitor never waits on a cold HubSpot rebuild once ANY snapshot exists.
//    Only the very first request for a key (nothing on disk or in memory) has
//    to block on the live fetch.
//
// 2. DISK PERSISTENCE: every computed payload is also written to SQLite (on a
//    Railway volume when one is attached). On boot we seed memory from disk, so
//    a redeploy/restart no longer wipes the cache — presets and previously
//    viewed ranges stay instant across deploys.
interface CacheEntry {
  data: any;
  computedAt: number; // epoch ms when this payload was produced
  fn: () => Promise<any>;
  refreshing?: boolean; // a background revalidation is already in flight
}
const cache = new Map<string, CacheEntry>();
const TTL_MS = 5 * 60 * 1000; // a snapshot older than this is considered stale

// Persist + record a freshly computed payload in both memory and on disk.
function store(key: string, data: any, fn: () => Promise<any>, computedAt: number) {
  cache.set(key, { data, computedAt, fn });
  writeSnapshot(key, data, computedAt);
}

// Decorate a payload with freshness metadata the UI can display.
function withMeta(data: any, computedAt: number, updating: boolean) {
  const ageSec = Math.round((Date.now() - computedAt) / 1000);
  return {
    ...data,
    cached: true,
    computedAt: new Date(computedAt).toISOString(),
    cacheAgeSec: ageSec,
    stale: ageSec > TTL_MS / 1000,
    updating, // true = a background refresh is running; UI shows "updating…"
  };
}

// Trigger a background rebuild for a key without blocking the caller.
function revalidate(key: string, fn: () => Promise<any>) {
  const entry = cache.get(key);
  if (entry?.refreshing) return; // don't stampede
  if (entry) entry.refreshing = true;
  fn()
    .then((data) => store(key, data, fn, Date.now()))
    .catch((e) => console.error(`[revalidate] ${key} failed:`, (e as any)?.message))
    .finally(() => {
      const e2 = cache.get(key);
      if (e2) e2.refreshing = false;
    });
}

async function cached(key: string, fn: () => Promise<any>, force = false) {
  // Seed memory from disk on first touch after a restart.
  if (!cache.has(key)) {
    const disk = readSnapshot(key);
    if (disk) cache.set(key, { data: disk.payload, computedAt: disk.computedAt, fn });
  }

  const hit = cache.get(key);
  // Always adopt the caller's real rebuild fn. Disk-seeded / warmer-seeded
  // entries may carry a placeholder fn; this guarantees a background
  // revalidation actually re-fetches live data.
  if (hit) hit.fn = fn;

  // Forced refresh (refresh=1): block on a fresh rebuild.
  if (force) {
    const data = await fn();
    store(key, data, fn, Date.now());
    return withMeta(data, Date.now(), false);
  }

  if (hit) {
    const ageSec = Math.round((Date.now() - hit.computedAt) / 1000);
    // Serve instantly. If stale, refresh in the background (SWR).
    if (ageSec > TTL_MS / 1000) revalidate(key, fn);
    const updating = ageSec > TTL_MS / 1000 || !!cache.get(key)?.refreshing;
    return withMeta(hit.data, hit.computedAt, updating);
  }

  // Cold: nothing anywhere. Must block on the first live fetch.
  const data = await fn();
  store(key, data, fn, Date.now());
  return { ...data, cached: false, computedAt: new Date().toISOString(), cacheAgeSec: 0, stale: false, updating: false };
}

// --- Background cache warmer ----------------------------------------------
// Periods most people look at. We keep these warm at all times so the common
// case is instant. Other periods (e.g. this_year) still cache on first request.
const WARM_PERIODS = [
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "last_3_months",
  "this_year",
];
const WARM_INTERVAL_MS = 4 * 60 * 1000; // refresh a bit before the 5-min TTL
let warming = false;

// Rebuild one cache entry in place (used by both seeding and periodic refresh).
async function warmKey(key: string, fn: () => Promise<any>) {
  const data = await fn();
  store(key, data, fn, Date.now());
}

async function warmCache() {
  if (warming) return; // never overlap warm cycles
  warming = true;
  try {
    for (const period of WARM_PERIODS) {
      const periodKey = parsePeriod(period).key;
      // Dashboard + Meta, sequentially per period so we don't stampede HubSpot.
      try {
        await warmKey(`dashboard:${periodKey}`, () => buildDashboard(periodKey));
      } catch (e) {
        console.error(`[warm] dashboard:${periodKey} failed:`, (e as any)?.message);
      }
      try {
        const range = parsePeriod(period);
        await warmKey(`meta:${range.key}`, () => metaAds(range));
      } catch (e) {
        console.error(`[warm] meta:${periodKey} failed:`, (e as any)?.message);
      }
    }
    // Keep both business-performance granularities warm (independent of period).
    for (const g of ["week", "month"] as const) {
      try {
        await warmKey(`bizperf:${g}`, () => businessPerformance(g));
      } catch (e) {
        console.error(`[warm] bizperf:${g} failed:`, (e as any)?.message);
      }
    }
  } finally {
    warming = false;
  }
}

// Kick off warming on boot (slightly delayed so the server finishes starting),
// then on a repeating interval. `unref()` keeps the timer from blocking exit.
function startWarmer() {
  // Seed the in-memory cache from disk immediately so the very first visitor
  // after a restart gets an instant (possibly stale) snapshot instead of a
  // cold rebuild. Background warming then refreshes everything.
  try {
    const info = snapshotStoreInfo();
    const seeded = readAllSnapshots();
    for (const s of seeded) {
      if (!cache.has(s.key)) cache.set(s.key, { data: s.payload, computedAt: s.computedAt, fn: async () => s.payload });
    }
    console.log(
      `[warm] seeded ${seeded.length} snapshot(s) from disk (persistent=${info.persistent})`,
    );
  } catch (e) {
    console.error("[warm] disk seed failed:", (e as any)?.message);
  }

  setTimeout(() => {
    warmCache().catch(() => {});
  }, 3000).unref?.();
  setInterval(() => {
    warmCache().catch(() => {});
  }, WARM_INTERVAL_MS).unref?.();
}

// --- HubSpot response-cache sync schedule ---------------------------------
// FULL sync nightly (off-peak Melbourne) + once shortly after boot if the
// cache has never been populated. INCREMENTAL every 30 min to keep today's
// in-progress numbers fresh. All timers unref() so they never block exit.
const INCREMENTAL_MS = 30 * 60 * 1000;
const FULL_CHECK_MS = 60 * 60 * 1000; // hourly check for the nightly window

function melHour(): number {
  const MEL = 10 * 60 * 60 * 1000;
  return new Date(Date.now() + MEL).getUTCHours();
}

function startSync() {
  // Boot: if the response cache has never been fully populated, kick off a full
  // sync a little after boot (after the warmer's first pass). Otherwise just
  // run an incremental top-up.
  setTimeout(() => {
    const everFull = getHsSyncState("last_full");
    runSync(everFull ? "incremental" : "full").catch((e) =>
      console.error("[sync] boot sync failed:", (e as any)?.message),
    );
  }, 20_000).unref?.();

  // Incremental top-ups through the day.
  setInterval(() => {
    runSync("incremental").catch(() => {});
  }, INCREMENTAL_MS).unref?.();

  // Nightly full sync: fire once when Melbourne local hour is 03:00-03:59 and
  // the last full sync wasn't already today.
  let lastFullDay = "";
  setInterval(() => {
    const h = melHour();
    const MEL = 10 * 60 * 60 * 1000;
    const today = new Date(Date.now() + MEL).toISOString().slice(0, 10);
    if (h === 3 && lastFullDay !== today) {
      lastFullDay = today;
      runSync("full").catch((e) => console.error("[sync] nightly failed:", (e as any)?.message));
    }
  }, FULL_CHECK_MS).unref?.();
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  // Login -> returns a session token
  app.post("/api/login", (req, res) => {
    const { password } = req.body || {};
    if (password === DASHBOARD_PASSWORD) {
      const token = crypto.randomBytes(24).toString("hex");
      sessions.add(token);
      return res.json({ token });
    }
    return res.status(401).json({ error: "Incorrect password" });
  });

  // Full dashboard (HubSpot)
  app.get("/api/dashboard", requireAuth, async (req, res) => {
    try {
      const force = req.query.refresh === "1";
      // Custom calendar range (start/end = YYYY-MM-DD) takes priority over the
      // preset `period` param. Custom ranges cache on their exact bounds so a
      // repeat view of the same range is instant, but they are never pre-warmed.
      const custom = parseCustomRange(
        req.query.start as string | undefined,
        req.query.end as string | undefined,
      );
      if (custom) {
        const data = await cached(
          `dashboard:custom:${custom.start}:${custom.end}`,
          () => buildDashboard(custom),
          force,
        );
        res.json(data);
        return;
      }
      // Normalise the requested period so the cache key matches a known window.
      const periodKey = parsePeriod(req.query.period as string | undefined).key;
      const data = await cached(
        `dashboard:${periodKey}`,
        () => buildDashboard(periodKey),
        force,
      );
      res.json(data);
    } catch (e: any) {
      res.status(400).json({ error: e?.message || "Failed to build dashboard" });
    }
  });

  // Business performance trend (week/month over the last 12 units)
  app.get("/api/business-performance", requireAuth, async (req, res) => {
    try {
      const force = req.query.refresh === "1";
      const granularity = req.query.granularity === "month" ? "month" : "week";
      const data = await cached(
        `bizperf:${granularity}`,
        () => businessPerformance(granularity),
        force,
      );
      res.json(data);
    } catch (e: any) {
      res.status(400).json({ error: e?.message || "Failed to build business performance" });
    }
  });

  // Meta ads (separate so an expired token doesn't break the rest)
  app.get("/api/meta", requireAuth, async (req, res) => {
    try {
      const force = req.query.refresh === "1";
      const custom = parseCustomRange(
        req.query.start as string | undefined,
        req.query.end as string | undefined,
      );
      const range = custom ?? parsePeriod(req.query.period as string | undefined);
      const cacheKey = custom
        ? `meta:custom:${range.start}:${range.end}`
        : `meta:${range.key}`;
      const data = await cached(cacheKey, () => metaAds(range), force);
      res.json(data);
    } catch (e: any) {
      res.status(400).json({ status: "error", message: e?.message || "Meta failed" });
    }
  });

  // Health
  app.get("/api/health", (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

  // Warehouse / cache status (auth-gated) — useful for verifying the local
  // HubSpot response cache is populated and fresh.
  app.get("/api/warehouse", requireAuth, (_req, res) => {
    res.json({
      snapshot: snapshotStoreInfo(),
      hsCache: hsCacheInfo(),
      sync: { ...lastSync(), running: isSyncing() },
    });
  });

  // Manually trigger a sync (auth-gated). ?mode=full|incremental
  app.post("/api/warehouse/sync", requireAuth, (req, res) => {
    const mode = (req.query.mode === "incremental" ? "incremental" : "full") as
      | "full"
      | "incremental";
    // Fire-and-forget; returns immediately.
    runSync(mode).catch((e) => console.error("[sync] manual failed:", e?.message));
    res.json({ started: true, mode });
  });

  // Begin keeping the common periods warm in the background.
  startWarmer();
  // Begin the HubSpot response-cache sync schedule.
  startSync();

  return httpServer;
}
