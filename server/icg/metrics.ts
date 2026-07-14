// Aggregation logic that turns raw HubSpot deals into the dashboard's four sections.
import { hubspot } from "./hubspot";
import { PeriodRange, parsePeriod } from "./period";
import {
  ownerName,
  pipelineName,
  stageName,
  PIPELINES,
  MEMBERSHIP_STAGES,
  MEMBERSHIP_SOLD_STAGES,
  DISCOVERY_BOOKED_STAGE,
  DS_SAT_STAGES,
  BOOKING_CONSULTANTS,
  isBookingConsultant,
  DS_TITLE_PREFIX,
  MEMBERSHIP_SOLD_TIERS,
  CONTRACT_PIPELINE,
  CONTRACT_FUNNEL_STEPS,
  CONTRACT_UC_PIPELINES,
  CONTRACT_EXCLUDE_STAGES,
  CONTRACT_STAGE_TO_STEP,
  CONTRACT_EOI_STAGES,
  CONTRACT_UC_STAGE,
  isStrategistOwner,
  STRATEGIST_OWNERS,
  STRATEGIST_NAME_TOKENS,
} from "./reference";

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// Australia/Melbourne is UTC+10 with no DST in this data model. aestDay() returns
// the local calendar day (yyyy-mm-dd) for an ISO timestamp, so we can compare a
// membership sale's close date to the client's DS session day "same day" in AEST.
const AEST_OFFSET_MS = 10 * 60 * 60 * 1000;
function aestDay(iso?: string | null): string | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  if (isNaN(t)) return undefined;
  return new Date(t + AEST_OFFSET_MS).toISOString().slice(0, 10);
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

  // ---- Lead sources: META vs EMBR only --------------------------------------
  // ICG has exactly two lead channels: Meta (paid social ads) and EMBR (a
  // fixed-rate lead provider). Leads are HubSpot CONTACTS. EMBR leads are
  // tagged lead_source='EMBR'; every other contact created in the period is a
  // Meta lead. We deliberately do NOT surface HubSpot's raw analytics buckets
  // (Offline / Direct Traffic / Unknown) — only the two real channels.
  const [contactsInPeriod, embrInPeriod] = await Promise.all([
    hubspot.countContacts([
      {
        filters: [
          { propertyName: "createdate", operator: "GTE", value: range.start },
          { propertyName: "createdate", operator: "LT", value: range.end },
        ],
      },
    ]),
    hubspot.countContacts([
      {
        filters: [
          { propertyName: "lead_source", operator: "EQ", value: "EMBR" },
          { propertyName: "createdate", operator: "GTE", value: range.start },
          { propertyName: "createdate", operator: "LT", value: range.end },
        ],
      },
    ]),
  ]);
  const metaLeadCount = Math.max(0, contactsInPeriod - embrInPeriod);
  const sources = [
    { name: "META", count: metaLeadCount },
    { name: "EMBR", count: embrInPeriod },
  ].sort((a, b) => b.count - a.count);

  // Lead volume per day for last 30 days (trend) — still deal-based for the
  // sparkline shape.
  const recent = await hubspot.searchDeals(
    {
      filterGroups: [
        { filters: [{ propertyName: "createdate", operator: "GTE", value: isoDaysAgo(30) }] },
      ],
      properties: ["createdate"],
      sorts: [{ propertyName: "createdate", direction: "DESCENDING" }],
    },
    1000,
  );
  const byDay: Record<string, number> = {};
  for (let i = 29; i >= 0; i--) byDay[isoDaysAgo(i)] = 0;
  for (const d of recent) {
    const day = (d.properties.createdate || "").slice(0, 10);
    if (day in byDay) byDay[day]++;
  }
  const trend = Object.entries(byDay).map(([date, count]) => ({ date, count }));

  // ---- Cohort booking rate by channel --------------------------------------
  // Of the leads (HubSpot contacts) CREATED in the selected period, how many
  // eventually BOOKED a Discovery Session, split by channel (EMBR vs Meta).
  // This is a cohort measure (per Ben): we track the exact leads created in the
  // window and check whether each one ever reached a DS-booking deal stage,
  // regardless of when the booking happened. It differs from the sales-funnel
  // "DS booked" (which counts DS meetings CREATED in the window, including ones
  // for leads generated earlier) — this answers "of the leads we generated this
  // period, what % have we booked in?".
  const leadBooking = await leadBookingByChannel(range);

  return {
    newLeads7: last7,
    newLeads30: last30,
    newLeads90: last90,
    totalDeals: total,
    periodLeads,
    sources,
    trend,
    sampleSize: recent.length,
    leadBooking,
  };
}

// A lead "booked a DS" if any associated deal reached DS Booked, DS No Show /
// To Reschedule (they DID book, just didn't show), or any DS Sat stage.
const DS_BOOKING_STAGES = new Set<string>([
  DISCOVERY_BOOKED_STAGE, // Discovery Session Booked
  "2868125118", // DS No Show / To Reschedule (booked but no-show)
  ...DS_SAT_STAGES, // any DS Sat - … stage (booked and sat)
]);

type ChannelBooking = { leads: number; booked: number; bookRate: number };

