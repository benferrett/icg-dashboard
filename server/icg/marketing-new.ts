// Marketing NEW — monthly lead cohorts, leads through to UC.
//
// One row per LEAD MONTH (Melbourne calendar, January 2026 → current month).
// Every lead created in that month is followed FORWARD for all time, so each
// month's spend is matched to the outcomes its own leads produced:
//
//   Spend → Leads → CPL → DS booked (lead→DS %) → DS sat (show rate)
//         → Members (DS→member %, CAC) → EOI (member→EOI %) → UC (UC CAC)
//
// Definitions (kept consistent with the rest of the dashboard):
//   * Leads     — contacts created in the month whose source is EMBR or Meta
//                 under `bookingSourceOf` (EMBR = lead_source EMBR / embr_lead_id
//                 and wins; Meta = hs_analytics_source PAID_SOCIAL). Every other
//                 source is excluded, matching the DS-booked denominator rule.
//   * Spend     — Meta = invoiced Meta spend in the lead month; EMBR = $154 per
//                 EMBR lead in the cohort.
//   * DS booked — the lead has a Discovery Session meeting, or a deal that has
//                 reached a DS booked / no-show / sat stage.
//   * DS sched. — the lead has a DS meeting whose start time has passed (or sat).
//   * DS sat    — evidence-first attendance (`classifyAttendance`) on the lead's
//                 DS meetings, plus the established DS Sat stage rule.
//   * Show rate — DS sat ÷ DS scheduled (held-session denominator).
//   * Members   — GROSS paid memberships (`grossMembershipEligible`, linked
//                 opportunities resolved to one canonical membership). A later
//                 refund does not remove the original sale.
//   * EOI       — gross EOI milestones (eoi_paid_date / EOI stage history) on
//                 property deals, including later cancellations; tests excluded.
//   * UC        — property deals that reached Unconditional or a settlement
//                 pipeline; cancelled EOIs and tests excluded.
//   * CAC       — spend ÷ members.  UC CAC — spend ÷ UC deals.
//
// Each deal is credited once, to the earliest-created cohort lead it is
// associated with, so a couple created in different months cannot double count.

import { hubspot } from "./hubspot";
import { metaAds } from "./meta";
import { classifyAttendance, hasReviewedSat, recoverMembershipAssociations } from "./attendance";
import {
  grossMembershipEligible,
  membershipSaleMs,
  resolveLinkedMembershipDeals,
} from "./consultant-memberships";
import { eoiMilestoneMs, isEoiTestRecord, EOI_PAID_DATE_PROP } from "./eoi-reporting";
import {
  BOOKING_SOURCE_PROPS,
  bookingSourceOf,
  CONTRACT_EOI_PIPELINES,
  CONTRACT_EOI_REFUND_STAGE,
  CONTRACT_EOI_STAGES,
  CONTRACT_PIPELINE,
  CONTRACT_UC_PIPELINES,
  CONTRACT_UC_STAGE,
  DISCOVERY_BOOKED_STAGE,
  DS_SAT_STAGES,
  DS_TITLE_PREFIX,
  MEMBERSHIP_REFUND_STAGE,
  MEMBERSHIP_SOLD_STAGES,
  ownerName,
  pipelineName,
  stageName,
} from "./reference";
import { parseLeadMonth, type CohortRange } from "./marketing-beta";

export const EMBR_CPL = 154;
export const COHORT_START_MONTH = "2026-01";
const MATURITY_DAYS = 90;
const HS = "https://app.hubspot.com/contacts/442187411/record";

type Channel = "META" | "EMBR";
const MEMBERSHIP_PIPELINES = new Set(["1448193481", "1446363635", "1575801320"]);
const PROPERTY_PIPELINES = new Set([CONTRACT_PIPELINE, ...CONTRACT_UC_PIPELINES, ...CONTRACT_EOI_PIPELINES]);
const DS_STAGE_BOOKED = new Set<string>([DISCOVERY_BOOKED_STAGE, "2868125118", ...DS_SAT_STAGES]);
const DS_STAGE_SAT = new Set<string>(DS_SAT_STAGES);

