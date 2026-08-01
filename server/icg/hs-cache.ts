// Read-through HubSpot response cache ("warehouse").
//
// GOAL (Phase 2): make ANY date range — including a never-seen custom range —
// fast by answering HubSpot reads from a local SQLite store of HubSpot's OWN
// JSON responses instead of hitting the rate-limited API on page load.
//
// WHY A RESPONSE CACHE (not a raw-object mirror): the dashboard reads a very
// broad surface — deals, contacts, meetings, calls, notes, tasks, dozens of
// properties, many association pairs and owner property-history. Caching
// HubSpot's verbatim responses keyed by the exact request guarantees metrics.ts
// sees byte-identical data (numbers cannot drift), and it covers the entire
// surface automatically with no hand-written filter engine to get wrong.
//
// HOW IT STAYS FAST FOR ARBITRARY RANGES: a background sync (sync.ts)
// pre-executes the dashboard build for the common presets AND a rolling set of
// month/quarter windows. Because searchAllByTime day-slices its queries and
// batch reads are keyed by object-id, most custom ranges reuse already-cached
// request slices, so their cold build resolves from disk instead of network.
//
// SAFETY: every op is wrapped; a disk problem degrades to a pure network path
// (behaviour identical to before Phase 2). A per-entry TTL + a global freshness
// guard (mirrorReady) prevent serving stale data beyond an acceptable age.

import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function resolveDataDir(): { dir: string; persistent: boolean } {
  const candidates: Array<{ dir: string; persistent: boolean }> = [];
  if (process.env.DATA_DIR) candidates.push({ dir: process.env.DATA_DIR, persistent: true });
  if (process.env.RAILWAY_VOLUME_MOUNT_PATH)
    candidates.push({ dir: process.env.RAILWAY_VOLUME_MOUNT_PATH, persistent: true });
  candidates.push({ dir: process.cwd(), persistent: false });
  for (const c of candidates) {
    try {
      fs.mkdirSync(c.dir, { recursive: true });
      const probe = path.join(c.dir, ".hs-write-probe");
      fs.writeFileSync(probe, "ok");
      fs.unlinkSync(probe);
      return c;
    } catch {
      /* next */
    }
  }
  return { dir: process.cwd(), persistent: false };
}

let db: Database.Database | null = null;
let dbPath = "";
let persistent = false;

export function initHsCache(): Database.Database | null {
  if (db) return db;
  try {
    const r = resolveDataDir();
    dbPath = path.join(r.dir, "hs-cache.db");
    persistent = r.persistent;
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS hs_responses (
        key        TEXT PRIMARY KEY,
        body       TEXT NOT NULL,
        fetched_at INTEGER NOT NULL
      );
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_hs_fetched ON hs_responses(fetched_at);`);
    db.exec(`
      CREATE TABLE IF NOT EXISTS hs_sync_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    console.log(`[hs-cache] ready at ${dbPath} (persistent=${persistent})`);
    return db;
  } catch (e) {
    console.error("[hs-cache] init failed, response cache disabled:", (e as any)?.message);
    db = null;
    return null;
  }
}

// Stable key for a HubSpot request. Path + method + canonicalised body.
export function hsKey(method: string, path: string, body?: any): string {
  const canon = body ? stableStringify(body) : "";
  return crypto
    .createHash("sha1")
    .update(`${method.toUpperCase()} ${path}\n${canon}`)
    .digest("hex");
}

// Deterministic JSON so equivalent payloads hash equally regardless of key
// order. Note: for search payloads we intentionally EXCLUDE volatile paging
// fields (`after`) at the call site so a full paged sweep caches per-page.
function stableStringify(v: any): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const keys = Object.keys(v).sort();
  return `{${keys.map((k) => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",")}}`;
}

export interface CachedResponse {
  body: any;
  fetchedAt: number;
}

export function readResponse(key: string, maxAgeMs?: number): CachedResponse | null {
  initHsCache();
  if (!db) return null;
  try {
    const row = db
      .prepare("SELECT body, fetched_at FROM hs_responses WHERE key=?")
      .get(key) as { body: string; fetched_at: number } | undefined;
    if (!row) return null;
    if (maxAgeMs != null && Date.now() - row.fetched_at > maxAgeMs) return null;
    return { body: JSON.parse(row.body), fetchedAt: row.fetched_at };
  } catch (e) {
    console.error("[hs-cache] read failed:", (e as any)?.message);
    return null;
  }
}

export function writeResponse(key: string, body: any): void {
  initHsCache();
  if (!db) return;
  try {
    db.prepare(
      `INSERT INTO hs_responses (key, body, fetched_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET body=excluded.body, fetched_at=excluded.fetched_at`,
    ).run(key, JSON.stringify(body), Date.now());
  } catch (e) {
    console.error("[hs-cache] write failed:", (e as any)?.message);
  }
}

export function setHsSyncState(key: string, value: string) {
  initHsCache();
  if (!db) return;
  try {
    db.prepare(
      `INSERT INTO hs_sync_state (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    ).run(key, value);
  } catch {
    /* ignore */
  }
}
export function getHsSyncState(key: string): string | null {
  initHsCache();
  if (!db) return null;
  try {
    const row = db.prepare("SELECT value FROM hs_sync_state WHERE key=?").get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  } catch {
    return null;
  }
}

// Should the read-through cache be consulted at all? Controlled by env flag and
// by whether at least one sync has populated it. Reads still fall back to live
// on a per-key miss regardless.
export function cacheEnabled(): boolean {
  if (process.env.USE_HS_CACHE === "0") return false;
  initHsCache();
  return !!db;
}

// Max acceptable age for a served cache entry. During a live user request we
// accept fairly old entries (the outer snapshot cache + background sync keep
// things fresh); a value of 0/undefined means "any age".
export function defaultMaxAgeMs(): number | undefined {
  const v = process.env.HS_CACHE_MAX_AGE_MS;
  if (v) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
    if (n === 0) return undefined; // explicit 0 = any age
  }
  // Default: 26h. Nightly full sync refreshes everything, so historical slices
  // are at most ~1 day stale (they barely change); today's in-progress numbers
  // are kept fresh by the 30-min incremental sync. A live request that finds
  // only an older entry will refetch it from HubSpot (correctness over speed).
  return 26 * 60 * 60 * 1000;
}

export function hsCacheInfo() {
  initHsCache();
  let entries = -1;
  let oldest: number | null = null;
  let newest: number | null = null;
  if (db) {
    try {
      const row = db
        .prepare("SELECT COUNT(*) n, MIN(fetched_at) mn, MAX(fetched_at) mx FROM hs_responses")
        .get() as any;
      entries = row.n;
      oldest = row.mn;
      newest = row.mx;
    } catch {
      /* ignore */
    }
  }
  return {
    dbPath,
    persistent,
    enabled: !!db,
    entries,
    oldest: oldest ? new Date(oldest).toISOString() : null,
    newest: newest ? new Date(newest).toISOString() : null,
    lastFull: getHsSyncState("last_full"),
    lastIncremental: getHsSyncState("last_incremental"),
  };
}

// Purge entries older than maxAgeMs (called by sync to bound DB growth).
export function purgeOlderThan(maxAgeMs: number): number {
  initHsCache();
  if (!db) return 0;
  try {
    const cutoff = Date.now() - maxAgeMs;
    const info = db.prepare("DELETE FROM hs_responses WHERE fetched_at < ?").run(cutoff);
    return info.changes as number;
  } catch {
    return 0;
  }
}
