// Persistent dashboard-session store.
//
// The dashboard's session tokens used to live in an in-memory Set on the Node
// process. Every Railway redeploy restarted the process, wiped the Set, and
// silently invalidated every logged-in browser tab. The operator had to
// re-enter the password after every deploy \u2014 and, worse, mid-workflow API
// calls would fail with a scary 'Unauthorized' the moment we shipped a hotfix.
//
// This store persists issued tokens to a tiny JSON file so tokens survive a
// process restart. If a Railway volume is mounted (DATA_DIR or
// RAILWAY_VOLUME_MOUNT_PATH), tokens survive redeploys too.
//
// Tokens have a 30-day TTL. On load we drop anything past its expiry so an
// abandoned deploy from a year ago can't leave a valid session sitting around.
//
// This module intentionally avoids SQLite \u2014 the shape is trivially small and
// we don't want another dependency to fail-open. Best-effort disk writes; if
// the disk is read-only we still work in-memory (matching the old behaviour).

import fs from "fs";
import path from "path";

const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface StoredSession {
  token: string;
  issued_at: number; // epoch ms
}

interface StoreFile {
  sessions: StoredSession[];
}

function resolveDataDir(): string {
  const candidates: string[] = [];
  if (process.env.DATA_DIR) candidates.push(process.env.DATA_DIR);
  if (process.env.RAILWAY_VOLUME_MOUNT_PATH) candidates.push(process.env.RAILWAY_VOLUME_MOUNT_PATH);
  candidates.push(process.cwd());
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const probe = path.join(dir, ".session-write-probe");
      fs.writeFileSync(probe, "ok");
      fs.unlinkSync(probe);
      return dir;
    } catch {
      /* try next */
    }
  }
  return process.cwd();
}

const DATA_DIR = resolveDataDir();
const STORE_PATH = path.join(DATA_DIR, "sessions.json");

// In-memory mirror of the on-disk store. Keeps auth checks O(1) without a
// disk read on every request.
const mem = new Map<string, number>();

function loadFromDisk(): void {
  try {
    if (!fs.existsSync(STORE_PATH)) return;
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<StoreFile>;
    if (!parsed || !Array.isArray(parsed.sessions)) return;
    const now = Date.now();
    for (const s of parsed.sessions) {
      if (
        s &&
        typeof s.token === "string" &&
        s.token.length >= 16 &&
        typeof s.issued_at === "number" &&
        now - s.issued_at < TTL_MS
      ) {
        mem.set(s.token, s.issued_at);
      }
    }
    console.log(`[session-store] loaded ${mem.size} session(s) from ${STORE_PATH}`);
  } catch (e) {
    console.error(`[session-store] load failed:`, (e as any)?.message);
  }
}

function writeToDisk(): void {
  try {
    const payload: StoreFile = {
      sessions: Array.from(mem.entries()).map(([token, issued_at]) => ({ token, issued_at })),
    };
    const tmp = STORE_PATH + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(payload));
    fs.renameSync(tmp, STORE_PATH);
  } catch (e) {
    console.error(`[session-store] write failed:`, (e as any)?.message);
  }
}

// Hydrate memory from disk once at module init.
loadFromDisk();

export function addSession(token: string): void {
  mem.set(token, Date.now());
  writeToDisk();
}

export function hasSession(token: string): boolean {
  const issuedAt = mem.get(token);
  if (issuedAt === undefined) return false;
  if (Date.now() - issuedAt > TTL_MS) {
    mem.delete(token);
    writeToDisk();
    return false;
  }
  return true;
}

export function deleteSession(token: string): void {
  if (mem.delete(token)) writeToDisk();
}

export function sessionStoreInfo(): {
  path: string;
  count: number;
} {
  return { path: STORE_PATH, count: mem.size };
}
