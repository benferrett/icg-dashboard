// Aggregation logic that turns raw HubSpot deals into the dashboard's four sections.
import { hubspot } from "./hubspot";
import {
  ownerName,
  pipelineName,
  stageName,
  sourceLabel,
  PIPELINES,
  MEMBERSHIP_STAGES,
  MEMBERSHIP_SOLD_STAGES,
  DISCOVERY_BOOKED_STAGE,
  BOOKING_CONSULTANTS,
  DS_TITLE_PREFIX,
  DS_SAT_STAGES,
  MEMBERSHIP_SOLD_TIERS,
} from "./reference";

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function num(v?: string): number {
  if (!v) return 0;
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

// ---- Section helpers -------------------------------------------------------

async function pipelineTotals() {
  const entries = await Promise.all(
    Object.keys(PIPELINES).map(async (id) => {
      const total = await hubspot.countDeals([
        { filters: [{ propertyName: "pipeline", operator: "EQ", value: id }] },
      ]);
      return { id, name: pipelineName(id), total };
    }),
  );
  return entries.sort((a, b) => b.total - a.total);
}

async function createdInLastDays(days: number): Promise<number> {
  return hubspot.countDeals([
    { filters: [{ propertyName: "createdate", operator: "GTE", value: isoDaysAgo(days) }] },
  ]);
}

async function stageCount(stageId: string): Promise<number> {
  return hubspot.countDeals([
    { filters: [{ propertyName: "dealstage", operator: "EQ", value: stageId }] },
  ]);
}

// ---- MARKETING -------------------------------------------------------------
async function marketing() {
  const [last7, last30, last90, total] = await Promise.all([
    createdInLastDays(7),
    createdInLastDays(30),
    createdInLastDays(90),
    hubspot.countDeals([]),
  ]);

  // Source breakdown for deals created in the last 90 days (sample up to 1000)
  const recent = await hubspot.searchDeals(
    {
      filterGroups: [
        { filters: [{ propertyName: "createdate", operator: "GTE", value: isoDaysAgo(90) }] },
      ],
      properties: ["hs_analytics_source", "createdate"],
      sorts: [{ propertyName: "createdate", direction: "DESCENDING" }],
    },
    1000,
  );
  const bySource: Record<string, number> = {};
  for (const d of recent) {
    const s = sourceLabel(d.properties.hs_analytics_source);
    bySource[s] = (bySource[s] || 0) + 1;
  }
  const sources = Object.entries(bySource)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  // Lead volume per day for last 30 days (trend)
  const last30deals = recent.filter(
    (d) => (d.properties.createdate || "") >= isoDaysAgo(30) + "T00:00:00Z",
  );
  const byDay: Record<string, number> = {};
  for (let i = 29; i >= 0; i--) byDay[isoDaysAgo(i)] = 0;
  for (const d of last30deals) {
    const day = (d.properties.createdate || "").slice(0, 10);
    if (day in byDay) byDay[day]++;
  }
  const trend = Object.entries(byDay).map(([date, count]) => ({ date, count }));

  return {
    newLeads7: last7,
    newLeads30: last30,
    newLeads90: last90,
    totalDeals: total,
    sources,
    trend,
    sampleSize: recent.length,
  };
}

// ---- EMBR LEADS ------------------------------------------------------------
// EMBR (EMBR x EasyPropertyInvestor) is a fixed-rate lead provider. Leads are
// HubSpot contacts tagged lead_source='EMBR', billed at a contractual AUD $154
// per lead. Spend = lead count x $154; CPL is always $154.
const EMBR_CPL = 154;

async function embrLeadsInLastDays(days: number): Promise<number> {
  return hubspot.countContacts([
    {
      filters: [
        { propertyName: "lead_source", operator: "EQ", value: "EMBR" },
        { propertyName: "createdate", operator: "GTE", value: isoDaysAgo(days) },
      ],
    },
  ]);
}

async function embr() {
  const win = (leads: number) => ({ leads, spend: leads * EMBR_CPL, cpl: EMBR_CPL });
  try {
    const [leads7, leads30, leads90, leadsTotal] = await Promise.all([
      embrLeadsInLastDays(7),
      embrLeadsInLastDays(30),
      embrLeadsInLastDays(90),
      hubspot.countContacts([
        { filters: [{ propertyName: "lead_source", operator: "EQ", value: "EMBR" }] },
      ]),
    ]);
    return {
      cpl: EMBR_CPL,
      ok: true,
      last7: win(leads7),
      last30: win(leads30),
      last90: win(leads90),
      total: win(leadsTotal),
    };
  } catch (err: any) {
    // EMBR leads are HubSpot contacts; if the token lacks the
    // crm.objects.contacts.read scope this 401s. Degrade gracefully so the
    // rest of the dashboard keeps loading instead of failing entirely.
    return {
      cpl: EMBR_CPL,
      ok: false,
      error: err?.message || "EMBR data unavailable",
      last7: win(0),
      last30: win(0),
      last90: win(0),
      total: win(0),
    };
  }
}

// ---- SALES FUNNEL ----------------------------------------------------------
// Five funnel metrics tracked per window (this week / month / FY), mirroring the
// weekly sales-management report methodology:
//   1. contact rate of leads        (any call logged on the lead)
//   2. leads connected > 30 seconds (a call with duration >= 30000 ms)
//   3. discovery sessions booked     (DS-titled meeting created in window)
//   4. discovery sessions sat        (DS meeting started + validated via DS Sat-* stage)
//   5. memberships sold              (deal entered a membership-sold stage in window)
// Consultants are paid on SAT sessions, so sat validation must be exact.

const MEL_OFFSET_MS = 10 * 60 * 60 * 1000; // Australia/Melbourne (no DST in scope)
const CONNECT_MS = 30000; // >= 30s connect threshold (hs_call_duration is in ms)

// UTC ISO string of a Melbourne-local calendar boundary.
function melBoundary(kind: "week" | "month" | "fy"): string {
  const nowMel = new Date(Date.now() + MEL_OFFSET_MS);
  const y = nowMel.getUTCFullYear();
  const m = nowMel.getUTCMonth(); // 0-based
  const d = nowMel.getUTCDate();
  let melMidnightUtcMs: number;
  if (kind === "week") {
    // Monday 00:00 Melbourne. getUTCDay: 0=Sun..6=Sat -> days since Monday.
    const dow = nowMel.getUTCDay();
    const daysSinceMon = (dow + 6) % 7;
    melMidnightUtcMs = Date.UTC(y, m, d - daysSinceMon, 0, 0, 0);
  } else if (kind === "month") {
    melMidnightUtcMs = Date.UTC(y, m, 1, 0, 0, 0);
  } else {
    // AU financial year starts 1 July. getUTCMonth() 6 === July.
    const fyYear = m >= 6 ? y : y - 1;
    melMidnightUtcMs = Date.UTC(fyYear, 6, 1, 0, 0, 0);
  }
  // melMidnightUtcMs was built as if Melbourne-local == UTC; subtract the offset
  // to get the true UTC instant of that Melbourne wall-clock midnight.
  return new Date(melMidnightUtcMs - MEL_OFFSET_MS).toISOString();
}

interface FunnelConsultant {
  name: string;
  leads: number;
  contacted: number;
  connected: number;
  contactRate: number;
  connectRate: number;
}

// Contact funnel: new leads (contacts) created in window, split by booking
// consultant, with contact rate (any call) and >30s connect rate.
async function contactFunnel(startIso: string) {
  const contacts = await hubspot.searchObjects(
    "contacts",
    {
      filterGroups: [
        { filters: [{ propertyName: "createdate", operator: "GTE", value: startIso }] },
      ],
      properties: ["hubspot_owner_id", "createdate"],
      sorts: [{ propertyName: "createdate", direction: "DESCENDING" }],
    },
    5000,
  );

  const leadIds = contacts.map((c) => c.id);
  const leadOwner: Record<string, string | undefined> = {};
  for (const c of contacts) leadOwner[c.id] = c.properties.hubspot_owner_id;

  // contact -> associated call ids
  const callAssoc = leadIds.length
    ? await hubspot.batchAssociations("contacts", "calls", leadIds)
    : {};
  const allCallIds = Array.from(new Set(Object.values(callAssoc).flat()));
  const callProps = allCallIds.length
    ? await hubspot.batchRead("calls", allCallIds, ["hs_call_duration"])
    : {};

  // Group by canonical consultant name (BOOKING_CONSULTANTS), plus an
  // "Other / Unassigned" bucket so totals reconcile with total leads.
  type Agg = { leads: number; contacted: number; connected: number };
  const byName: Record<string, Agg> = {};
  const ensure = (n: string) =>
    (byName[n] = byName[n] || { leads: 0, contacted: 0, connected: 0 });

  for (const id of leadIds) {
    const owner = leadOwner[id];
    const name = (owner && BOOKING_CONSULTANTS[owner]) || "Other / Unassigned";
    const agg = ensure(name);
    agg.leads++;
    const calls = callAssoc[id] || [];
    if (calls.length) {
      agg.contacted++;
      const connected = calls.some(
        (cid) => num(callProps[cid]?.hs_call_duration) >= CONNECT_MS,
      );
      if (connected) agg.connected++;
    }
  }

  const consultants: FunnelConsultant[] = Object.entries(byName)
    .map(([name, v]) => ({
      name,
      leads: v.leads,
      contacted: v.contacted,
      connected: v.connected,
      contactRate: v.leads ? Math.round((v.contacted / v.leads) * 100) : 0,
      connectRate: v.leads ? Math.round((v.connected / v.leads) * 100) : 0,
    }))
    .sort((a, b) => b.leads - a.leads);

  const t = consultants.reduce(
    (acc, c) => {
      acc.leads += c.leads;
      acc.contacted += c.contacted;
      acc.connected += c.connected;
      return acc;
    },
    { leads: 0, contacted: 0, connected: 0 },
  );
  const totals = {
    leads: t.leads,
    contacted: t.contacted,
    connected: t.connected,
    contactRate: t.leads ? Math.round((t.contacted / t.leads) * 100) : 0,
    connectRate: t.leads ? Math.round((t.connected / t.leads) * 100) : 0,
  };
  return { consultants, totals };
}

// Discovery sessions: booked = DS-titled meeting created in window;
// sat = DS meeting that has started, validated via an associated deal sitting in
// any DS Sat-* stage (fallback: hs_meeting_outcome === "COMPLETED").
async function discoverySessions(startIso: string, nowIso: string) {
  const meetings = await hubspot.searchObjects(
    "meetings",
    {
      filterGroups: [
        { filters: [{ propertyName: "hs_createdate", operator: "GTE", value: startIso }] },
      ],
      properties: [
        "hs_meeting_title",
        "hs_meeting_start_time",
        "hs_meeting_outcome",
        "hs_createdate",
      ],
      sorts: [{ propertyName: "hs_createdate", direction: "DESCENDING" }],
    },
    3000,
  );

  const isDs = (m: any) =>
    (m.properties.hs_meeting_title || "").startsWith(DS_TITLE_PREFIX);
  const dsMeetings = meetings.filter(isDs);

  // Booked: DS meeting created in window.
  const booked = dsMeetings.length;

  // Candidate sat: DS meeting that has already started (start_time in [start, now]).
  const started = dsMeetings.filter((m) => {
    const st = m.properties.hs_meeting_start_time;
    return !!st && st >= startIso && st <= nowIso;
  });

  let sat = 0;
  if (started.length) {
    const meetingIds = started.map((m) => m.id);
    const dealAssoc = await hubspot.batchAssociations("meetings", "deals", meetingIds);
    const allDealIds = Array.from(new Set(Object.values(dealAssoc).flat()));
    const dealProps = allDealIds.length
      ? await hubspot.batchRead("deals", allDealIds, ["dealstage"])
      : {};
    for (const m of started) {
      const deals = dealAssoc[m.id] || [];
      const satByStage = deals.some((did) =>
        DS_SAT_STAGES.includes(dealProps[did]?.dealstage || ""),
      );
      const satByOutcome = m.properties.hs_meeting_outcome === "COMPLETED";
      if (satByStage || satByOutcome) sat++;
    }
  }

  return { booked, started: started.length, sat };
}

// Memberships sold in window: for each membership-sold stage, find deals and
// count those that ENTERED the stage within the window. hs_v2_date_entered_*
// is NOT API-filterable (returns 400), so we filter in code.
async function membershipsSoldSince(startIso: string) {
  const tiers: Record<string, number> = {};
  let total = 0;
  for (const [stageId, tier] of Object.entries(MEMBERSHIP_SOLD_TIERS)) {
    const enteredProp = `hs_v2_date_entered_${stageId}`;
    const deals = await hubspot.searchObjects(
      "deals",
      {
        filterGroups: [
          { filters: [{ propertyName: "dealstage", operator: "EQ", value: stageId }] },
        ],
        properties: ["dealstage", enteredProp],
      },
      2000,
    );
    let count = 0;
    for (const d of deals) {
      const entered = d.properties[enteredProp];
      if (entered && entered >= startIso) count++;
    }
    tiers[tier] = count;
    total += count;
  }
  return { total, tiers };
}

interface FunnelWindow {
  label: string;
  start: string;
  consultants: FunnelConsultant[];
  totals: {
    leads: number;
    contacted: number;
    connected: number;
    contactRate: number;
    connectRate: number;
  };
  dsBooked: number;
  dsStarted: number;
  dsSat: number;
  membershipsSold: number;
  membershipTiers: Record<string, number>;
}

async function salesFunnelWindow(
  label: string,
  start: string,
  nowIso: string,
): Promise<FunnelWindow> {
  const [contact, ds, sold] = await Promise.all([
    contactFunnel(start),
    discoverySessions(start, nowIso),
    membershipsSoldSince(start),
  ]);
  return {
    label,
    start,
    consultants: contact.consultants,
    totals: contact.totals,
    dsBooked: ds.booked,
    dsStarted: ds.started,
    dsSat: ds.sat,
    membershipsSold: sold.total,
    membershipTiers: sold.tiers,
  };
}

async function salesFunnel() {
  try {
    const nowIso = new Date().toISOString();
    const [week, month, fy] = await Promise.all([
      salesFunnelWindow("This Week", melBoundary("week"), nowIso),
      salesFunnelWindow("This Month", melBoundary("month"), nowIso),
      salesFunnelWindow("This FY", melBoundary("fy"), nowIso),
    ]);
    return { ok: true, week, month, fy };
  } catch (err: any) {
    return { ok: false, error: err?.message || "Sales funnel data unavailable" };
  }
}

// ---- CONSULTANT TEAM (booking consultants) --------------------------------
async function consultantTeam() {
  // Pull recent consultant-pipeline deals and group by booking_consultant
  const deals = await hubspot.searchDeals(
    {
      filterGroups: [
        { filters: [{ propertyName: "createdate", operator: "GTE", value: isoDaysAgo(90) }] },
      ],
      properties: ["booking_consultant", "dealstage", "hubspot_owner_id", "createdate"],
      sorts: [{ propertyName: "createdate", direction: "DESCENDING" }],
    },
    1000,
  );
  const byConsultant: Record<string, { deals: number; dsBooked: number; sold: number }> = {};
  for (const d of deals) {
    const c = d.properties.booking_consultant || d.properties.hubspot_owner_id;
    if (!c) continue;
    const key = ownerName(c);
    if (!byConsultant[key]) byConsultant[key] = { deals: 0, dsBooked: 0, sold: 0 };
    byConsultant[key].deals++;
    if (d.properties.dealstage === DISCOVERY_BOOKED_STAGE) byConsultant[key].dsBooked++;
    if (MEMBERSHIP_SOLD_STAGES.includes(d.properties.dealstage || "")) byConsultant[key].sold++;
  }
  return Object.entries(byConsultant)
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.deals - a.deals)
    .slice(0, 15);
}

