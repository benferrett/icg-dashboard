// HubSpot live data service for the ICG dashboard.
// Requests go through apiFetch (see proxy.ts): direct Bearer auth with HUBSPOT_TOKEN
// in production, or the Perplexity credential proxy when running in-preview.

import { apiFetch } from "./proxy";

type DealProps = Record<string, string | undefined>;
interface Deal {
  id: string;
  properties: DealProps;
}

// --- Throttled request queue ----------------------------------------------
// HubSpot enforces a per-second cap on /search (≈4/sec) alongside a small burst
// allowance. The dashboard fires many searches at once. Previously every search
// ran through a SINGLE serialized lane spaced 280ms apart (~3.5 req/sec), which
// meant 40+ cold-load searches executed strictly one-at-a-time → ~15s of queue
// wait even though the sections themselves run in parallel.
//
// We now allow up to LANES searches IN FLIGHT concurrently while still capping
// the START rate at ~1 every MIN_GAP_MS (≈3.5 starts/sec). This keeps us under
// HubSpot's secondly cap but overlaps network round-trips (each search's
// latency is mostly waiting on HubSpot, not local CPU), cutting cold time
// roughly LANES-fold. 429s are still caught and retried in searchPost.
const MIN_GAP_MS = 280; // ~3.5 request STARTS/sec, safely under the search cap
const LANES = 3; // max concurrent in-flight searches
let lastStart = 0;
let active = 0;
const waiters: Array<() => void> = [];

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// Acquire a concurrency slot (≤ LANES in flight), then honour the minimum gap
// between request STARTS so we never exceed the secondly cap. Returns a release
// fn the caller must invoke once the request settles.
async function acquire(): Promise<() => void> {
  if (active >= LANES) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  active++;
  // Reserve this start slot ATOMICALLY: compute the next allowed start time and
  // advance `lastStart` BEFORE awaiting, so concurrent acquirers each reserve a
  // distinct, properly-spaced slot instead of all reading the same timestamp.
  const now = Date.now();
  const startAt = Math.max(now, lastStart + MIN_GAP_MS);
  lastStart = startAt;
  const wait = startAt - now;
  if (wait > 0) await sleep(wait);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    active--;
    const next = waiters.shift();
    if (next) next();
  };
}

// Run `fn` inside a rate-limited concurrency slot.
async function schedule<T>(fn: () => Promise<T>): Promise<T> {
  const release = await acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}

async function searchPost(payload: any, objectType = "deals"): Promise<any> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await schedule(() =>
      apiFetch("hubspot", `/crm/v3/objects/${objectType}/search`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    );
    if (res.status === 429) {
      await sleep(1100 * (attempt + 1)); // back off and retry
      continue;
    }
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`HubSpot search ${res.status}: ${txt.slice(0, 300)}`);
    }
    return res.json();
  }
  throw new Error("HubSpot search failed after retries (rate limited)");
}

// Search deals with paging. Returns up to `cap` records.
async function searchDeals(body: any, cap = 1000): Promise<Deal[]> {
  return searchObjects("deals", body, cap);
}

// Generic paged search for any CRM object (deals, contacts, meetings, calls).
async function searchObjects(
  objectType: string,
  body: any,
  cap = 1000,
): Promise<Deal[]> {
  const out: Deal[] = [];
  let after: string | undefined = undefined;
  while (out.length < cap) {
    const json: any = await searchPost({ ...body, limit: 100, after }, objectType);
    for (const r of json.results || []) out.push(r);
    after = json.paging?.next?.after;
    if (!after) break;
  }
  return out;
}

