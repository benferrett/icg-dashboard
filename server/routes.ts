import type { Express, Request, Response, NextFunction } from "express";
import { createServer } from "node:http";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { buildDashboard } from "./icg/metrics";
import { parsePeriod } from "./icg/period";
import { metaAds } from "./icg/meta";

// --- Simple session-token auth (no cookies/localStorage; token returned to client) ---
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || "InnerCircle2026$$";
const sessions = new Set<string>();

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers["x-icg-token"] as string | undefined;
  if (token && sessions.has(token)) return next();
  return res.status(401).json({ error: "Unauthorized" });
}

// --- Lightweight in-memory cache so the dashboard feels instant + limits API load ---
// Each entry also remembers HOW to rebuild itself (`fn`), so a background warmer
// can proactively refresh it just before expiry. That way real visitors almost
// always hit the warm (~0.1s) path and rarely eat the ~6-15s cold HubSpot fetch.
interface CacheEntry {
  data: any;
  expires: number;
  fn: () => Promise<any>;
}
const cache = new Map<string, CacheEntry>();
const TTL_MS = 5 * 60 * 1000; // 5 minutes

async function cached(key: string, fn: () => Promise<any>, force = false) {
  const hit = cache.get(key);
  if (!force && hit && hit.expires > Date.now()) {
    return { ...hit.data, cached: true, cacheAgeSec: Math.round((Date.now() - (hit.expires - TTL_MS)) / 1000) };
  }
  const data = await fn();
  cache.set(key, { data, expires: Date.now() + TTL_MS, fn });
  return { ...data, cached: false, cacheAgeSec: 0 };
}

// --- Background cache warmer ----------------------------------------------
// Periods most people look at. We keep these warm at all times so the common
// case is instant. Other periods (e.g. this_year) still cache on first request.
const WARM_PERIODS = ["this_week", "last_week", "this_month", "last_month"];
const WARM_INTERVAL_MS = 4 * 60 * 1000; // refresh a bit before the 5-min TTL
let warming = false;

// Rebuild one cache entry in place (used by both seeding and periodic refresh).
async function warmKey(key: string, fn: () => Promise<any>) {
  const data = await fn();
  cache.set(key, { data, expires: Date.now() + TTL_MS, fn });
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
  } finally {
    warming = false;
  }
}

// Kick off warming on boot (slightly delayed so the server finishes starting),
// then on a repeating interval. `unref()` keeps the timer from blocking exit.
function startWarmer() {
  setTimeout(() => {
    warmCache().catch(() => {});
  }, 3000).unref?.();
  setInterval(() => {
    warmCache().catch(() => {});
  }, WARM_INTERVAL_MS).unref?.();
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

  // Meta ads (separate so an expired token doesn't break the rest)
  app.get("/api/meta", requireAuth, async (req, res) => {
    try {
      const force = req.query.refresh === "1";
      const range = parsePeriod(req.query.period as string | undefined);
      const data = await cached(`meta:${range.key}`, () => metaAds(range), force);
      res.json(data);
    } catch (e: any) {
      res.status(400).json({ status: "error", message: e?.message || "Meta failed" });
    }
  });

  // Health
  app.get("/api/health", (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

  // Begin keeping the common periods warm in the background.
  startWarmer();

  return httpServer;
}
