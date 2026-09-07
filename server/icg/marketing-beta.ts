// Marketing BETA — lead-cohort CAC.
//
// The existing Marketing tab reports CAC as (spend in period) ÷ (members
// closed in period). That mixes cohorts: leads generated in the period are
// (mostly) NOT the members counted in the same period, because most members
// convert 7–60+ days after their lead was created. A strong prior month
// therefore inflates the current month's apparent efficiency, and vice versa.
//
// Marketing BETA reports the true cohort:
//   - pick a LEAD MONTH (e.g. August 2026)
//   - count the leads created in that Melbourne-local calendar month
//   - follow those exact leads FORWARD through HubSpot associations, for all
//     time, and count how many became a paying member
//   - report CAC = spend on that month's leads ÷ members from that cohort
//
// Spend rules (per Ben):
//   - Meta: actual invoiced Meta spend within the lead month (via the same
//     `metaAds(range)` used elsewhere)
//   - EMBR: $154 per EMBR lead in the cohort (contractual per-lead rate)
//
// Lead classification (per the existing dashboard rules):
//   - EMBR   = contact created in month with `lead_source = 'EMBR'`
//   - Meta   = every other contact created in month (paid-social default)
// (Direct, Referral, Organic etc. are already excluded from HubSpot lead
// creation for paid-source contacts; the same rule is used in
// `leadBookingByChannel` and the Overview `Total leads` card.)

import { hubspot } from "./hubspot";
import { metaAds } from "./meta";
import {
  DISCOVERY_BOOKED_STAGE,
  DS_SAT_STAGES,
  MEMBERSHIP_SOLD_STAGES,
} from "./reference";

// $154 per EMBR lead, contractual. Matches EMBR_CPL used elsewhere.
const EMBR_CPL = 154;

// Melbourne wall-clock helpers. All month boundaries are Melbourne local
// midnight -> UTC, so a "lead month" matches the dashboard's other windows.
const MEL_OFFSET_MS = 10 * 60 * 60 * 1000;
function melMidnightUtcIso(y: number, m: number, d: number): string {
  return new Date(Date.UTC(y, m, d, 0, 0, 0) - MEL_OFFSET_MS).toISOString();
}

export interface CohortRange {
  year: number;
  month: number; // 1..12
  label: string; // e.g. "August 2026"
  start: string; // UTC ISO, inclusive
  end: string; // UTC ISO, exclusive
}

// Build a Melbourne-local calendar month range from a `YYYY-MM` string.
export function parseLeadMonth(raw?: string | null): CohortRange {
  const now = new Date(Date.now() + MEL_OFFSET_MS);
  let y = now.getUTCFullYear();
  let m = now.getUTCMonth(); // 0-based
  if (raw) {
    const m2 = /^(\d{4})-(\d{1,2})$/.exec(raw);
    if (m2) {
      y = Number(m2[1]);
      m = Math.min(11, Math.max(0, Number(m2[2]) - 1));
    }
  }
  const start = melMidnightUtcIso(y, m, 1);
  const end = melMidnightUtcIso(y, m + 1, 1);
  const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return { year: y, month: m + 1, label: `${MONTHS[m]} ${y}`, start, end };
}

// Stages that indicate the lead ever reached a booked DS. Same set used in
// `leadBookingByChannel` — a booking counts whether the client showed up or not.
const DS_BOOKED_ANY_STAGES = new Set<string>([
  DISCOVERY_BOOKED_STAGE, // Discovery Session Booked
  "2868125118", // DS No Show / To Reschedule (booked but no-show)
  ...DS_SAT_STAGES, // any DS Sat - … stage (booked and sat)
]);
const DS_SAT_STAGE_SET = new Set<string>(DS_SAT_STAGES);
const MEMBER_STAGE_SET = new Set<string>(MEMBERSHIP_SOLD_STAGES);

type Channel = "META" | "EMBR";

interface CohortLeadRow {
  contactId: string;
  channel: Channel;
  name?: string;
  createdAt: string; // ISO
  booked: boolean;
  sat: boolean;
  member: boolean;
  memberDate?: string; // membership_paid_date if the member converted
  daysToMember?: number;
}

export interface MarketingBetaChannelStats {
  channel: Channel | "TOTAL";
  leads: number;
  booked: number;
  sat: number;
  members: number;
  spend: number;
  cpl: number;
  costPerBooking: number;
  costPerSat: number;
  cac: number; // spend / members
  bookRate: number; // booked / leads
  sitRate: number; // sat / booked
  conversionRate: number; // members / sat
  overallConversion: number; // members / leads
}

