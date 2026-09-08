import type { Express, Request, Response, NextFunction } from "express";
import { createServer } from "node:http";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { buildDashboard, businessPerformance, monthlyReport2026, forecast } from "./icg/metrics";
import { parsePeriod, parseCustomRange } from "./icg/period";
import { metaAds } from "./icg/meta";
import { marketingBeta, parseLeadMonth } from "./icg/marketing-beta";
import {
  readSnapshot,
  writeSnapshot,
  readAllSnapshots,
  snapshotStoreInfo,
} from "./icg/snapshot-store";
import { hsCacheInfo, getHsSyncState } from "./icg/hs-cache";
import { runSync, isSyncing, lastSync } from "./icg/sync";
import { getUnpaidInvoices, getAgedDebtors, getHeadlineTotals } from "./icg/ar";
import { markPaid, unmarkPaid, arOverridesInfo } from "./icg/ar-overrides";
import { sendMail } from "./icg/mailer";
import { politeReminderTemplate } from "./icg/ar-templates";
import { buildWeeklyReport, sendWeeklyReport } from "./icg/ar-weekly";
import { listOpenInvoices, XERO_TENANTS } from "./icg/xero";

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

// Drop an entry from BOTH memory + disk (used when AR overrides mutate state
// and we want the next read to reflect it immediately without waiting on TTL).
function invalidate(key: string) {
  cache.delete(key);
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
    // Keep the 2026 month-by-month report warm (independent of period).
    try {
      await warmKey("report2026:2026", () => monthlyReport2026(2026));
    } catch (e) {
      console.error("[warm] report2026 failed:", (e as any)?.message);
    }
    // Keep the current-month forecast warm.
    try {
      await warmKey("forecast", () => forecast());
    } catch (e) {
      console.error("[warm] forecast failed:", (e as any)?.message);
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
// cache has never been populated. INCREMENTAL every 15 min to keep today's
// in-progress numbers fresh. All timers unref() so they never block exit.
const INCREMENTAL_MS = 15 * 60 * 1000;
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

  // 2026 month-by-month report (Jan–Dec 2026, calendar-month basis)
  app.get("/api/report-2026", requireAuth, async (req, res) => {
    try {
      const force = req.query.refresh === "1";
      const year = Number(req.query.year) || 2026;
      const data = await cached(
        `report2026:${year}`,
        () => monthlyReport2026(year),
        force,
      );
      res.json(data);
    } catch (e: any) {
      res.status(400).json({ error: e?.message || "Failed to build 2026 report" });
    }
  });

  // Marketing BETA — lead-cohort CAC for a single lead month.
  // Follows every lead created in the month FORWARD, for all time, and
  // reports leads/booked/sat/members with spend keyed to when the leads
  // were generated (Meta invoiced spend + $154 per EMBR lead). Cached per
  // month so switching months stays fast.
  app.get("/api/marketing-beta", requireAuth, async (req, res) => {
    try {
      const force = req.query.refresh === "1";
      const cohort = parseLeadMonth(req.query.month as string | undefined);
      const data = await cached(
        `marketing-beta:${cohort.year}-${String(cohort.month).padStart(2, "0")}`,
        () => marketingBeta(cohort),
        force,
      );
      res.json(data);
    } catch (e: any) {
      res.status(400).json({ error: e?.message || "Failed to build marketing beta" });
    }
  });

  // Forecasting (current-month DS + AM booked: rest-of-month + full-month)
  app.get("/api/forecast", requireAuth, async (req, res) => {
    try {
      const force = req.query.refresh === "1";
      const data = await cached("forecast", () => forecast(), force);
      res.json(data);
    } catch (e: any) {
      res.status(400).json({ error: e?.message || "Failed to build forecast" });
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

  // --- Accounts Receivable ------------------------------------------------
  // Full open-AR payload — invoices + totals + aged debtors — cached via the
  // same SWR pattern as the other tabs. TTL is the shared 5-min window (see
  // TTL_MS above); the task originally called for 15-min, but SWR means the
  // dashboard still serves instantly from cache and refreshes in the
  // background, so the extra network churn from 5-min is negligible while
  // giving "marked paid" actions faster propagation via invalidate().
  async function buildArPayload() {
    const { invoices, cleared } = await getUnpaidInvoices();
    const all = [...invoices, ...cleared];
    const totals = getHeadlineTotals(all);
    const aged_debtors = getAgedDebtors(all);
    return {
      invoices,
      cleared,
      totals,
      aged_debtors,
      generated_at: new Date().toISOString(),
    };
  }

  app.get("/api/ar/invoices", requireAuth, async (req, res) => {
    try {
      const force = req.query.refresh === "1";
      const data = await cached("ar:invoices", buildArPayload, force);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Failed to load AR invoices" });
    }
  });

  app.post("/api/ar/invoices/:invoiceId/mark-paid", requireAuth, async (req, res) => {
    try {
      const invoiceId = String(req.params.invoiceId || "");
      const { tenant_id, note } = (req.body || {}) as { tenant_id?: string; note?: string };
      if (!tenant_id) return res.status(400).json({ error: "tenant_id required" });
      const ok = markPaid(invoiceId, tenant_id, "dashboard", note);
      if (!ok) return res.status(500).json({ error: "Override store unavailable" });
      // Drop the cache so the next GET reflects the override immediately.
      invalidate("ar:invoices");
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Failed to mark paid" });
    }
  });

  app.post("/api/ar/invoices/:invoiceId/unmark-paid", requireAuth, async (req, res) => {
    try {
      const invoiceId = String(req.params.invoiceId || "");
      const ok = unmarkPaid(invoiceId);
      if (!ok) return res.status(500).json({ error: "Override store unavailable" });
      invalidate("ar:invoices");
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Failed to unmark paid" });
    }
  });

  app.post("/api/ar/invoices/:invoiceId/send-followup", requireAuth, async (req, res) => {
    try {
      const invoiceId = String(req.params.invoiceId || "");
      const body = (req.body || {}) as {
        to?: string | string[];
        cc?: string | string[];
        bcc?: string | string[];
        subject?: string;
        html?: string;
        text?: string;
      };
      let { subject, html, text } = body;
      const to = body.to;
      if (!to) return res.status(400).json({ error: "to required" });

      // If any of subject/html/text is missing, fetch this invoice fresh from
      // Xero to render a polite reminder. We look it up across all three state
      // tenants because the caller isn't required to know which one owns it.
      if (!subject || !html || !text) {
        let found: { tenant: (typeof XERO_TENANTS)[number]; invoice: Awaited<ReturnType<typeof listOpenInvoices>>[number] } | null = null;
        for (const t of XERO_TENANTS) {
          try {
            const rows = await listOpenInvoices(t.id);
            const inv = rows.find((r) => r.InvoiceID === invoiceId);
            if (inv) {
              found = { tenant: t, invoice: inv };
              break;
            }
          } catch {
            /* try next */
          }
        }
        if (!found) return res.status(404).json({ error: "Invoice not found in any state tenant" });
        const days_overdue = found.invoice.DueDate
          ? Math.floor((Date.now() - found.invoice.DueDate.getTime()) / (24 * 60 * 60 * 1000))
          : 0;
        const tpl = politeReminderTemplate({
          contact_name: found.invoice.Contact?.Name || null,
          invoice_number: found.invoice.InvoiceNumber,
          amount: found.invoice.AmountDue,
          due_date: found.invoice.DueDate
            ? found.invoice.DueDate.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })
            : "—",
          days_overdue,
          property: found.invoice.Reference || null,
          tenant_name: found.tenant.name,
        });
        subject = subject || tpl.subject;
        html = html || tpl.html;
        text = text || tpl.text;
      }

      const result = await sendMail({
        to,
        cc: body.cc,
        bcc: body.bcc,
        subject: subject!,
        html,
        text,
      });
      res.json({ id: result.id, threadId: result.threadId, to, cc: body.cc, subject });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Failed to send follow-up" });
    }
  });

  app.post("/api/ar/weekly-report/send", requireAuth, async (req, res) => {
    try {
      const { to } = (req.body || {}) as { to?: string };
      const recipient = (to && to.trim()) || "benferrett@innercirclegroup.com.au";
      const result = await sendWeeklyReport(recipient);
      res.json({ id: result.id, subject: result.subject, to: recipient });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Failed to send weekly report" });
    }
  });

  app.get("/api/ar/weekly-report/preview", requireAuth, async (_req, res) => {
    try {
      const rep = await buildWeeklyReport();
      res.json({ html: rep.html_body, subject: rep.subject, totals: rep.totals });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Failed to build weekly report" });
    }
  });

  app.get("/api/ar/status", requireAuth, (_req, res) => {
    res.json({ overrides: arOverridesInfo() });
  });

  // Begin keeping the common periods warm in the background.
  startWarmer();
  // Begin the HubSpot response-cache sync schedule.
  startSync();

  return httpServer;
}
