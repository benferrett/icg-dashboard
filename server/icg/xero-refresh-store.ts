// Persistent store for Xero's rotating refresh token.
//
// Xero rotates the refresh_token on EVERY /connect/token exchange — the old
// one is single-use. If we only ever read from XERO_REFRESH_TOKEN env, the
// second token refresh (about 30 min after first use) will fail with
// "invalid_grant / Refresh token has been consumed".
//
// This module persists the newest refresh_token to a small JSON file on disk
// so a Node process restart doesn't lose it. On Railway the filesystem is
// ephemeral, so a redeploy still requires re-running /xero/auth — but at
// least mid-process refreshes work reliably.
//
// If /app/data (or wherever DATA_DIR points) is on a mounted Railway volume,
// this becomes fully persistent through redeploys too.

import fs from "fs";
import path from "path";

const DATA_DIR = process.env.DATA_DIR || "/app";
const STORE_PATH = path.join(DATA_DIR, "xero-refresh.json");

interface Store {
  refresh_token: string;
  updated_at: string;
}

function readStore(): Store | null {
  try {
    if (!fs.existsSync(STORE_PATH)) return null;
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<Store>;
    if (parsed && typeof parsed.refresh_token === "string" && parsed.refresh_token.length > 10) {
      return { refresh_token: parsed.refresh_token, updated_at: parsed.updated_at || "" };
    }
    return null;
  } catch (e) {
    console.error(`[xero-refresh-store] read failed:`, (e as any)?.message);
    return null;
  }
}

function writeStore(refresh_token: string): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = STORE_PATH + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify({ refresh_token, updated_at: new Date().toISOString() }));
    fs.renameSync(tmp, STORE_PATH);
  } catch (e) {
    console.error(`[xero-refresh-store] write failed:`, (e as any)?.message);
  }
}

// The current best refresh_token: prefer the persisted one (it's newer than
// the env var after any successful refresh); fall back to the env var on
// cold start with an empty store.
export function currentRefreshToken(): string | null {
  const s = readStore();
  if (s) return s.refresh_token;
  const env = process.env.XERO_REFRESH_TOKEN;
  return env && env.length > 10 ? env : null;
}

// Persist a rotated refresh_token returned by Xero after a token refresh.
export function persistRefreshToken(rt: string): void {
  if (!rt || rt.length < 10) return;
  writeStore(rt);
}

// Introspection endpoint for debugging.
export function refreshStoreInfo(): { path: string; hasStored: boolean; updated_at: string | null } {
  const s = readStore();
  return {
    path: STORE_PATH,
    hasStored: !!s,
    updated_at: s?.updated_at || null,
  };
}
