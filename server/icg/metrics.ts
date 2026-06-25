// Aggregation logic that turns raw HubSpot deals into the dashboard's four sections.
import { hubspot } from "./hubspot";
import { PeriodRange, parsePeriod } from "./period";
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
  CONTRACT_PIPELINE,
  CONTRACT_FUNNEL_STEPS,
  CONTRACT_UC_PIPELINES,
  CONTRACT_EXCLUDE_STAGES,
  CONTRACT_STAGE_TO_STEP,
  isStrategistOwner,
  STRATEGIST_OWNERS,
  STRATEGIST_NAME_TOKENS,
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
async function marketing(range: PeriodRange) {
  const [last7, last30, last90, total, periodLeads] = await Promise.all([
    createdInLastDays(7),
    createdInLastDays(30),
    createdInLastDays(90),
    hubspot.countDeals([]),
    // New deals created within the selected period (pivots with the selector).
    hubspot.countDeals([
      {
        filters: [
          { propertyName: "createdate", operator: "GTE", value: range.start },
          { propertyName: "createdate", operator: "LT", value: range.end },
        ],
      },
    ]),
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
    periodLeads,
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

const CONNECT_MS = 30000; // >= 30s connect threshold (hs_call_duration is in ms)

interface FunnelConsultant {
  name: string;
  leads: number;
  contacted: number;
  connected: number;
  contactRate: number;
  connectRate: number;
}

// Contact funnel: new leads (contacts) created in [start, end), split by booking
// consultant, with contact rate (any call) and >30s connect rate.
async function contactFunnel(startIso: string, endIso: string) {
  const contacts = await hubspot.searchObjects(
    "contacts",
    {
      filterGroups: [
        {
          filters: [
            { propertyName: "createdate", operator: "GTE", value: startIso },
            { propertyName: "createdate", operator: "LT", value: endIso },
          ],
        },
      ],
      properties: ["hubspot_owner_id", "createdate"],
      sorts: [{ propertyName: "createdate", direction: "DESCENDING" }],
    },
    20000,
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
async function discoverySessions(startIso: string, endIso: string) {
  const meetings = await hubspot.searchObjects(
    "meetings",
    {
      filterGroups: [
        {
          filters: [
            { propertyName: "hs_createdate", operator: "GTE", value: startIso },
            { propertyName: "hs_createdate", operator: "LT", value: endIso },
          ],
        },
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

  // Candidate sat: DS meeting that has already started within [start, end).
  const started = dsMeetings.filter((m) => {
    const st = m.properties.hs_meeting_start_time;
    return !!st && st >= startIso && st < endIso;
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
async function membershipsSold(startIso: string, endIso: string) {
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
      3000,
    );
    let count = 0;
    for (const d of deals) {
      const entered = d.properties[enteredProp];
      if (entered && entered >= startIso && entered < endIso) count++;
    }
    tiers[tier] = count;
    total += count;
  }
  return { total, tiers };
}

interface FunnelWindow {
  label: string;
  start: string;
  end: string;
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

// Compute the full sales funnel for a single period range. Graceful degrade so a
// failure here never blocks the rest of the dashboard.
async function salesFunnel(range: PeriodRange) {
  try {
    const [contact, ds, sold] = await Promise.all([
      contactFunnel(range.start, range.end),
      discoverySessions(range.start, range.end),
      membershipsSold(range.start, range.end),
    ]);
    const window: FunnelWindow = {
      label: range.label,
      start: range.start,
      end: range.end,
      consultants: contact.consultants,
      totals: contact.totals,
      dsBooked: ds.booked,
      dsStarted: ds.started,
      dsSat: ds.sat,
      membershipsSold: sold.total,
      membershipTiers: sold.tiers,
    };
    return { ok: true as const, window };
  } catch (err: any) {
    return { ok: false as const, error: err?.message || "Sales funnel data unavailable" };
  }
}

// ---- CONSULTANT TEAM (booking consultants) --------------------------------
async function consultantTeam(range: PeriodRange) {
  // Pull consultant-pipeline deals created within the selected period and group
  // by booking_consultant.
  const deals = await hubspot.searchDeals(
    {
      filterGroups: [
        {
          filters: [
            { propertyName: "createdate", operator: "GTE", value: range.start },
            { propertyName: "createdate", operator: "LT", value: range.end },
          ],
        },
      ],
      properties: ["booking_consultant", "dealstage", "hubspot_owner_id", "createdate"],
      sorts: [{ propertyName: "createdate", direction: "DESCENDING" }],
    },
    5000,
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
async function strategistTeam(range: PeriodRange) {
  const deals = await hubspot.searchDeals(
    {
      filterGroups: [
        {
          filters: [
            { propertyName: "strategist", operator: "HAS_PROPERTY" },
            { propertyName: "createdate", operator: "GTE", value: range.start },
            { propertyName: "createdate", operator: "LT", value: range.end },
          ],
        },
      ],
      properties: ["strategist", "dealstage", "createdate"],
      sorts: [{ propertyName: "createdate", direction: "DESCENDING" }],
    },
    5000,
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

// ---- CONTRACTS (5-step funnel, current-stage-only, period-pivoted) ---------
// Ben's funnel: EOI Received -> Contracts Issued -> Contracts Signed ->
// Contracts Exchanged -> Unconditional (UC). Each deal counts ONCE, in the
// single step matching its CURRENT stage. UC also includes ALL settlement-
// pipeline deals. EOI Cancelled is excluded. Period filtering uses the date the
// deal ENTERED its current funnel step (hs_v2_date_entered_<stageId>), i.e. the
// EOI-signed / UC date for that deal's position.
// Derive the handling strategist for deals that have no strategist field and no
// strategist contact-owner, using the deal's OWN ACTIVITY. The strongest signal
// is who CREATED the engagements (meetings/notes/calls) with the client; a
// secondary signal is strategist names appearing in the engagement text. Both
// only ever resolve to a genuine strategist, never a consultant or contract-team
// member. Returns { dealId -> strategistName } for the resolved deals.
async function strategistFromActivity(
  dealIds: string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!dealIds.length) return out;

  // engagement type -> [text props to scan] (hs_created_by is always read).
  const ENG: Record<string, string[]> = {
    meetings: ["hs_meeting_title", "hs_meeting_body"],
    notes: ["hs_note_body"],
    calls: ["hs_call_title", "hs_call_body"],
    tasks: ["hs_task_subject", "hs_task_body"],
  };

  // Per deal: tally strategist votes from (a) engagement creators, (b) text.
  const creatorVotes: Record<string, Record<string, number>> = {};
  const textVotes: Record<string, Record<string, number>> = {};
  for (const id of dealIds) {
    creatorVotes[id] = {};
    textVotes[id] = {};
  }

  const strip = (h?: string) =>
    (h || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").toLowerCase();

  for (const [engType, textProps] of Object.entries(ENG)) {
    const assoc = await hubspot.batchAssociations("deals", engType, dealIds);
    const engIds = Array.from(new Set(Object.values(assoc).flat()));
    if (!engIds.length) continue;
    const engProps = await hubspot.batchRead(engType, engIds, [
      "hs_created_by",
      ...textProps,
    ]);
    for (const dealId of dealIds) {
      for (const engId of assoc[dealId] || []) {
        const ep = engProps[engId] as any;
        if (!ep) continue;
        // (a) creator vote — only if creator is a real strategist (not Ben:
        // contract admin is sometimes created by Ben, which isn't delivery).
        const cb = ep.hs_created_by ? String(ep.hs_created_by) : undefined;
        if (cb && cb in STRATEGIST_OWNERS && cb !== "82710130") {
          creatorVotes[dealId][cb] = (creatorVotes[dealId][cb] || 0) + 1;
        }
        // (b) text vote — strategist names mentioned in the engagement.
        const blob = textProps.map((p) => strip(ep[p])).join(" ");
        for (const [token, oid] of Object.entries(STRATEGIST_NAME_TOKENS)) {
          if (blob.includes(token)) {
            textVotes[dealId][oid] = (textVotes[dealId][oid] || 0) + 1;
          }
        }
      }
    }
  }

  const topVote = (votes: Record<string, number>): string | undefined => {
    let best: string | undefined;
    let bestN = 0;
    for (const [oid, n] of Object.entries(votes)) {
      if (n > bestN) {
        bestN = n;
        best = oid;
      }
    }
    return best;
  };

  for (const id of dealIds) {
    // Prefer who actually ran the engagements; fall back to text mentions.
    const pick = topVote(creatorVotes[id]) || topVote(textVotes[id]);
    if (pick) out[id] = ownerName(pick);
  }
  return out;
}

async function contracts(range: PeriodRange) {
  const startMs = +new Date(range.start);
  const endMs = +new Date(range.end);

  // Every entered-date property we may need to read (one per funnel stage).
  const enteredProps = CONTRACT_FUNNEL_STEPS.flatMap((s) =>
    s.stages.map((id) => `hs_v2_date_entered_${id}`),
  );
  const baseProps = [
    "dealname",
    "dealstage",
    "pipeline",
    "amount",
    "amount_in_home_currency",
    "closedate",
    "hubspot_owner_id",
    "createdate",
    "hs_lastmodifieddate",
    // Deal-card strategist fields (primary attribution source). `strategist`
    // holds the strategist's owner ID; `strategist_assigned` is a text label.
    "strategist",
    "strategist_assigned",
  ];

  // Pull Contract pipeline + both settlement pipelines in one search (OR groups).
  const pipelineIds = [CONTRACT_PIPELINE, ...CONTRACT_UC_PIPELINES];
  const deals = await hubspot.searchDeals(
    {
      filterGroups: pipelineIds.map((id) => ({
        filters: [{ propertyName: "pipeline", operator: "EQ", value: id }],
      })),
      properties: [...baseProps, ...enteredProps],
      sorts: [{ propertyName: "hs_lastmodifieddate", direction: "DESCENDING" }],
    },
    1000,
  );

  // --- Strategist attribution -----------------------------------------------
  // Source of truth = the deal card's `strategist` field (an owner ID). It is
  // populated by the team on the contract record itself, so it's the most
  // reliable signal. When that's blank we fall back to the associated CLIENT
  // CONTACT's owner (contract deals are owned by the contract team, not the
  // strategist), and finally to `strategist_assigned` text. The dashboard's
  // `owner` then falls back to deal owner / "Unattributed".
  const dealIds = deals.map((d) => d.id);
  const dealStrategist: Record<string, string> = {};

  // Only do the (slower) contact-association lookup for deals missing the
  // strategist field, to keep this fast.
  const needContactLookup = deals
    .filter((d) => !(d.properties as any).strategist)
    .map((d) => d.id);
  let assoc: Record<string, string[]> = {};
  let contactOwners: Record<string, Record<string, string | undefined>> = {};
  if (needContactLookup.length) {
    assoc = await hubspot.batchAssociations("deals", "contacts", needContactLookup);
    const allContactIds = Array.from(new Set(Object.values(assoc).flat()));
    contactOwners = allContactIds.length
      ? await hubspot.batchRead("contacts", allContactIds, ["hubspot_owner_id"])
      : {};
  }

  for (const d of deals) {
    const props = d.properties as any;
    // 1) Deal-card strategist field (owner ID).
    const stratId: string | undefined = props.strategist || undefined;
    if (stratId) {
      dealStrategist[d.id] = ownerName(stratId);
      continue;
    }
    // 2) Associated client-contact owner. Only ACCEPT it if the owner is a
    //    genuine strategist (or Ben). Consultants (Moses, Akhil) and the
    //    contract team (Raul) must NEVER be credited a contract, so if the
    //    contact owner isn't an allowed strategist we ignore it and let the
    //    deal fall through to "Unattributed" (surfaces as needs-attention).
    const contactIds = assoc[d.id] || [];
    let chosenOwnerId: string | undefined;
    for (const cid of contactIds) {
      const oid = contactOwners[cid]?.hubspot_owner_id;
      if (isStrategistOwner(oid)) {
        chosenOwnerId = oid || undefined;
        break;
      }
    }
    if (chosenOwnerId) {
      dealStrategist[d.id] = ownerName(chosenOwnerId);
      continue;
    }
    // 3) Text label fallback (only if it names a real person).
    if (props.strategist_assigned) {
      dealStrategist[d.id] = String(props.strategist_assigned);
      continue;
    }
    // 4) Otherwise leave unset for now — resolved via deal ACTIVITY below.
  }

  // 4) Activity-based attribution: for any deal still unresolved, derive the
  //    handling strategist from the deal's own meetings/notes/calls (who ran
  //    them, and strategist names in the text). This makes attribution
  //    self-healing — even deals where nobody set the strategist field get the
  //    real strategist who delivered the deal. Only genuinely activity-less
  //    deals (e.g. test records) remain "Unattributed".
  const stillUnresolved = deals
    .map((d) => d.id)
    .filter((id) => !dealStrategist[id]);
  if (stillUnresolved.length) {
    const fromActivity = await strategistFromActivity(stillUnresolved);
    for (const [id, name] of Object.entries(fromActivity)) {
      dealStrategist[id] = name;
    }
  }

  // step key -> { count, value, byStrategist: {name -> count} }
  const steps: Record<string, { count: number; value: number; byStrategist: Record<string, number> }> = {};
  for (const s of CONTRACT_FUNNEL_STEPS) {
    steps[s.key] = { count: 0, value: 0, byStrategist: {} };
  }

  let totalInPeriod = 0;
  let pipelineValue = 0;
  const recentList: any[] = [];

  for (const d of deals) {
    const stage = d.properties.dealstage || "";
    if (CONTRACT_EXCLUDE_STAGES.includes(stage)) continue;

    const pid = d.properties.pipeline || "";
    const isSettlement = CONTRACT_UC_PIPELINES.includes(pid);

    // Determine the funnel step for this deal's CURRENT position.
    let stepKey: string | undefined;
    let enteredIso: string | undefined;
    if (isSettlement) {
      stepKey = "uc";
      enteredIso = d.properties.closedate || d.properties.createdate || d.properties.hs_lastmodifieddate;
    } else {
      stepKey = CONTRACT_STAGE_TO_STEP[stage];
      if (!stepKey) continue; // stage not part of the funnel
      enteredIso = (d.properties as any)[`hs_v2_date_entered_${stage}`] ||
        d.properties.hs_lastmodifieddate || d.properties.closedate;
    }
    if (!stepKey) continue;

    // Period filter on the step-entered (EOI-signed / UC) date.
    if (enteredIso) {
      const t = +new Date(enteredIso);
      if (isNaN(t) || t < startMs || t >= endMs) continue;
    } else {
      continue;
    }

    const amt = num(d.properties.amount_in_home_currency) || num(d.properties.amount);
    // Strategist comes ONLY from the resolved chain above (deal-card strategist
    // -> strategist contact-owner -> text label). We deliberately do NOT fall
    // back to the deal owner, because contract deals are owned by the contract
    // team (Raul), not a strategist. Unresolved deals are "Unattributed" so
    // they surface as needing a strategist set on the card.
    const owner = dealStrategist[d.id] || "Unattributed";

    const bucket = steps[stepKey];
    bucket.count++;
    bucket.value += amt;
    bucket.byStrategist[owner] = (bucket.byStrategist[owner] || 0) + 1;

    totalInPeriod++;
    pipelineValue += amt;

    if (recentList.length < 15) {
      recentList.push({
        name: d.properties.dealname || "Unnamed",
        step: stepKey,
        stage: stageName(stage),
        amount: amt,
        owner,
        date: enteredIso,
        url: `https://app.hubspot.com/contacts/442187411/record/0-3/${d.id}`,
      });
    }
  }

  // Ordered funnel array.
  const funnel = CONTRACT_FUNNEL_STEPS.map((s) => ({
    key: s.key,
    label: s.label,
    count: steps[s.key].count,
    value: steps[s.key].value,
  }));

  // By-strategist matrix: one row per strategist, a count for each step.
  const stratSet = new Set<string>();
  for (const s of CONTRACT_FUNNEL_STEPS) {
    for (const name of Object.keys(steps[s.key].byStrategist)) stratSet.add(name);
  }
  const byStrategist = Array.from(stratSet)
    .map((name) => {
      const row: Record<string, any> = { name };
      let total = 0;
      for (const s of CONTRACT_FUNNEL_STEPS) {
        const c = steps[s.key].byStrategist[name] || 0;
        row[s.key] = c;
        total += c;
      }
      row.total = total;
      return row;
    })
    .sort((a, b) => b.total - a.total);

  return {
    totalContracts: totalInPeriod,
    pipelineValue,
    funnel,
    byStrategist,
    steps: CONTRACT_FUNNEL_STEPS.map((s) => ({ key: s.key, label: s.label })),
    recent: recentList.sort((a, b) => +new Date(b.date) - +new Date(a.date)),
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
export async function buildDashboard(periodKey?: string) {
  const range = parsePeriod(periodKey);
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
    marketing(range),
    embr(),
    salesFunnel(range),
    consultantTeam(range),
    strategistTeam(range),
    memberships(),
    contracts(range),
    financial(),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    period: {
      key: range.key,
      label: range.label,
      start: range.start,
      end: range.end,
    },
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
