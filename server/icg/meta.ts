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
