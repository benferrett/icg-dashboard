// Meta (Facebook) Marketing API service. Uses saved credential custom-cred:graph.facebook.com.
// Returns ad spend / leads / CPL / ROAS, or a clear status object if the token is expired/missing.

import { apiFetch } from "./proxy";
import { PeriodRange } from "./period";

const GRAPH = "/v21.0";
const MEL_OFFSET_MS = 10 * 60 * 60 * 1000; // Australia/Melbourne (UTC+10)

// Convert a UTC ISO instant to the Melbourne calendar date (YYYY-MM-DD).
function melDate(iso: string): string {
  return new Date(new Date(iso).getTime() + MEL_OFFSET_MS).toISOString().slice(0, 10);
}

// Build Meta's inclusive {since, until} from our [start, end) range. `end` is
// exclusive, so the inclusive `until` day is the day before `end` (in MEL).
function metaTimeRange(range: PeriodRange): { since: string; until: string } {
  const since = melDate(range.start);
  const endMel = new Date(new Date(range.end).getTime() + MEL_OFFSET_MS);
  endMel.setUTCDate(endMel.getUTCDate() - 1); // step back to make `until` inclusive
  const until = endMel.toISOString().slice(0, 10);
  // Guard: a window shorter than a day (rare) should still cover at least `since`.
  return { since, until: until < since ? since : until };
}

export async function metaAds(range: PeriodRange) {
  const { since, until } = metaTimeRange(range);
  const timeRange = encodeURIComponent(JSON.stringify({ since, until }));
  try {
    // 1. Find ad accounts
    const accRes = await apiFetch(
      "meta",
      `${GRAPH}/me/adaccounts?fields=account_id,name,currency,amount_spent&limit=25`,
    );
    const accJson: any = await accRes.json();
    if (accJson.error) {
      return {
        status: "error",
        message: accJson.error.message || "Meta API error",
        code: accJson.error.code,
      };
    }
    const accounts = accJson.data || [];
    if (!accounts.length) {
      return { status: "no_accounts", message: "No ad accounts found for this token." };
    }

    // 2. Pull last-30-day insights for each account
    const results = await Promise.all(
      accounts.map(async (acc: any) => {
        const insRes = await apiFetch(
          "meta",
          `${GRAPH}/act_${acc.account_id}/insights?fields=spend,impressions,clicks,cpc,ctr,actions,cost_per_action_type&time_range=${timeRange}`,
        );
        const insJson: any = await insRes.json();
        const row = (insJson.data && insJson.data[0]) || {};
        const leadAction = (row.actions || []).find(
          (a: any) => a.action_type === "lead" || a.action_type === "onsite_conversion.lead_grouped",
        );
        const cplAction = (row.cost_per_action_type || []).find(
          (a: any) => a.action_type === "lead" || a.action_type === "onsite_conversion.lead_grouped",
        );
        const leads = leadAction ? parseFloat(leadAction.value) : 0;
        const spend = parseFloat(row.spend || "0");
        return {
          accountId: acc.account_id,
          name: acc.name,
          currency: acc.currency,
          spend,
          impressions: parseInt(row.impressions || "0", 10),
          clicks: parseInt(row.clicks || "0", 10),
          ctr: parseFloat(row.ctr || "0"),
          cpc: parseFloat(row.cpc || "0"),
          leads,
          cpl: cplAction ? parseFloat(cplAction.value) : leads ? spend / leads : 0,
        };
      }),
    );

    const totals = results.reduce(
      (acc, r) => {
        acc.spend += r.spend;
        acc.leads += r.leads;
        acc.clicks += r.clicks;
        acc.impressions += r.impressions;
        return acc;
      },
      { spend: 0, leads: 0, clicks: 0, impressions: 0 },
    );

    return {
      status: "ok",
      window: range.label,
      accounts: results,
      totals: {
        ...totals,
        cpl: totals.leads ? totals.spend / totals.leads : 0,
        currency: results[0]?.currency || "AUD",
      },
    };
  } catch (e: any) {
    return { status: "error", message: e?.message || "Meta request failed" };
  }
}

// ---------------------------------------------------------------------------
// AD-LEVEL insights — one row per ad, for the selected period. Used by the
// Marketing tab's per-ad breakdown (bookings/members per ad). Each row carries
// the campaign name (which encodes the funnel Layer, e.g. "Layer 2 Lead
// Generation") so ads can be grouped by layer, plus Meta-reported spend/leads.

export type MetaAdRow = {
  adId: string;
  adName: string;
  adsetName: string;
  campaignName: string;
  layer: number | null; // 1/2/3 parsed from the campaign name, else null
  spend: number;
  leads: number; // Meta-reported lead-form submissions
};

// Parse the funnel layer number out of a Meta campaign name. ICG campaigns are
// named "Layer 1", "Layer 2 Lead Generation", "Layer 3 Lead Generation
// Retargeting", etc. Returns 1/2/3 or null if no layer token is present.
export function layerFromCampaign(name?: string | null): number | null {
  if (!name) return null;
  const m = /layer\s*([0-9]+)/i.exec(name);
  return m ? parseInt(m[1], 10) : null;
}

export async function metaAdInsights(
  range: PeriodRange,
): Promise<{ ok: boolean; ads: MetaAdRow[]; currency: string; message?: string }> {
  const { since, until } = metaTimeRange(range);
  const timeRange = encodeURIComponent(JSON.stringify({ since, until }));
  try {
    const accRes = await apiFetch(
      "meta",
      `${GRAPH}/me/adaccounts?fields=account_id,name,currency&limit=25`,
    );
    const accJson: any = await accRes.json();
    if (accJson.error) return { ok: false, ads: [], currency: "AUD", message: accJson.error.message };
    const accounts = accJson.data || [];
    if (!accounts.length) return { ok: false, ads: [], currency: "AUD", message: "No ad accounts" };

    const ads: MetaAdRow[] = [];
    let currency = "AUD";
    for (const acc of accounts) {
      currency = acc.currency || currency;
      // Page through ad-level insights (there can be >25 ads across layers).
      let path: string | null =
        `${GRAPH}/act_${acc.account_id}/insights?level=ad` +
        `&fields=ad_id,ad_name,adset_name,campaign_name,spend,actions` +
        `&time_range=${timeRange}&limit=200`;
      while (path) {
        const res = await apiFetch("meta", path);
        const json: any = await res.json();
        if (json.error) break;
        for (const r of json.data || []) {
          const leadAction = (r.actions || []).find(
            (a: any) =>
              a.action_type === "lead" || a.action_type === "onsite_conversion.lead_grouped",
          );
          ads.push({
            adId: String(r.ad_id || ""),
            adName: r.ad_name || "(unnamed ad)",
            adsetName: r.adset_name || "",
            campaignName: r.campaign_name || "",
            layer: layerFromCampaign(r.campaign_name),
            spend: parseFloat(r.spend || "0"),
            leads: leadAction ? parseFloat(leadAction.value) : 0,
          });
        }
        // Follow paging.next (absolute URL) -> strip host so apiFetch re-adds it.
        const next: string | undefined = json.paging?.next;
        path = next ? next.replace(/^https:\/\/graph\.facebook\.com/, "") : null;
      }
    }
    return { ok: true, ads, currency };
  } catch (e: any) {
    return { ok: false, ads: [], currency: "AUD", message: e?.message || "Meta request failed" };
  }
}