// ---- STRATEGIST TEAM -------------------------------------------------------
async function strategistTeam() {
  const deals = await hubspot.searchDeals(
    {
      filterGroups: [
        { filters: [{ propertyName: "strategist", operator: "HAS_PROPERTY" }] },
      ],
      properties: ["strategist", "dealstage", "createdate"],
      sorts: [{ propertyName: "createdate", direction: "DESCENDING" }],
    },
    1000,
  );
  const byStrategist: Record<string, { assigned: number; sold: number }> = {};
  for (const d of deals) {
    const s = d.properties.strategist;
    if (!s) continue;
    const key = ownerName(s);
    if (!byStrategist[key]) byStrategist[key] = { assigned: 0, sold: 0 };
    byStrategist[key].assigned++;
    if (MEMBERSHIP_SOLD_STAGES.includes(d.properties.dealstage || "")) byStrategist[key].sold++;
  }
  return Object.entries(byStrategist)
    .map(([name, v]) => ({
      name,
      ...v,
      conversion: v.assigned ? Math.round((v.sold / v.assigned) * 100) : 0,
    }))
    .sort((a, b) => b.assigned - a.assigned)
    .slice(0, 15);
}

// ---- MEMBERSHIPS (Bronze/Silver/Gold) -------------------------------------
async function memberships() {
  const [bronze, silver, gold] = await Promise.all([
    stageCount(MEMBERSHIP_STAGES.bronze),
    stageCount(MEMBERSHIP_STAGES.silver),
    stageCount(MEMBERSHIP_STAGES.gold),
  ]);
  return { bronze, silver, gold, total: bronze + silver + gold };
}