// --- Batch helpers (associations v4 + object batch read) ------------------
// Plain (non-search) endpoints are not rate-limited like /search, but we still
// route through the proxy via apiFetch.
// Batch reads against large windows occasionally hit a transient HubSpot 500
// (INTERNAL_ERROR) or 429 on a single chunk. Retry with backoff; if the chunk
// still fails, return null so the caller can skip it rather than aborting the
// whole dashboard section. A dropped chunk slightly understates contacted/
// connected counts on big windows — acceptable vs. the section erroring out.
async function apiPostResilient(path: string, payload: any): Promise<any | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await apiFetch("hubspot", path, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (res.ok) return res.json();
      if (res.status === 429 || res.status >= 500) {
        await sleep(600 * (attempt + 1));
        continue;
      }
      // 4xx (other than 429) won't fix on retry.
      const txt = await res.text();
      throw new Error(`HubSpot ${path} ${res.status}: ${txt.slice(0, 200)}`);
    } catch (err) {
      if (attempt === 3) return null;
      await sleep(600 * (attempt + 1));
    }
  }
  return null;
}

// Run an array of async tasks with bounded concurrency. Batch (non-search)
// endpoints aren't subject to the per-second search cap, so we can fan out.
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return out;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Map each fromId -> array of associated toObjectIds (e.g. contacts -> calls).
async function batchAssociations(
  fromType: string,
  toType: string,
  ids: string[],
): Promise<Record<string, string[]>> {
  const result: Record<string, string[]> = {};
  const chunks = chunk(ids, 100);
  const jsons = await mapLimit(chunks, 8, (c) =>
    apiPostResilient(`/crm/v4/associations/${fromType}/${toType}/batch/read`, {
      inputs: c.map((id) => ({ id })),
    }),
  );
  for (const json of jsons) {
    if (!json) continue;
    for (const res of json.results || []) {
      const from = res.from?.id;
      if (!from) continue;
      result[from] = (res.to || []).map((t: any) => String(t.toObjectId));
    }
  }
  return result;
}

// Batch-read properties for a set of object IDs.
async function batchRead(
  objectType: string,
  ids: string[],
  properties: string[],
): Promise<Record<string, Record<string, string | undefined>>> {
  const out: Record<string, Record<string, string | undefined>> = {};
  const chunks = chunk(ids, 100);
  const jsons = await mapLimit(chunks, 8, (c) =>
    apiPostResilient(`/crm/v3/objects/${objectType}/batch/read`, {
      properties,
      inputs: c.map((id) => ({ id })),
    }),
  );
  for (const json of jsons) {
    if (!json) continue;
    for (const r of json.results || []) out[r.id] = r.properties;
  }
  return out;
}

// Batch-read property HISTORY for a set of object IDs. Returns, per object,
// each requested property's full version history (newest first), as HubSpot
// returns it: [{ value, timestamp, sourceType, sourceId }, ...]. Used to find
// the ORIGINAL owner of a contact before later reassignment (e.g. a DS contact
// that was booked by a consultant but later handed to the strategist).
async function batchReadWithHistory(
  objectType: string,
  ids: string[],
  properties: string[],
): Promise<Record<string, Record<string, Array<{ value?: string; timestamp?: string }>>>> {
  const out: Record<string, Record<string, Array<{ value?: string; timestamp?: string }>>> = {};
  const chunks = chunk(ids, 100);
  const jsons = await mapLimit(chunks, 8, (c) =>
    apiPostResilient(`/crm/v3/objects/${objectType}/batch/read`, {
      propertiesWithHistory: properties,
      inputs: c.map((id) => ({ id })),
    }),
  );
  for (const json of jsons) {
    if (!json) continue;
    for (const r of json.results || []) out[r.id] = r.propertiesWithHistory || {};
  }
  return out;
}

// Count only (fast) — uses total from a 1-row search.
async function countDeals(filterGroups: any[]): Promise<number> {
  const json: any = await searchPost({ filterGroups, limit: 1, properties: ["dealname"] });
  return json.total || 0;
}

// Count contacts (e.g. EMBR leads) — total from a 1-row contact search.
async function countContacts(filterGroups: any[]): Promise<number> {
  const json: any = await searchPost(
    { filterGroups, limit: 1, properties: ["email"] },
    "contacts",
  );
  return json.total || 0;
}

export const hubspot = {
  searchDeals,
  searchObjects,
  countDeals,
  countContacts,
  batchAssociations,
  batchRead,
  batchReadWithHistory,
};
