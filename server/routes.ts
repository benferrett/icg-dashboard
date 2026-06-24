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
interface CacheEntry {
  data: any;
  expires: number;
}
const cache = new Map<string, CacheEntry>();
const TTL_MS = 5 * 60 * 1000; // 5 minutes

async function cached(key: string, fn: () => Promise<any>, force = false) {
  const hit = cache.get(key);
  if (!force && hit && hit.expires > Date.now()) {
    return { ...hit.data, cached: true, cacheAgeSec: Math.round((Date.now() - (hit.expires - TTL_MS)) / 1000) };
  }
  const data = await fn();
  cache.set(key, { data, expires: Date.now() + TTL_MS });
  return { ...data, cached: false, cacheAgeSec: 0 };
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
      const data = await cached("meta", metaAds, force);
      res.json(data);
    } catch (e: any) {
      res.status(400).json({ status: "error", message: e?.message || "Meta failed" });
    }
  });

  // Health
  app.get("/api/health", (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

  return httpServer;
}