export interface MarketingBetaPayload {
  ok: true;
  cohort: CohortRange;
  generatedAt: string;
  meta: MarketingBetaChannelStats;
  embr: MarketingBetaChannelStats;
  total: MarketingBetaChannelStats;
  metaSpendStatus: "ok" | "error";
  metaSpendMessage?: string;
  // Per-lead journey for the drill-down table. Ordered by created date desc.
  leads: CohortLeadRow[];
  // Cumulative member conversion of the cohort by days-since-lead. Buckets
  // are the standard 7/14/30/60/90/180/365 windows plus lifetime. Recent
  // months naturally have fewer buckets filled — the UI uses this to show a
  // maturity indicator so a young cohort is not misread as a bad one.
  maturity: Array<{ days: number | null; members: number; label: string }>;
}

export interface MarketingBetaError {
  ok: false;
  cohort: CohortRange;
  error: string;
}

function emptyStats(channel: Channel | "TOTAL"): MarketingBetaChannelStats {
  return {
    channel,
    leads: 0,
    booked: 0,
    sat: 0,
    members: 0,
    spend: 0,
    cpl: 0,
    costPerBooking: 0,
    costPerSat: 0,
    cac: 0,
    bookRate: 0,
    sitRate: 0,
    conversionRate: 0,
    overallConversion: 0,
  };
}

function finalize(s: MarketingBetaChannelStats): MarketingBetaChannelStats {
  s.cpl = s.leads > 0 ? s.spend / s.leads : 0;
  s.costPerBooking = s.booked > 0 ? s.spend / s.booked : 0;
  s.costPerSat = s.sat > 0 ? s.spend / s.sat : 0;
  s.cac = s.members > 0 ? s.spend / s.members : 0;
  s.bookRate = s.leads > 0 ? s.booked / s.leads : 0;
  s.sitRate = s.booked > 0 ? s.sat / s.booked : 0;
  s.conversionRate = s.sat > 0 ? s.members / s.sat : 0;
  s.overallConversion = s.leads > 0 ? s.members / s.leads : 0;
  return s;
}

