// Meta (Facebook) Marketing API service. Uses saved credential custom-cred:graph.facebook.com.
// Returns ad spend / leads / CPL / ROAS, or a clear status object if the token is expired/missing.

import { proxyFetch, META_CRED } from "./proxy";

const GRAPH = "/v21.0";

export async function metaAds() {
  try {
    // 1. Find ad accounts
    const accRes = await proxyFetch(
      META_CRED(),
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
        const insRes = await proxyFetch(
          META_CRED(),
          `${GRAPH}/act_${acc.account_id}/insights?fields=spend,impressions,clicks,cpc,ctr,actions,cost_per_action_type&date_preset=last_30d`,
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
      window: "Last 30 days",
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
