// Persistent snapshot cache for computed dashboard payloads.
//
// WHY: the previous cache lived only in process memory, so every Railway
// redeploy or container sleep wiped it — forcing the next visitor to eat a full
// cold HubSpot rebuild (6-15s), even for the common preset windows. This store
// writes each computed payload to SQLite on disk so that after a restart the
// dashboard can serve the last-known-good snapshot INSTANTLY, then refresh in
// the background (stale-while-revalidate, handled in routes.ts).
//
// PERSISTENCE: the DB path resolves to the first writable location of
//   1. DATA_DIR env var (explicit override)
//   2. RAILWAY_VOLUME_MOUNT_PATH (auto-set by Railway when a volume is attached)
//   3. ./ (app dir — EPHEMERAL on Railway; survives in-process but not redeploys)
// So it works everywhere, and "just works better" once a Railway volume exists.
//
// SAFETY: every operation is wrapped so a disk/permission problem degrades to a
// no-op (memory cache in routes.ts still functions) rather than crashing boot.

import Database from "better-sqlite3";
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
      // Probe writability.
      const probe = path.join(c.dir, ".write-probe");
      fs.writeFileSync(probe, "ok");
      fs.unlinkSync(probe);
      return c;
    } catch {
      // try next candidate
    }
  }
  return { dir: process.cwd(), persistent: false };
}

let db: Database.Database | null = null;
let persistent = false;
let dbPath = "";

function init() {
  if (db) return;
  try {
    const { dir, persistent: p } = resolveDataDir();
    persistent = p;
    dbPath = path.join(dir, "dashboard-cache.db");
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS snapshots (
        key        TEXT PRIMARY KEY,
        payload    TEXT NOT NULL,
        computed_at INTEGER NOT NULL
      );
    `);
    console.log(
      `[snapshot-store] ready at ${dbPath} (persistent=${persistent})`,
    );
  } catch (e) {
    console.error("[snapshot-store] init failed, disk cache disabled:", (e as any)?.message);
    db = null;
  }
}

export interface StoredSnapshot {
  payload: any;
  computedAt: number; // epoch ms
}

// Read a snapshot from disk. Returns null on miss or any error.
export function readSnapshot(key: string): StoredSnapshot | null {
  init();
  if (!db) return null;
  try {
    const row = db
      .prepare("SELECT payload, computed_at FROM snapshots WHERE key = ?")
      .get(key) as { payload: string; computed_at: number } | undefined;
    if (!row) return null;
    return { payload: JSON.parse(row.payload), computedAt: row.computed_at };
  } catch (e) {
    console.error("[snapshot-store] read failed:", (e as any)?.message);
    return null;
  }
}

// Persist a snapshot. Best-effort — failures are logged and swallowed.
export function writeSnapshot(key: string, payload: any, computedAt: number): void {
  init();
  if (!db) return;
  try {
    db.prepare(
      `INSERT INTO snapshots (key, payload, computed_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, computed_at = excluded.computed_at`,
    ).run(key, JSON.stringify(payload), computedAt);
  } catch (e) {
    console.error("[snapshot-store] write failed:", (e as any)?.message);
  }
}

// Load every stored snapshot (used to seed the in-memory cache on boot).
export function readAllSnapshots(): Array<{ key: string } & StoredSnapshot> {
  init();
  if (!db) return [];
  try {
    const rows = db
      .prepare("SELECT key, payload, computed_at FROM snapshots")
      .all() as Array<{ key: string; payload: string; computed_at: number }>;
    return rows.map((r) => ({
      key: r.key,
      payload: JSON.parse(r.payload),
      computedAt: r.computed_at,
    }));
  } catch (e) {
    console.error("[snapshot-store] readAll failed:", (e as any)?.message);
    return [];
  }
}

export function snapshotStoreInfo() {
  init();
  return { dbPath, persistent, enabled: !!db };
}