// ---- CONTRACTS / FINANCIAL -------------------------------------------------
async function contracts() {
  // Contract pipeline deals
  const deals = await hubspot.searchDeals(
    {
      filterGroups: [
        { filters: [{ propertyName: "pipeline", operator: "EQ", value: "1578114550" }] },
      ],
      properties: [
        "dealname",
        "dealstage",
        "contract_status",
        "payment_status",
        "amount",
        "amount_in_home_currency",
        "closedate",
        "hubspot_owner_id",
        "createdate",
      ],
      sorts: [{ propertyName: "hs_lastmodifieddate", direction: "DESCENDING" }],
    },
    500,
  );

  const byContractStatus: Record<string, number> = {};
  const byStage: Record<string, number> = {};
  let pipelineValue = 0;
  const recentList: any[] = [];

  for (const d of deals) {
    const cs = d.properties.contract_status || "Not Set";
    byContractStatus[cs] = (byContractStatus[cs] || 0) + 1;
    const st = stageName(d.properties.dealstage);
    byStage[st] = (byStage[st] || 0) + 1;
    pipelineValue += num(d.properties.amount_in_home_currency) || num(d.properties.amount);
    if (recentList.length < 12) {
      recentList.push({
        name: d.properties.dealname || "Unnamed",
        stage: st,
        contractStatus: d.properties.contract_status || "—",
        paymentStatus: d.properties.payment_status || "—",
        amount: num(d.properties.amount_in_home_currency) || num(d.properties.amount),
        owner: ownerName(d.properties.hubspot_owner_id),
        url: `https://app.hubspot.com/contacts/442187411/record/0-3/${d.id}`,
      });
    }
  }

  return {
    totalContracts: deals.length,
    pipelineValue,
    contractStatus: Object.entries(byContractStatus)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    byStage: Object.entries(byStage)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    recent: recentList,
  };
}