const DEAL_PROPS = Array.from(new Set([
  "dealname", "dealstage", "pipeline", "closedate", "createdate", "amount",
  "amount_in_home_currency", "strategist",
  "booking_consultant", "hubspot_owner_id", "membership_paid_date",
  `hs_v2_date_entered_2872614380`,
  `hs_v2_date_entered_${MEMBERSHIP_REFUND_STAGE}`,
  ...MEMBERSHIP_SOLD_STAGES.map((id) => `hs_v2_date_entered_${id}`),
  ...DS_SAT_STAGES.map((id) => `hs_v2_date_entered_${id}`),
  `hs_v2_date_entered_${DISCOVERY_BOOKED_STAGE}`,
  "hs_v2_date_entered_2868125118",
  EOI_PAID_DATE_PROP,
  ...CONTRACT_EOI_STAGES.map((id) => `hs_v2_date_entered_${id}`),
  `hs_v2_date_entered_${CONTRACT_UC_STAGE}`,
]));

export interface CohortStats {
  spend: number;
  leads: number;
  cpl: number | null;
  booked: number;
  leadToBooked: number | null; // booked ÷ leads
  scheduled: number;
  sat: number;
  showRate: number | null; // sat ÷ scheduled
  members: number;
  dsToMember: number | null; // members ÷ sat
  cac: number | null; // spend ÷ members
  eoiDeals: number;
  eoiClients: number;
  memberToEoi: number | null; // EOI clients ÷ members
  uc: number;
  ucCac: number | null; // spend ÷ UC deals
}

export interface CohortOutcome {
  type: "member" | "eoi" | "uc";
  channel: Channel;
  client: string;
  contactUrl: string;
  dealName: string;
  dealUrl: string;
  date?: string; // ISO milestone date
  daysFromLead?: number;
  refunded?: boolean;
}

// One property deal (EOI and/or UC) from the cohort, for the month detail view.
export interface CohortPropertyDeal {
  dealId: string;
  dealName: string;
  dealUrl: string;
  client: string;
  contactUrl: string;
  channel: Channel;
  stage: string;
  pipeline: string;
  strategist?: string;
  amount: number | null;
  status: "uc" | "open" | "cancelled";
  eoiDate?: string;
  ucDate?: string;
  daysLeadToEoi?: number;
  daysEoiToUc?: number;
}

export interface CohortMonth {
  month: string; // YYYY-MM
  label: string;
  start: string;
  end: string;
  maturingDaysLeft: number; // 0 = mature (≥90 days since month end)
  metaSpendStatus: "ok" | "error";
  metaSpendMessage?: string;
  meta: CohortStats;
  embr: CohortStats;
  total: CohortStats;
  outcomes: CohortOutcome[];
  propertyDeals: CohortPropertyDeal[];
}

export interface MarketingNewPayload {
  ok: true;
  generatedAt: string;
  embrCpl: number;
  months: CohortMonth[];
  totals: { meta: CohortStats; embr: CohortStats; total: CohortStats };
}

interface Counts {
  spend: number; leads: number; booked: number; scheduled: number; sat: number;
  members: number; eoiDeals: number; eoiClients: number; uc: number;
}
const zero = (): Counts => ({ spend: 0, leads: 0, booked: 0, scheduled: 0, sat: 0, members: 0, eoiDeals: 0, eoiClients: 0, uc: 0 });
const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

export function finalizeCohort(c: Counts): CohortStats {
  return {
    ...c,
    cpl: ratio(c.spend, c.leads),
    leadToBooked: ratio(c.booked, c.leads),
    showRate: ratio(c.sat, c.scheduled),
    dsToMember: ratio(c.members, c.sat),
    cac: ratio(c.spend, c.members),
    memberToEoi: ratio(c.eoiClients, c.members),
    ucCac: ratio(c.spend, c.uc),
  };
}
function add(a: Counts, b: Counts): Counts {
  const out = zero();
  for (const k of Object.keys(out) as (keyof Counts)[]) out[k] = a[k] + b[k];
  return out;
}