async function leadBookingByChannel(
  range: PeriodRange,
): Promise<{ ok: boolean; meta: ChannelBooking; embr: ChannelBooking; total: ChannelBooking }> {
  const zero = (): ChannelBooking => ({ leads: 0, booked: 0, bookRate: 0 });
  const rate = (b: ChannelBooking): ChannelBooking => ({
    ...b,
    bookRate: b.leads > 0 ? b.booked / b.leads : 0,
  });
  try {
    // 1. All contacts created in the period, with lead_source.
    const contacts = await hubspot.searchObjects(
      "contacts",
      {
        filterGroups: [
          {
            filters: [
              { propertyName: "createdate", operator: "GTE", value: range.start },
              { propertyName: "createdate", operator: "LT", value: range.end },
            ],
          },
        ],
        properties: ["lead_source"],
      },
      5000,
    );
    const channelOf: Record<string, "EMBR" | "META"> = {};
    for (const c of contacts) {
      channelOf[c.id] = c.properties.lead_source === "EMBR" ? "EMBR" : "META";
    }
    const ids = Object.keys(channelOf);

    // 2. Associated deals per contact, then those deals' stages.
    const assoc = await hubspot.batchAssociations("contacts", "deals", ids);
    const allDeals = Array.from(
      new Set(Object.values(assoc).flat()),
    );
    const dealProps = await hubspot.batchRead("deals", allDeals, ["dealstage"]);

    // 3. Tally per channel.
    const meta = zero();
    const embr = zero();
    for (const id of ids) {
      const bucket = channelOf[id] === "EMBR" ? embr : meta;
      bucket.leads++;
      const deals = assoc[id] || [];
      const booked = deals.some((d) =>
        DS_BOOKING_STAGES.has(dealProps[d]?.dealstage || ""),
      );
      if (booked) bucket.booked++;
    }
    const total: ChannelBooking = {
      leads: meta.leads + embr.leads,
      booked: meta.booked + embr.booked,
      bookRate: 0,
    };
    return { ok: true, meta: rate(meta), embr: rate(embr), total: rate(total) };
  } catch (err) {
    return { ok: false, meta: zero(), embr: zero(), total: zero() };
  }
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

// EMBR leads (HubSpot contacts tagged lead_source='EMBR') created within an
// explicit period range, so the figure pivots with the global period selector.
async function embrLeadsInRange(range: PeriodRange): Promise<number> {
  return hubspot.countContacts([
    {
      filters: [
        { propertyName: "lead_source", operator: "EQ", value: "EMBR" },
        { propertyName: "createdate", operator: "GTE", value: range.start },
        { propertyName: "createdate", operator: "LT", value: range.end },
      ],
    },
  ]);
}

async function embr(range: PeriodRange) {
  const win = (leads: number) => ({ leads, spend: leads * EMBR_CPL, cpl: EMBR_CPL });
  try {
    const [leads7, leads30, leads90, leadsTotal, leadsPeriod] = await Promise.all([
      embrLeadsInLastDays(7),
      embrLeadsInLastDays(30),
      embrLeadsInLastDays(90),
      hubspot.countContacts([
        { filters: [{ propertyName: "lead_source", operator: "EQ", value: "EMBR" }] },
      ]),
      embrLeadsInRange(range),
    ]);
    return {
      cpl: EMBR_CPL,
      ok: true,
      last7: win(leads7),
      last30: win(leads30),
      last90: win(leads90),
      total: win(leadsTotal),
      period: win(leadsPeriod),
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
      period: win(0),
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
// sat = DS meeting that started in window, validated via an associated deal
// sitting in any DS Sat-* stage (the meeting outcome field is unreliable and is
// NOT used — see the sat block below for the full rationale).
async function discoverySessions(startIso: string, endIso: string) {
  // Fetch DS meetings that were EITHER created in the window (for `booked`) OR
  // started/held in the window (for `sat`). These two sets overlap heavily but
  // are not identical — a session booked before the window but held inside it
  // must be counted as sat, and a session booked inside the window but held later
  // must be counted as booked. The two filterGroups are OR'd by HubSpot.
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
        {
          filters: [
            { propertyName: "hs_meeting_start_time", operator: "GTE", value: startIso },
            { propertyName: "hs_meeting_start_time", operator: "LT", value: endIso },
          ],
        },
      ],
      properties: [
        "hs_meeting_title",
        "hs_meeting_start_time",
        "hs_meeting_outcome",
        "hs_createdate",
        "hubspot_owner_id",
      ],
      sorts: [{ propertyName: "hs_createdate", direction: "DESCENDING" }],
    },
    3000,
  );

  const isDs = (m: any) =>
    (m.properties.hs_meeting_title || "").startsWith(DS_TITLE_PREFIX);
  const dsMeetings = meetings.filter(isDs);

  // Extract the client name from a DS meeting title, which is formatted as
  // "Inner Circle Group Discovery Session: <CLIENT> With <STRATEGIST> Via Zoom".
  // We take the text between the leading ": " and " With ". Falls back to the
  // trimmed title if the pattern doesn't match.
  const clientFromTitle = (title: string): string => {
    const afterColon = title.slice(DS_TITLE_PREFIX.length).replace(/^:\s*/, "");
    const withIdx = afterColon.search(/\s+With\s+/i);
    return (withIdx >= 0 ? afterColon.slice(0, withIdx) : afterColon).trim() ||
      "(unnamed)";
  };

  // DS meetings CREATED in the window. A rebooked/rescheduled session shows up
  // as MULTIPLE created meetings for the SAME client, so the raw meeting count
  // over-states real bookings. Per Ben, "booked" = UNIQUE Discovery Sessions:
  // if the same person appears 2-3 times that's one session that was
  // rescheduled, and must count ONCE. We dedupe by the associated CONTACT below
  // (once the association data is fetched); a meeting with no associated contact
  // falls back to its own meeting id so it still counts as one unique session.
  const bookedMeetingsRaw = dsMeetings.filter((m) => {
    const c = m.properties.hs_createdate;
    return !!c && c >= startIso && c < endIso;
  });
  // Provisional count = raw meetings; replaced with the contact-deduped count
  // once contactAssoc is available (inside the association block below).
  let booked = bookedMeetingsRaw.length;

  // ---- Per-consultant booking attribution ----------------------------------
  // A DS meeting in HubSpot is OWNED by the strategist who runs the session, not
  // the consultant who booked it. By the time the session is held, the contact &
  // deal have usually been REASSIGNED from the booking consultant to the
  // strategist (and the deal's `booking_consultant` field is often blank). So
  // the current owner is unreliable. We resolve the genuine booker as:
  //   1) the associated deal's `booking_consultant`, IF it is a booking
  //      consultant (not a strategist who happened to be set there); else
  //   2) the EARLIEST owner in the associated contact's owner HISTORY that is a
  //      booking consultant (i.e. who held the lead before the strategist).
  // If neither yields a consultant, the booking was made directly into a
  // strategist's calendar (or is a test); we mark it "Unattributed" so a
  // strategist never appears in the consultant table. This makes the
  // per-consultant DS-booked column reconcile with the headline `booked` total
  // (consultant bookings + Unattributed strategist-direct = booked).
  const bookedByConsultant: Record<string, number> = {};
  const satByConsultant: Record<string, number> = {};
  // Per-consultant CLIENT-LEVEL lists (for the drill-down section on the
  // Consultants page). bookingsByConsultant = the unique DS each consultant
  // booked in the window (client name + created date). satsByConsultant = the
  // clients from their bookings who actually sat in the window (client name +
  // held date). Both use the SAME booker resolution + dedupe as the counts, so
  // list lengths equal bookedByConsultant / satByConsultant.
  type BookingItem = { client: string; date: string };
  type SatItem = { client: string; date: string };
  const bookingsByConsultant: Record<string, BookingItem[]> = {};
  const satsByConsultant: Record<string, SatItem[]> = {};
  // ---- Per-STRATEGIST DS attribution (meeting owner = strategist who runs it)
  // A DS meeting in HubSpot is OWNED by the strategist who runs the session, so
  // the meeting's hubspot_owner_id IS the strategist. This gives the strategist-
  // side "DS booked for you / DS you sat" (the mirror of the consultant view,
  // which credits the booker). Booked = meetings created in window by strategist
  // owner; sat = unique sat deals whose session was held in window, credited to
  // that session's strategist owner. Only genuine strategist owners are counted.
  const bookedByStrategist: Record<string, number> = {};
  const satByStrategist: Record<string, number> = {};
  // dsDayByContact/Deal: earliest DS session DAY (AEST yyyy-mm-dd) per associated
  // deal, used later to classify membership sales as on-session (sold same day)
  // vs follow-up. Keyed by deal id. Populated from started-in-window meetings.
  const dsDayByDeal: Record<string, string> = {};
  const strategistByMeeting: Record<string, string | undefined> = {};
  for (const m of dsMeetings) {
    const oid = m.properties.hubspot_owner_id;
    strategistByMeeting[m.id] = isStrategistOwner(oid) ? ownerName(oid) : undefined;
  }
  // Map each DS meeting id -> associated deal ids, and each deal id -> its stage.
  // Shared by booking attribution AND the sat calc below (sat is validated from
  // the associated deal's pipeline stage, so we need these regardless).
  let dealAssoc: Record<string, string[]> = {};
  let dealProps: Record<string, any> = {};
  // resolveBooker maps a DS meeting to the consultant who genuinely booked it
  // (or "Unattributed"). Populated once the association data is fetched; used by
  // BOTH the per-consultant booked attribution and the per-consultant sat
  // attribution so the two columns use an identical booker definition.
  let resolveBooker: (meetingId: string) => string = () => "Unattributed";
  if (dsMeetings.length) {
    const dsIds = dsMeetings.map((m) => m.id);
    const contactAssocPromise = hubspot.batchAssociations("meetings", "contacts", dsIds);
    dealAssoc = await hubspot.batchAssociations("meetings", "deals", dsIds);
    const contactAssoc = await contactAssocPromise;
    const allDealIds = Array.from(new Set(Object.values(dealAssoc).flat()));
    const allContactIds = Array.from(new Set(Object.values(contactAssoc).flat()));
    const [dp, contactHist] = await Promise.all([
      allDealIds.length
        ? hubspot.batchRead("deals", allDealIds, ["booking_consultant", "hubspot_owner_id", "dealstage"])
        : Promise.resolve({} as Record<string, any>),
      allContactIds.length
        ? hubspot.batchReadWithHistory("contacts", allContactIds, ["hubspot_owner_id"])
        : Promise.resolve({} as Record<string, any>),
    ]);
    dealProps = dp;
    // Resolve the genuine booking consultant for a DS meeting:
    //   1) the associated deal's booking_consultant, if a real consultant; else
    //   2) the earliest booking-consultant owner in the contact's owner history;
    //   3) else "Unattributed" (strategist-direct booking or a test) so a
    //      strategist never appears in the consultant table.
    resolveBooker = (meetingId: string): string => {
      let bookerId: string | undefined;
      for (const did of dealAssoc[meetingId] || []) {
        const bc = dealProps[did]?.booking_consultant;
        if (isBookingConsultant(bc)) { bookerId = bc; break; }
      }
      if (!bookerId) {
        let bestTs: string | undefined;
        for (const cid of contactAssoc[meetingId] || []) {
          const hist = contactHist[cid]?.hubspot_owner_id || [];
          for (const h of hist) {
            if (!isBookingConsultant(h.value)) continue;
            if (bestTs === undefined || (h.timestamp || "") < bestTs) {
              bestTs = h.timestamp || "";
              bookerId = h.value;
            }
          }
        }
      }
      return bookerId ? ownerName(bookerId) : "Unattributed";
    };
    // Booking attribution counts a booking in the period it was CREATED, so only
    // iterate the created-in-window subset here (the fetch also pulled held-in-
    // window meetings that may have been created earlier — those belong to sat,
    // not booked).
    //
    // Dedupe by associated CONTACT so a rescheduled session (same person, 2-3
    // created meetings) counts as ONE unique DS. We keep only the FIRST created
    // meeting per contact (bookedMeetingsRaw is date-sorted DESC from the search,
    // so we sort ASC here to keep the earliest booking). Meetings with no
    // associated contact key on their own id, so each still counts once. The
    // per-consultant and per-strategist tallies use this same deduped set, so
    // those columns reconcile with the headline `booked` total.
    const contactKey = (m: any): string => {
      const cids = contactAssoc[m.id] || [];
      return cids.length ? `c:${cids.slice().sort()[0]}` : `m:${m.id}`;
    };
    const seenBookedKeys = new Set<string>();
    const bookedMeetings = bookedMeetingsRaw
      .slice()
      .sort((a, b) =>
        (a.properties.hs_createdate || "").localeCompare(
          b.properties.hs_createdate || "",
        ),
      )
      .filter((m) => {
        const k = contactKey(m);
        if (seenBookedKeys.has(k)) return false; // rescheduled dup → skip
        seenBookedKeys.add(k);
        return true;
      });
    // Replace the provisional raw count with the unique-session count.
    booked = bookedMeetings.length;
    for (const m of bookedMeetings) {
      const name = resolveBooker(m.id);
      bookedByConsultant[name] = (bookedByConsultant[name] || 0) + 1;
      (bookingsByConsultant[name] ||= []).push({
        client: clientFromTitle(m.properties.hs_meeting_title || ""),
        date: m.properties.hs_createdate || "",
      });
      const strat = strategistByMeeting[m.id];
      if (strat) bookedByStrategist[strat] = (bookedByStrategist[strat] || 0) + 1;
    }
  }

  // Candidate sat: DS meeting whose session time falls within [start, end).
  const started = dsMeetings.filter((m) => {
    const st = m.properties.hs_meeting_start_time;
    return !!st && st >= startIso && st < endIso;
  });

  // Sat = the number of UNIQUE PEOPLE who attended a DS in the window. Rules,
  // per Ben (ICG) — this is a core business stat and consultants are paid on it,
  // so it must be exact:
  //
  //  1. The meeting `hs_meeting_outcome` field is NOT reliable (the team leaves
  //     most held sessions as SCHEDULED), so we do NOT use it. Instead we validate
  //     attendance from the associated deal's pipeline stage: a deal in any
  //     DS_SAT_STAGES stage means the prospect sat (this includes "DS Sat - Missed",
  //     which is a missed follow-up, not a no-show).
  //  2. Count by when the session was HELD (started-in-window), not when created.
  //  3. Dedupe by deal: if one prospect has two sessions in the window they missed
  //     the first and re-sat, which is ONE sat — so we count distinct sat deals,
  //     not raw meetings.
  const satStages = new Set(DS_SAT_STAGES);
  const satDealIds = new Set<string>();
  // Per-consultant sat: attribute each UNIQUE sat deal to the consultant who
  // booked its session, using the SAME booker resolution as booked. We attribute
  // a deal via the first started-in-window meeting it appears on, and dedupe by
  // deal so a re-sit (two sessions, same person) counts once for one consultant
  // — matching the headline sat definition. Sat is counted in the period the
  // session was HELD, so a boundary session (booked one week, held the next) is
  // credited to the booker's sat in the HELD period; booked and sat therefore
  // live in different period windows for such sessions, which is intentional
  // (Ben's model: booked this week, sat next week are separate stats). The
  // consultant show-up % is thus period-based, not cohort-based.
  for (const m of started) {
    const st = m.properties.hs_meeting_start_time;
    const dsDay = st ? aestDay(st) : undefined;
    for (const did of dealAssoc[m.id] || []) {
      // Record the earliest DS session day per deal (for on-session classification
      // of membership sales), regardless of sat status.
      if (dsDay && (!dsDayByDeal[did] || dsDay < dsDayByDeal[did])) {
        dsDayByDeal[did] = dsDay;
      }
      if (!satStages.has(dealProps[did]?.dealstage)) continue;
      if (satDealIds.has(did)) continue; // dedupe by deal (unique people)
      satDealIds.add(did);
      const name = resolveBooker(m.id);
      satByConsultant[name] = (satByConsultant[name] || 0) + 1;
      (satsByConsultant[name] ||= []).push({
        client: clientFromTitle(m.properties.hs_meeting_title || ""),
        date: st || "",
      });
      const strat = strategistByMeeting[m.id];
      if (strat) satByStrategist[strat] = (satByStrategist[strat] || 0) + 1;
    }
  }
  const sat = satDealIds.size;

  // Sort each consultant's lists by date (ascending) for stable display.
  for (const k of Object.keys(bookingsByConsultant))
    bookingsByConsultant[k].sort((a, b) => a.date.localeCompare(b.date));
  for (const k of Object.keys(satsByConsultant))
    satsByConsultant[k].sort((a, b) => a.date.localeCompare(b.date));

  return {
    booked,
    started: started.length,
    sat,
    bookedByConsultant,
    satByConsultant,
    bookingsByConsultant,
    satsByConsultant,
    bookedByStrategist,
    satByStrategist,
    dsDayByDeal,
  };
}

// Memberships sold in window: for each membership-sold stage, find deals and
// count those whose CLOSE DATE falls within the window. We count by closedate
// (rather than hs_v2_date_entered_<stage>) so that a sale entered late in the
// system but with a corrected close date lands in the month the sale actually
// happened. For all historical sold deals closedate equals the stage-entry date,
// so this only shifts deals whose close date was manually corrected. Also returns
// a per-strategist breakdown (by the deal's `strategist` field) so the strategist
// table's "Sold" column uses the SAME definition as this headline figure and
// ties out to it (deals with no strategist set fall into the headline total but
// not into any strategist row).
async function membershipsSold(
  startIso: string,
  endIso: string,
  // DS session day (AEST yyyy-mm-dd) per deal id, from discoverySessions. Used to
  // classify each sale as on-session (closed same day as the client's DS) vs
  // follow-up (closed a later day). Deals whose DS was held outside this window
  // are backfilled below via meeting associations so the split is complete.
  dsDayByDeal: Record<string, string> = {},
) {
  const tiers: Record<string, number> = {};
  const byStrategist: Record<string, number> = {};
  // Per-strategist on-session vs follow-up membership sale split.
  const splitByStrategist: Record<string, { onSession: number; followUp: number }> = {};
  let total = 0;
  let onSessionTotal = 0;
  let followUpTotal = 0;
  // Collect all sold-in-window deals first so we can backfill DS days in one pass.
  const soldDeals: {
    id: string;
    closeDay?: string;
    strat?: string;
    name: string;
    tier: string;
    closedate: string;
  }[] = [];
  for (const [stageId, tier] of Object.entries(MEMBERSHIP_SOLD_TIERS)) {
    const deals = await hubspot.searchObjects(
      "deals",
      {
        filterGroups: [
          { filters: [{ propertyName: "dealstage", operator: "EQ", value: stageId }] },
        ],
        properties: [
          "dealstage",
          "closedate",
          "strategist",
          "hubspot_owner_id",
          "dealname",
        ],
      },
      3000,
    );
    let count = 0;
    for (const d of deals) {
      const closed = d.properties.closedate;
      if (closed && closed >= startIso && closed < endIso) {
        count++;
        // Attribute by the deal's `strategist` field; when it is blank, fall
        // back to the deal owner (some sold deals never got the strategist
        // property set even though the owner is the strategist). Only count
        // toward a strategist row when the resolved owner is a strategist, so
        // per-strategist totals tie out to the headline sold figure.
        const s = d.properties.strategist || d.properties.hubspot_owner_id;
        const key = s && isStrategistOwner(s) ? ownerName(s) : undefined;
        if (key) byStrategist[key] = (byStrategist[key] || 0) + 1;
        soldDeals.push({
          id: d.id,
          closeDay: aestDay(closed),
          strat: key,
          name: (d.properties.dealname || "Membership").replace(
            /\s*[-\u2013]\s*Membership\s*$/i,
            "",
          ),
          tier,
          closedate: closed,
        });
      }
    }
    tiers[tier] = count;
    total += count;
  }

  // Backfill DS session day for sold deals whose DS was not held in this window
  // (dsDayByDeal only covers window-held sessions). One batchAssociations +
  // batchRead over the missing deals, then take the earliest DS meeting day.
  const dsDay: Record<string, string | undefined> = {};
  const missing = soldDeals.map((s) => s.id).filter((id) => !dsDayByDeal[id]);
  if (missing.length) {
    try {
      const meetAssoc = await hubspot.batchAssociations("deals", "meetings", missing);
      const allMeetIds = Array.from(new Set(Object.values(meetAssoc).flat()));
      const meetProps = allMeetIds.length
        ? await hubspot.batchRead("meetings", allMeetIds, [
            "hs_meeting_title",
            "hs_meeting_start_time",
          ])
        : {};
      for (const id of missing) {
        let best: string | undefined;
        for (const mid of meetAssoc[id] || []) {
          const mp = meetProps[mid];
          if (!mp) continue;
          if (!(mp.hs_meeting_title || "").startsWith(DS_TITLE_PREFIX)) continue;
          const day = aestDay(mp.hs_meeting_start_time);
          if (day && (!best || day < best)) best = day;
        }
        dsDay[id] = best;
      }
    } catch {
      // If association backfill fails, those deals fall to "unknown" (follow-up).
    }
  }

  // Per-strategist list of the actual membership deals sold in the window.
  const dealsByStrategist: Record<
    string,
    {
      name: string;
      tier: string;
      closedate: string;
      onSession: boolean;
      url: string;
    }[]
  > = {};
  for (const sd of soldDeals) {
    const sessionDay = dsDayByDeal[sd.id] || dsDay[sd.id];
    const onSession = !!sessionDay && !!sd.closeDay && sessionDay === sd.closeDay;
    if (onSession) onSessionTotal++;
    else followUpTotal++;
    if (sd.strat) {
      const b = (splitByStrategist[sd.strat] ||= { onSession: 0, followUp: 0 });
      if (onSession) b.onSession++;
      else b.followUp++;
      (dealsByStrategist[sd.strat] ||= []).push({
        name: sd.name,
        tier: sd.tier,
        closedate: sd.closedate,
        onSession,
        url: `https://app.hubspot.com/contacts/442187411/record/0-3/${sd.id}`,
      });
    }
  }
  // Newest sale first within each strategist.
  for (const k of Object.keys(dealsByStrategist)) {
    dealsByStrategist[k].sort((a, b) => b.closedate.localeCompare(a.closedate));
  }

  // ---- Channel attribution (Meta vs EMBR) for CAC ---------------------------
  // Trace each sold-in-window membership back to its associated CONTACT's
  // lead_source. EMBR = lead_source='EMBR'; Meta = every other source (same rule
  // used for lead counts and booking rate). A deal may associate to multiple
  // contacts; if ANY associated contact is EMBR-tagged we count the sale as
  // EMBR, else Meta. Used as the CAC denominator per channel.
  const byChannel = { meta: 0, embr: 0 };
  try {
    const soldIds = soldDeals.map((s) => s.id);
    if (soldIds.length) {
      const contactAssoc = await hubspot.batchAssociations("deals", "contacts", soldIds);
      const allContactIds = Array.from(new Set(Object.values(contactAssoc).flat()));
      const contactProps = allContactIds.length
        ? await hubspot.batchRead("contacts", allContactIds, ["lead_source"])
        : {};
      for (const sd of soldDeals) {
        const cids = contactAssoc[sd.id] || [];
        const isEmbr = cids.some(
          (cid) => contactProps[cid]?.lead_source === "EMBR",
        );
        if (isEmbr) byChannel.embr++;
        else byChannel.meta++;
      }
    }
  } catch {
    // If attribution fails, leave byChannel at zero — CAC section degrades
    // gracefully rather than blocking the sold count.
  }

  return {
    total,
    tiers,
    byStrategist,
    splitByStrategist,
    dealsByStrategist,
    onSessionTotal,
    followUpTotal,
    byChannel,
  };
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
    // ds must resolve before membershipsSold so we can pass dsDayByDeal for the
    // on-session vs follow-up classification. contactFunnel runs in parallel.
    const [contact, ds] = await Promise.all([
      contactFunnel(range.start, range.end),
      discoverySessions(range.start, range.end),
    ]);
    const sold = await membershipsSold(range.start, range.end, ds.dsDayByDeal);
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
    return {
      ok: true as const,
      window,
      bookedByConsultant: ds.bookedByConsultant,
      satByConsultant: ds.satByConsultant,
      bookingsByConsultant: ds.bookingsByConsultant,
      satsByConsultant: ds.satsByConsultant,
      bookedByStrategist: ds.bookedByStrategist,
      satByStrategist: ds.satByStrategist,
      funnelConsultants: contact.consultants,
      soldByStrategist: sold.byStrategist,
      membershipSplitByStrategist: sold.splitByStrategist,
      membershipDealsByStrategist: sold.dealsByStrategist,
      membershipSplitTotals: {
        onSession: sold.onSessionTotal,
        followUp: sold.followUpTotal,
      },
      soldByChannel: sold.byChannel,
    };
  } catch (err: any) {
    return { ok: false as const, error: err?.message || "Sales funnel data unavailable" };
  }
}