// ---- FINANCIAL (closed/won values across property + settlement pipelines) --
async function financial() {
  // Settlement + construction pipelines hold the high-value property deals
  const pipelineIds = ["1527507417", "1578114550", "1814691263", "1841864138"];
  const deals = await hubspot.searchDeals(
    {
      filterGroups: pipelineIds.map((id) => ({
        filters: [{ propertyName: "pipeline", operator: "EQ", value: id }],
      })),
      properties: ["amount", "amount_in_home_currency", "pipeline", "closedate", "createdate"],
      sorts: [{ propertyName: "createdate", direction: "DESCENDING" }],
    },
    1000,
  );

  let totalValue = 0;
  const byPipeline: Record<string, { count: number; value: number }> = {};
  const byMonth: Record<string, number> = {};

  for (const d of deals) {
    const amt = num(d.properties.amount_in_home_currency) || num(d.properties.amount);
    totalValue += amt;
    const pn = pipelineName(d.properties.pipeline);
    if (!byPipeline[pn]) byPipeline[pn] = { count: 0, value: 0 };
    byPipeline[pn].count++;
    byPipeline[pn].value += amt;
    const month = (d.properties.createdate || "").slice(0, 7);
    if (month) byMonth[month] = (byMonth[month] || 0) + amt;
  }

  const monthly = Object.entries(byMonth)
    .map(([month, value]) => ({ month, value }))
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-12);

  return {
    totalValue,
    dealCount: deals.length,
    byPipeline: Object.entries(byPipeline).map(([name, v]) => ({ name, ...v })),
    monthly,
  };
}

// ---- Top-level orchestrator ------------------------------------------------
export async function buildDashboard() {
  const [
    pipelines,
    mkt,
    embrData,
    funnel,
    consultants,
    strategists,
    members,
    contractData,
    fin,
  ] = await Promise.all([
    pipelineTotals(),
    marketing(),
    embr(),
    salesFunnel(),
    consultantTeam(),
    strategistTeam(),
    memberships(),
    contracts(),
    financial(),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    pipelines,
    marketing: mkt,
    embr: embrData,
    salesFunnel: funnel,
    consultants,
    strategists,
    memberships: members,
    contracts: contractData,
    financial: fin,
  };
}
