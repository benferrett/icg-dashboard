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
// HubSpot enforces a per-second cap on /search (≈4/sec). The dashboard fires
// many searches at once, so we funnel every search POST through a single queue
// that spaces calls out and retries automatically on 429.
const MIN_GAP_MS = 280; // ~3.5 req/sec, safely under the secondly search cap
let lastCall = 0;
let chain: Promise<void> = Promise.resolve();

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// Run `fn` after acquiring the throttle slot. Calls are serialized + spaced.
function schedule<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = MIN_GAP_MS - (Date.now() - lastCall);
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
  });
  chain = run.catch(() => {});
  return run.then(fn);
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
async function apiPost(path: string, payload: any): Promise<any> {
  const res = await apiFetch("hubspot", path, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HubSpot ${path} ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json();
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
    apiPost(`/crm/v4/associations/${fromType}/${toType}/batch/read`, {
      inputs: c.map((id) => ({ id })),
    }),
  );
  for (const json of jsons) {
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
    apiPost(`/crm/v3/objects/${objectType}/batch/read`, {
      properties,
      inputs: c.map((id) => ({ id })),
    }),
  );
  for (const json of jsons) {
    for (const r of json.results || []) out[r.id] = r.properties;
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
};