export function cohortMonthKeys(fromKey = COHORT_START_MONTH): string[] {
  const cur = parseLeadMonth(null);
  const [fy, fm] = fromKey.split("-").map(Number);
  const out: string[] = [];
  let y = fy, m = fm;
  while (y < cur.year || (y === cur.year && m <= cur.month)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

export function maturingDaysLeft(endIso: string, now = Date.now()): number {
  const end = Date.parse(endIso);
  if (!Number.isFinite(end)) return 0;
  const since = Math.floor((now - end) / 86400000);
  return since >= MATURITY_DAYS ? 0 : Math.min(MATURITY_DAYS, MATURITY_DAYS - Math.max(0, since));
}

// UC milestone: same rule as the Contracts tab (stage UC or settlement
// pipeline), date by UC-entered then close/create date.
export function ucMilestoneMs(p: Record<string, any>): number {
  const stage = p.dealstage || "";
  if (stage === CONTRACT_EOI_REFUND_STAGE) return NaN;
  const reached = stage === CONTRACT_UC_STAGE || CONTRACT_UC_PIPELINES.includes(p.pipeline || "");
  if (!reached) return NaN;
  for (const v of [p[`hs_v2_date_entered_${CONTRACT_UC_STAGE}`], p.closedate, p.createdate]) {
    const t = Date.parse(v || "");
    if (Number.isFinite(t)) return t;
  }
  return NaN;
}

interface Lead {
  id: string;
  channel: Channel;
  month: string;
  createdMs: number;
  name: string;
}

async function cohortContacts(c: CohortRange): Promise<any[]> {
  const range = [
    { propertyName: "createdate", operator: "GTE", value: c.start },
    { propertyName: "createdate", operator: "LT", value: c.end },
  ];
  const rows = await hubspot.searchObjects("contacts", {
    filterGroups: [
      { filters: [...range, { propertyName: "hs_analytics_source", operator: "EQ", value: "PAID_SOCIAL" }] },
      { filters: [...range, { propertyName: "lead_source", operator: "EQ", value: "EMBR" }] },
      { filters: [...range, { propertyName: "embr_lead_id", operator: "HAS_PROPERTY" }] },
    ],
    properties: [...BOOKING_SOURCE_PROPS, "createdate", "firstname", "lastname", "email"],
    sorts: [{ propertyName: "createdate", direction: "ASCENDING" }],
  }, 10000);
  if (rows.length >= 9900) throw new Error(`${c.label} lead search reached HubSpot's limit; refusing to report a partial cohort.`);
  return rows;
}

async function metaSpendFor(c: CohortRange) {
  try {
    const m: any = await metaAds({ key: "custom", label: c.label, start: c.start, end: c.end });
    if (m?.status === "ok" && m?.totals?.spend != null) return { spend: Number(m.totals.spend) || 0, status: "ok" as const };
    return { spend: 0, status: "error" as const, message: m?.message || "Meta spend unavailable" };
  } catch (e: any) {
    return { spend: 0, status: "error" as const, message: e?.message || "Meta spend unavailable" };
  }
}

async function mapLimit<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

// The shared HubSpot batch helpers drop a chunk (rather than fail) after
// repeated 429/5xx responses. For a cohort table a silently dropped chunk would
// understate whole months, so: re-run association lookups until no new keys
// appear (successful chunks come straight from the response cache), and retry
// missing batch reads, refusing to publish if records are still missing.
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function associationsComplete(from: string, to: string, ids: string[]) {
  let out: Record<string, string[]> = {};
  for (let pass = 0; pass < 3; pass++) {
    if (pass > 0) await pause(pass * 8000); // let HubSpot's 10-second burst window reset
    const r = await hubspot.batchAssociations(from, to, ids);
    const before = Object.keys(out).length;
    out = { ...out, ...r };
    if (pass > 0 && Object.keys(out).length === before) break;
  }
  return out;
}

async function readComplete(objectType: string, ids: string[], props: string[]) {
  const out: Record<string, Record<string, any>> = {};
  let missing = ids;
  for (let pass = 0; pass < 4 && missing.length; pass++) {
    if (pass > 0) await pause(pass * 8000);
    Object.assign(out, await hubspot.batchRead(objectType, missing, props));
    missing = ids.filter((id) => !out[id]);
  }
  // Deleted/merged records can legitimately vanish; anything more is an outage.
  if (missing.length > Math.max(5, ids.length * 0.005)) {
    throw new Error(`HubSpot ${objectType} lookup incomplete (${missing.length} of ${ids.length} missing); keeping the previous cohort table.`);
  }
  return out;
}

export async function marketingNew(now = Date.now()): Promise<MarketingNewPayload> {
  const monthKeys = cohortMonthKeys();
  const cohorts = monthKeys.map((k) => parseLeadMonth(k));

  // 1. Leads + Meta spend per month.
  const [contactSets, spends] = await Promise.all([
    mapLimit(cohorts, 3, cohortContacts),
    mapLimit(cohorts, 3, metaSpendFor),
  ]);
  const leads = new Map<string, Lead>();
  cohorts.forEach((c, i) => {
    const key = monthKeys[i];
    for (const r of contactSets[i]) {
      const channel = bookingSourceOf(r.properties);
      if (!channel || leads.has(r.id)) continue;
      const p = r.properties || {};
      leads.set(String(r.id), {
        id: String(r.id), channel, month: key,
        createdMs: Date.parse(p.createdate || c.start),
        name: `${p.firstname || ""} ${p.lastname || ""}`.trim() || p.email || "—",
      });
    }
  });
  const leadIds = Array.from(leads.keys());

  // 2. Associations + records.
  // Sequential on purpose: parallel fan-out trips HubSpot's burst limit.
  const contactDeals = await associationsComplete("contacts", "deals", leadIds);
  const contactMeetings = await associationsComplete("contacts", "meetings", leadIds);
  const meetingIds = Array.from(new Set(Object.values(contactMeetings).flat()));
  const meetingProps = meetingIds.length
    ? await readComplete("meetings", meetingIds, ["hs_meeting_title", "hs_meeting_start_time", "hs_meeting_end_time", "hs_createdate"])
    : {};
  const dsMeetingIds = meetingIds.filter((id) => (meetingProps[id]?.hs_meeting_title || "").startsWith(DS_TITLE_PREFIX));
  const meetingDeals = dsMeetingIds.length ? await associationsComplete("meetings", "deals", dsMeetingIds) : {};
  const dealIds = Array.from(new Set([...Object.values(contactDeals).flat(), ...Object.values(meetingDeals).flat()]));
  const dealProps: Record<string, Record<string, any>> = dealIds.length
    ? await readComplete("deals", dealIds, DEAL_PROPS) : {};

  // Meeting → cohort contacts (reverse of the contact side).
  const meetingContacts: Record<string, string[]> = {};
  for (const [cid, mids] of Object.entries(contactMeetings)) {
    for (const mid of mids) (meetingContacts[mid] ||= []).push(cid);
  }

  // 3. Funnel per lead: booked / scheduled / sat.
  const dsMeetings = dsMeetingIds.map((id) => ({ id, properties: meetingProps[id] || {} }));
  const resolvedMeetingDeals = recoverMembershipAssociations(dsMeetings, meetingDeals, meetingContacts, contactDeals, dealProps);
  const attendance = new Map<string, string>();
  for (const m of dsMeetings) attendance.set(m.id, classifyAttendance(m, resolvedMeetingDeals[m.id] || [], dealProps, now).status);

  const funnel = new Map<string, { booked: boolean; scheduled: boolean; sat: boolean }>();
  for (const lead of Array.from(leads.values())) {
    let booked = false, scheduled = false, sat = false;
    for (const mid of contactMeetings[lead.id] || []) {
      const st = attendance.get(mid);
      if (!st) continue; // not a DS meeting
      booked = true;
      if (st !== "upcoming") scheduled = true;
      if (st === "sat") sat = true;
    }
    for (const did of contactDeals[lead.id] || []) {
      const p = dealProps[did] || {};
      const stage = p.dealstage || "";
      const hadStage = (ids: Iterable<string>) => Array.from(ids).some((s) => stage === s || !!p[`hs_v2_date_entered_${s}`]);
      if (hadStage(DS_STAGE_BOOKED)) booked = true;
      if (hadStage(DS_STAGE_SAT) || hasReviewedSat(did, now)) { booked = scheduled = sat = true; }
    }
    funnel.set(lead.id, { booked, scheduled, sat });
  }

  // 4. Credit every deal once, to the earliest-created cohort lead.
  const dealOwner = new Map<string, Lead>();
  for (const lead of Array.from(leads.values()).sort((a, b) => a.createdMs - b.createdMs)) {
    for (const did of contactDeals[lead.id] || []) if (!dealOwner.has(did)) dealOwner.set(did, lead);
  }

  // Members: gross, linked opportunities resolved to one canonical membership.
  const memberCandidates = Array.from(dealOwner.keys())
    .filter((id) => dealProps[id] && grossMembershipEligible(dealProps[id]))
    .map((id) => ({ id, properties: dealProps[id] }));
  let canonical = memberCandidates;
  let resolvedFrom: Record<string, string> = {};
  try {
    const r = await resolveLinkedMembershipDeals(memberCandidates);
    canonical = r.deals;
    resolvedFrom = r.resolvedFrom;
  } catch (e) {
    console.warn("[marketing-new] linked membership resolution failed; using direct deals", e);
  }
  // Map each canonical membership back to the cohort lead that reached it.
  const memberLead = new Map<string, Lead>();
  for (const src of memberCandidates) {
    const target = resolvedFrom[src.id] || src.id;
    const lead = dealOwner.get(src.id)!;
    const prev = memberLead.get(target);
    if (!prev || lead.createdMs < prev.createdMs) memberLead.set(target, lead);
  }
  const canonicalProps = new Map(canonical.map((d) => [d.id, d.properties]));

  // 5. Roll up.
  const byMonth = new Map<string, { META: Counts; EMBR: Counts; outcomes: CohortOutcome[]; propertyDeals: CohortPropertyDeal[] }>();
  for (const k of monthKeys) byMonth.set(k, { META: zero(), EMBR: zero(), outcomes: [], propertyDeals: [] });
  for (const lead of Array.from(leads.values())) {
    const b = byMonth.get(lead.month)![lead.channel];
    const f = funnel.get(lead.id)!;
    b.leads++;
    if (f.booked) b.booked++;
    if (f.scheduled) b.scheduled++;
    if (f.sat) b.sat++;
  }
  const outcome = (lead: Lead, type: CohortOutcome["type"], dealId: string, p: Record<string, any>, ms: number, refunded?: boolean): CohortOutcome => ({
    type, channel: lead.channel, client: lead.name,
    contactUrl: `${HS}/0-1/${lead.id}`,
    dealName: p.dealname || dealId,
    dealUrl: `${HS}/0-3/${dealId}`,
    date: Number.isFinite(ms) ? new Date(ms).toISOString() : undefined,
    daysFromLead: Number.isFinite(ms) && ms >= lead.createdMs ? Math.round((ms - lead.createdMs) / 86400000) : undefined,
    refunded,
  });
  for (const [dealId, lead] of Array.from(memberLead.entries())) {
    const p = canonicalProps.get(dealId) || dealProps[dealId];
    if (!p || !grossMembershipEligible(p)) continue;
    const m = byMonth.get(lead.month)!;
    m[lead.channel].members++;
    m.outcomes.push(outcome(lead, "member", dealId, p, membershipSaleMs(p),
      p.dealstage === MEMBERSHIP_REFUND_STAGE || !!p[`hs_v2_date_entered_${MEMBERSHIP_REFUND_STAGE}`]));
  }
  const eoiClients = new Map<string, Set<string>>(); // `${month}:${channel}` -> contact ids
  for (const [dealId, lead] of Array.from(dealOwner.entries())) {
    const p = dealProps[dealId];
    if (!p || !PROPERTY_PIPELINES.has(p.pipeline || "") || isEoiTestRecord(p)) continue;
    if (MEMBERSHIP_PIPELINES.has(p.pipeline || "")) continue;
    const m = byMonth.get(lead.month)!;
    const eoiMs = eoiMilestoneMs(p);
    if (Number.isFinite(eoiMs)) {
      m[lead.channel].eoiDeals++;
      const key = `${lead.month}:${lead.channel}`;
      (eoiClients.get(key) || eoiClients.set(key, new Set()).get(key)!).add(lead.id);
      m.outcomes.push(outcome(lead, "eoi", dealId, p, eoiMs, p.dealstage === CONTRACT_EOI_REFUND_STAGE));
    }
    const ucMs = ucMilestoneMs(p);
    if (Number.isFinite(ucMs)) {
      m[lead.channel].uc++;
      m.outcomes.push(outcome(lead, "uc", dealId, p, ucMs));
    }
    if (Number.isFinite(eoiMs) || Number.isFinite(ucMs)) {
      const iso = (t: number) => (Number.isFinite(t) ? new Date(t).toISOString() : undefined);
      const days = (a: number, b: number) =>
        Number.isFinite(a) && Number.isFinite(b) && b >= a ? Math.round((b - a) / 86400000) : undefined;
      const amt = Number(p.amount_in_home_currency || p.amount);
      m.propertyDeals.push({
        dealId, dealName: p.dealname || dealId, dealUrl: `${HS}/0-3/${dealId}`,
        client: lead.name, contactUrl: `${HS}/0-1/${lead.id}`, channel: lead.channel,
        stage: stageName(p.dealstage), pipeline: pipelineName(p.pipeline),
        strategist: p.strategist ? ownerName(p.strategist) : undefined,
        amount: Number.isFinite(amt) && amt > 0 ? amt : null,
        status: Number.isFinite(ucMs) ? "uc" : p.dealstage === CONTRACT_EOI_REFUND_STAGE ? "cancelled" : "open",
        eoiDate: iso(eoiMs), ucDate: iso(ucMs),
        daysLeadToEoi: days(lead.createdMs, eoiMs),
        daysEoiToUc: days(eoiMs, ucMs),
      });
    }
  }

  const months: CohortMonth[] = cohorts.map((c, i) => {
    const key = monthKeys[i];
    const m = byMonth.get(key)!;
    m.META.spend = spends[i].spend;
    m.EMBR.spend = m.EMBR.leads * EMBR_CPL;
    m.META.eoiClients = eoiClients.get(`${key}:META`)?.size || 0;
    m.EMBR.eoiClients = eoiClients.get(`${key}:EMBR`)?.size || 0;
    const order = { member: 0, eoi: 1, uc: 2 } as const;
    m.outcomes.sort((a, b) => order[a.type] - order[b.type] || (a.date || "").localeCompare(b.date || ""));
    return {
      month: key, label: c.label, start: c.start, end: c.end,
      maturingDaysLeft: maturingDaysLeft(c.end, now),
      metaSpendStatus: spends[i].status,
      metaSpendMessage: (spends[i] as any).message,
      meta: finalizeCohort(m.META),
      embr: finalizeCohort(m.EMBR),
      total: finalizeCohort(add(m.META, m.EMBR)),
      outcomes: m.outcomes,
      propertyDeals: m.propertyDeals.sort((a, b) =>
        (a.eoiDate || a.ucDate || "").localeCompare(b.eoiDate || b.ucDate || "")),
    };
  });

  let tm = zero(), te = zero();
  for (const k of monthKeys) { tm = add(tm, byMonth.get(k)!.META); te = add(te, byMonth.get(k)!.EMBR); }
  return {
    ok: true,
    generatedAt: new Date(now).toISOString(),
    embrCpl: EMBR_CPL,
    months: months.reverse(), // newest first
    totals: { meta: finalizeCohort(tm), embr: finalizeCohort(te), total: finalizeCohort(add(tm, te)) },
  };
}