// ---- CONSULTANT TEAM (booking consultants) --------------------------------
// One row per genuine BOOKING CONSULTANT (Steven Green, Moses, Akhil, Ben
// Houghton). Strategists/contract-team are never listed here — they live in the
// strategist table. Every column is derived from the SAME sources the headline
// uses so the table reconciles:
//   - Leads = the consultant's new-lead count from contactFunnel (the same
//     figure shown in "Lead contact by consultant"; sums to headline new leads).
//   - DS booked = the consultant's attributed DS bookings (bookedByConsultant),
//     i.e. the same DS meetings the headline DS-booked total counts.
//   - Sold = memberships the consultant booked, from consultant-pipeline deals
//     in the period whose booking_consultant is this consultant.
async function consultantTeam(
  range: PeriodRange,
  bookedByConsultant: Record<string, number> = {},
  funnelConsultants: FunnelConsultant[] = [],
  satByConsultant: Record<string, number> = {},
  bookingsByConsultant: Record<string, { client: string; date: string }[]> = {},
  satsByConsultant: Record<string, { client: string; date: string }[]> = {},
) {
  // Memberships sold per booking consultant (deals created in the period).
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
  const soldByConsultant: Record<string, number> = {};
  for (const d of deals) {
    const c = d.properties.booking_consultant || d.properties.hubspot_owner_id;
    if (!c || !isBookingConsultant(c)) continue; // consultants only
    if (MEMBERSHIP_SOLD_STAGES.includes(d.properties.dealstage || "")) {
      const n = ownerName(c);
      soldByConsultant[n] = (soldByConsultant[n] || 0) + 1;
    }
  }

  // Leads per consultant come straight from the contact funnel so the figure
  // matches "Lead contact by consultant" exactly.
  const leadsByConsultant: Record<string, number> = {};
  for (const fc of funnelConsultants) {
    if (fc.name === "Other / Unassigned") continue;
    leadsByConsultant[fc.name] = fc.leads;
  }

  // Build exactly one row per canonical booking consultant.
  const names = Array.from(new Set(Object.values(BOOKING_CONSULTANTS)));
  return names
    .map((name) => {
      const dsBooked = bookedByConsultant[name] || 0;
      const dsSat = satByConsultant[name] || 0;
      // Show-up % = sat / booked. Period-based (booked and sat can be different
      // cohorts within a window for boundary sessions — see discoverySessions).
      // Null when nothing was booked so the UI can show "—" instead of 0%.
      const showUp = dsBooked > 0 ? Math.round((dsSat / dsBooked) * 100) : null;
      return {
        name,
        deals: leadsByConsultant[name] || 0, // "deals" field renders as Leads
        dsBooked,
        dsSat,
        showUp,
        sold: soldByConsultant[name] || 0,
        // Client-level drill-down lists for this consultant (same booker
        // resolution + dedupe as the counts above).
        bookings: bookingsByConsultant[name] || [],
        sats: satsByConsultant[name] || [],
      };
    })
    .sort((a, b) => b.dsBooked - a.dsBooked || b.deals - a.deals);
}