// Build the payload for the selected lead month.
export async function marketingBeta(
  cohort: CohortRange,
): Promise<MarketingBetaPayload | MarketingBetaError> {
  try {
    // 1. Every HubSpot contact created in the lead month, with lead_source and
    //    name for the drill-down table.
    const contacts = await hubspot.searchObjects(
      "contacts",
      {
        filterGroups: [
          {
            filters: [
              { propertyName: "createdate", operator: "GTE", value: cohort.start },
              { propertyName: "createdate", operator: "LT", value: cohort.end },
            ],
          },
        ],
        properties: ["lead_source", "createdate", "firstname", "lastname", "email"],
      },
      10000,
    );

    // Split by channel. EMBR = explicit tag; Meta = every other contact
    // created in the paid-lead flow. This matches the rule used by the
    // Overview `Total leads` card and `leadBookingByChannel`.
    const channelOf: Record<string, Channel> = {};
    const metaOf: Record<string, {
      name: string;
      createdAt: string;
    }> = {};
    for (const c of contacts) {
      const src = c.properties.lead_source === "EMBR" ? "EMBR" : "META";
      channelOf[c.id] = src;
      const first = c.properties.firstname || "";
      const last = c.properties.lastname || "";
      const name = `${first} ${last}`.trim() || c.properties.email || "—";
      metaOf[c.id] = { name, createdAt: c.properties.createdate || cohort.start };
    }
    const contactIds = Object.keys(channelOf);

    // 2. Follow every cohort contact forward through their associated deals,
    //    for all time. Read dealstage + membership_paid_date so we know
    //    whether the lead ever booked, sat, or became a paid member — and
    //    when the membership actually closed (for maturity buckets).
    const assoc = await hubspot.batchAssociations("contacts", "deals", contactIds);
    const allDealIds = Array.from(new Set(Object.values(assoc).flat()));
    const dealProps = allDealIds.length
      ? await hubspot.batchRead("deals", allDealIds, [
          "dealstage",
          "membership_paid_date",
          "closedate",
        ])
      : {};

    // 3. Per-contact rollup — take the "best" outcome across ALL associated
    //    deals (member > sat > booked). Store the membership date and days
    //    since lead creation so the maturity chart can bucket cohorts.
    const leadRows: CohortLeadRow[] = contactIds.map((cid) => {
      const deals = assoc[cid] || [];
      let booked = false;
      let sat = false;
      let member = false;
      let memberDate: string | undefined;
      for (const did of deals) {
        const stage = dealProps[did]?.dealstage || "";
        if (DS_BOOKED_ANY_STAGES.has(stage)) booked = true;
        if (DS_SAT_STAGE_SET.has(stage)) sat = true;
        if (MEMBER_STAGE_SET.has(stage)) {
          member = true;
          const paid =
            dealProps[did]?.membership_paid_date || dealProps[did]?.closedate;
          if (paid && (!memberDate || paid < memberDate)) memberDate = paid;
        }
      }
      // A sat implies booked; a member on this pipeline almost always sat.
      if (sat) booked = true;
      let daysToMember: number | undefined;
      if (member && memberDate && metaOf[cid]?.createdAt) {
        const t0 = Date.parse(metaOf[cid].createdAt);
        const t1 = Date.parse(memberDate);
        if (!isNaN(t0) && !isNaN(t1) && t1 >= t0) {
          daysToMember = Math.max(0, Math.round((t1 - t0) / 86400000));
        }
      }
      return {
        contactId: cid,
        channel: channelOf[cid],
        name: metaOf[cid]?.name,
        createdAt: metaOf[cid]?.createdAt || cohort.start,
        booked,
        sat,
        member,
        memberDate,
        daysToMember,
      };
    });

    // 4. Spend for the lead month.
    //    - Meta: actual invoiced spend across the calendar month (via Graph)
    //    - EMBR: $154 × EMBR leads in the cohort (contractual per-lead rate)
    const metaRange = {
      key: "custom" as const,
      label: cohort.label,
      start: cohort.start,
      end: cohort.end,
    };
    let metaSpend = 0;
    let metaSpendStatus: "ok" | "error" = "ok";
    let metaSpendMessage: string | undefined;
    try {
      const m = (await metaAds(metaRange)) as any;
      if (m?.status === "ok" && m?.totals?.spend != null) {
        metaSpend = Number(m.totals.spend) || 0;
      } else {
        metaSpendStatus = "error";
        metaSpendMessage = m?.message || "Meta spend unavailable";
      }
    } catch (e: any) {
      metaSpendStatus = "error";
      metaSpendMessage = e?.message || "Meta spend unavailable";
    }

    // 5. Roll rows up into per-channel + total stats.
    const meta = emptyStats("META");
    const embr = emptyStats("EMBR");
    for (const r of leadRows) {
      const bucket = r.channel === "EMBR" ? embr : meta;
      bucket.leads++;
      if (r.booked) bucket.booked++;
      if (r.sat) bucket.sat++;
      if (r.member) bucket.members++;
    }
    embr.spend = embr.leads * EMBR_CPL;
    meta.spend = metaSpend;

    const total = emptyStats("TOTAL");
    total.leads = meta.leads + embr.leads;
    total.booked = meta.booked + embr.booked;
    total.sat = meta.sat + embr.sat;
    total.members = meta.members + embr.members;
    total.spend = meta.spend + embr.spend;

    finalize(meta);
    finalize(embr);
    finalize(total);

    // 6. Maturity buckets: cumulative members reached by N days after lead
    //    creation. Useful for spotting when a young cohort is still maturing.
    const bucketDays = [7, 14, 30, 60, 90, 180, 365];
    const maturity = bucketDays.map((d) => ({
      days: d as number | null,
      label: `${d}d`,
      members: leadRows.filter(
        (r) => r.member && r.daysToMember != null && r.daysToMember <= d,
      ).length,
    }));
    maturity.push({
      days: null,
      label: "All-time",
      members: leadRows.filter((r) => r.member).length,
    });

    // Sort drill-down: members first, then sat, then booked, then by created.
    leadRows.sort((a, b) => {
      const rank = (r: CohortLeadRow) =>
        r.member ? 3 : r.sat ? 2 : r.booked ? 1 : 0;
      const dr = rank(b) - rank(a);
      if (dr !== 0) return dr;
      return (b.createdAt || "").localeCompare(a.createdAt || "");
    });

    return {
      ok: true,
      cohort,
      generatedAt: new Date().toISOString(),
      meta,
      embr,
      total,
      metaSpendStatus,
      metaSpendMessage,
      leads: leadRows,
      maturity,
    };
  } catch (err: any) {
    return {
      ok: false,
      cohort,
      error: err?.message || "Failed to build marketing cohort",
    };
  }
}
