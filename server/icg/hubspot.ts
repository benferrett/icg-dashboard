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

async function searchPost(payload: any): Promise<any> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await schedule(() =>
      apiFetch("hubspot", "/crm/v3/objects/deals/search", {
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
  const out: Deal[] = [];
  let after: string | undefined = undefined;
  while (out.length < cap) {
    const json: any = await searchPost({ ...body, limit: 100, after });
    for (const r of json.results || []) out.push(r);
    after = json.paging?.next?.after;
    if (!after) break;
  }
  return out;
}

// Count only (fast) — uses total from a 1-row search.
async function countDeals(filterGroups: any[]): Promise<number> {
  const json: any = await searchPost({ filterGroups, limit: 1, properties: ["dealname"] });
  return json.total || 0;
}

export const hubspot = { searchDeals, countDeals };