// ---- STRATEGIST TEAM -------------------------------------------------------
// `assigned` = DS/membership deals assigned to the strategist in the period.
// `sold` = memberships SOLD in the period attributed to the strategist, using
// the SAME definition as the headline Memberships-sold card (deal entered a
// sold stage within the period), passed in via `soldByStrategist`. This makes
// the strategist Sold column tie out to the headline figure.
async function strategistTeam(
  range: PeriodRange,
  soldByStrategist: Record<string, number> = {},
  bookedByStrategist: Record<string, number> = {},
  satByStrategist: Record<string, number> = {},
  splitByStrategist: Record<string, { onSession: number; followUp: number }> = {},
  dealsByStrategist: Record<
    string,
    { name: string; tier: string; closedate: string; onSession: boolean; url: string }[]
  > = {},
) {
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
  const byStrategist: Record<string, { assigned: number }> = {};
  for (const d of deals) {
    const s = d.properties.strategist;
    if (!s) continue;
    const key = ownerName(s);
    if (!byStrategist[key]) byStrategist[key] = { assigned: 0 };
    byStrategist[key].assigned++;
  }
  // Make sure strategists who sold, ran DS, or had a split in the period appear
  // even if they had no new deals assigned in the same period.
  for (const name of [
    ...Object.keys(soldByStrategist),
    ...Object.keys(bookedByStrategist),
    ...Object.keys(satByStrategist),
    ...Object.keys(splitByStrategist),
  ]) {
    if (!byStrategist[name]) byStrategist[name] = { assigned: 0 };
  }
  return Object.entries(byStrategist)
    .map(([name, v]) => {
      const sold = soldByStrategist[name] || 0;
      const dsBooked = bookedByStrategist[name] || 0;
      const dsSat = satByStrategist[name] || 0;
      const split = splitByStrategist[name] || { onSession: 0, followUp: 0 };
      return {
        name,
        assigned: v.assigned,
        sold,
        conversion: v.assigned ? Math.round((sold / v.assigned) * 100) : 0,
        dsBooked,
        dsSat,
        // Conversion of memberships sold to DS sat (the strategist-side close rate).
        satConversion: dsSat ? Math.round((sold / dsSat) * 100) : null,
        soldOnSession: split.onSession,
        soldFollowUp: split.followUp,
        memberships: dealsByStrategist[name] || [],
      };
    })
    .sort((a, b) => b.sold - a.sold || b.dsSat - a.dsSat || b.assigned - a.assigned)
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

  // ---- Milestone-based classification (cumulative) -------------------------
  // An EOI is a MILESTONE: once a deal has entered an EOI stage it is counted
  // as an EOI done, even if it has since progressed to Contracts Issued /
  // Exchanged / UC. Likewise UC counts every deal that has reached
  // Unconditional. We read the per-deal hs_v2_date_entered_<stageId> timestamps
  // (retained by HubSpot for every stage a deal passed through) to find when
  // each milestone happened, and filter by the SELECTED PERIOD on that date.
  //   - EOI date  = earliest EOI-stage entered date.
  //   - UC date   = UC-stage entered date, or (settlement pipelines) closedate.
  // The middle steps (issued / signed / exchanged) stay CURRENT-stage so the
  // funnel bars still show where deals are right now.

  const parseT = (s?: string) => {
    if (!s) return NaN;
    const t = +new Date(s);
    return isNaN(t) ? NaN : t;
  };
  const inPeriod = (t: number) => !isNaN(t) && t >= startMs && t < endMs;

  // step key -> { count, value, byStrategist: {name -> count} }
  const steps: Record<string, { count: number; value: number; byStrategist: Record<string, number> }> = {};
  for (const s of CONTRACT_FUNNEL_STEPS) {
    steps[s.key] = { count: 0, value: 0, byStrategist: {} };
  }

  let pipelineValue = 0;
  // Full per-deal list (no cap) for the EOI / UC listing section. Each deal may
  // be BOTH an EOI and a UC (it did its EOI then progressed to UC); the listing
  // filters each table independently on eoiDate / ucDate.
  const dealList: any[] = [];
  const periodDealIds = new Set<string>();

  for (const d of deals) {
    const props = d.properties as any;
    const stage = props.dealstage || "";
    if (CONTRACT_EXCLUDE_STAGES.includes(stage)) continue;

    const pid = props.pipeline || "";
    const isSettlement = CONTRACT_UC_PIPELINES.includes(pid);
    const owner = dealStrategist[d.id] || "Unattributed";
    // Drop genuinely unattributed test/fake records (no real strategist, no
    // client activity) so they don't inflate EOI / UC milestone counts.
    const isFake = owner === "Unattributed";

    const amt = num(props.amount_in_home_currency) || num(props.amount);

    // --- EOI milestone date (earliest EOI-stage entered) ---
    let eoiMs = NaN;
    for (const sid of CONTRACT_EOI_STAGES) {
      const t = parseT(props[`hs_v2_date_entered_${sid}`]);
      if (!isNaN(t) && (isNaN(eoiMs) || t < eoiMs)) eoiMs = t;
    }
    const hasEoi = !isNaN(eoiMs);

    // --- UC milestone (reached Unconditional?) + date ---
    const reachedUC = stage === CONTRACT_UC_STAGE || isSettlement;
    let ucMs = NaN;
    if (reachedUC) {
      ucMs = parseT(props[`hs_v2_date_entered_${CONTRACT_UC_STAGE}`]);
      if (isNaN(ucMs)) ucMs = parseT(props.closedate);
      if (isNaN(ucMs)) ucMs = parseT(props.createdate);
    }

    // --- Current-stage step (for the funnel bars / middle steps) ---
    const currentStep = isSettlement ? "uc" : CONTRACT_STAGE_TO_STEP[stage];

    const eoiIso = hasEoi ? new Date(eoiMs).toISOString() : undefined;
    const ucIso = reachedUC && !isNaN(ucMs) ? new Date(ucMs).toISOString() : undefined;

    // Did this deal hit a milestone inside the selected period?
    const eoiInPeriod = !isFake && hasEoi && inPeriod(eoiMs);
    const ucInPeriod = !isFake && reachedUC && inPeriod(ucMs);

    // --- Funnel / by-strategist counts ---
    // EOI + UC are cumulative milestones (count if their milestone date is in
    // the period). The middle steps are current-stage (count if the deal is in
    // that stage now AND entered it within the period).
    if (eoiInPeriod) {
      steps.eoi.count++;
      steps.eoi.value += amt;
      steps.eoi.byStrategist[owner] = (steps.eoi.byStrategist[owner] || 0) + 1;
    }
    if (ucInPeriod) {
      steps.uc.count++;
      steps.uc.value += amt;
      steps.uc.byStrategist[owner] = (steps.uc.byStrategist[owner] || 0) + 1;
    }
    if (!isFake && currentStep && currentStep !== "eoi" && currentStep !== "uc") {
      // issued / signed / exchanged — current stage, period by entered date.
      const enteredMs = parseT(props[`hs_v2_date_entered_${stage}`]);
      const refMs = !isNaN(enteredMs) ? enteredMs : parseT(props.hs_lastmodifieddate);
      if (inPeriod(refMs)) {
        const b = steps[currentStep];
        b.count++;
        b.value += amt;
        b.byStrategist[owner] = (b.byStrategist[owner] || 0) + 1;
      }
    }

    // --- Listing entry (only if it hit EOI or UC in the period) ---
    if (eoiInPeriod || ucInPeriod) {
      periodDealIds.add(d.id);
      if (!periodDealIds.has(d.id + "_counted")) {
        pipelineValue += amt;
        periodDealIds.add(d.id + "_counted");
      }
      // Primary "step" for sorting/labelling: UC if it reached UC in period,
      // otherwise EOI. The frontend uses eoiDate / ucDate to place it in the
      // right table(s).
      const primaryStep = ucInPeriod ? "uc" : "eoi";
      dealList.push({
        name: props.dealname || "Unnamed",
        step: primaryStep,
        stage: stageName(stage),
        amount: amt,
        owner,
        // `date` kept for backwards-compat = the primary milestone date.
        date: ucInPeriod ? ucIso : eoiIso,
        eoiDate: eoiInPeriod ? eoiIso : undefined,
        ucDate: ucInPeriod ? ucIso : undefined,
        reachedUC: ucInPeriod,
        url: `https://app.hubspot.com/contacts/442187411/record/0-3/${d.id}`,
      });
    }
  }

  const totalInPeriod = Array.from(periodDealIds).filter((x) => !x.endsWith("_counted")).length;

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

  // Full deal list, newest first (by primary milestone date).
  const deals_out = dealList
    .slice()
    .sort((a, b) => +new Date(b.date) - +new Date(a.date));
  const recentList = deals_out.slice(0, 15);

  return {
    totalContracts: totalInPeriod,
    pipelineValue,
    funnel,
    byStrategist,
    steps: CONTRACT_FUNNEL_STEPS.map((s) => ({ key: s.key, label: s.label })),
    recent: recentList,
    deals: deals_out,
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
  // salesFunnel resolves the DS booking attribution (bookedByConsultant) that
  // consultantTeam needs so the per-consultant DS-booked column reconciles with
  // the headline DS-booked total. Run it first, then feed the map in.
  const [
    pipelines,
    mkt,
    embrData,
    funnel,
    members,
    contractData,
    fin,
  ] = await Promise.all([
    pipelineTotals(),
    marketing(range),
    embr(range),
    salesFunnel(range),
    memberships(),
    contracts(range),
    financial(),
  ]);
  const bookedByConsultant =
    funnel.ok && funnel.bookedByConsultant ? funnel.bookedByConsultant : {};
  const satByConsultant =
    funnel.ok && funnel.satByConsultant ? funnel.satByConsultant : {};
  const bookingsByConsultant =
    funnel.ok && funnel.bookingsByConsultant ? funnel.bookingsByConsultant : {};
  const satsByConsultant =
    funnel.ok && funnel.satsByConsultant ? funnel.satsByConsultant : {};
  const funnelConsultants =
    funnel.ok && funnel.funnelConsultants ? funnel.funnelConsultants : [];
  const soldByStrategist =
    funnel.ok && funnel.soldByStrategist ? funnel.soldByStrategist : {};
  const bookedByStrategist =
    funnel.ok && funnel.bookedByStrategist ? funnel.bookedByStrategist : {};
  const satByStrategist =
    funnel.ok && funnel.satByStrategist ? funnel.satByStrategist : {};
  const membershipSplitByStrategist =
    funnel.ok && funnel.membershipSplitByStrategist
      ? funnel.membershipSplitByStrategist
      : {};
  const membershipDealsByStrategist =
    funnel.ok && funnel.membershipDealsByStrategist
      ? funnel.membershipDealsByStrategist
      : {};
  // Memberships sold in the period split by acquisition channel (Meta vs EMBR),
  // used together with per-channel spend to compute CAC on the marketing page.
  const soldByChannel =
    funnel.ok && funnel.soldByChannel
      ? funnel.soldByChannel
      : { meta: 0, embr: 0 };
  // consultantTeam and strategistTeam both depend on figures resolved inside
  // salesFunnel (DS attribution, lead counts, memberships-sold breakdown), so
  // they run after the funnel resolves — ensuring every team column ties out to
  // the headline cards.
  const [consultants, strategists] = await Promise.all([
    consultantTeam(
      range,
      bookedByConsultant,
      funnelConsultants,
      satByConsultant,
      bookingsByConsultant,
      satsByConsultant,
    ),
    strategistTeam(
      range,
      soldByStrategist,
      bookedByStrategist,
      satByStrategist,
      membershipSplitByStrategist,
      membershipDealsByStrategist,
    ),
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
    soldByChannel,
    salesFunnel: funnel,
    consultants,
    strategists,
    memberships: members,
    contracts: contractData,
    financial: fin,
  };
}
