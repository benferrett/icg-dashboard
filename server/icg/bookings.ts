// Bookings page
// ---------------------------------------------------------------------------
// One row per Discovery Session (DS) booking CREATED in the selected window,
// showing: when the session is booked for, whether it sat, who booked it,
// which ad the lead came from, when the lead was created, and how many dials
// it took to book.
//
// The rules intentionally mirror discoverySessions() in metrics.ts so the
// "counted" rows on this page reconcile exactly with the dashboard's
// "DS booked" figure:
//   * a booking = a DS-titled meeting whose hs_createdate is in the window;
//   * only EMBR / Meta (paid social) leads count;
//   * rebooks for the same contact inside the window count once (earliest);
//   * the booker is the deal's booking_consultant, else the earliest booking-
//     consultant owner in the contact's owner history, else "Unattributed";
//   * attendance uses the shared classifyAttendance() rules (deal stage or
//     reviewed strategist evidence — never the meeting outcome field), and a
//     missing CRM update shows as "awaiting confirmation", not a no-show.
// Non-counted rows (rebooks, other lead sources) are still returned with a
// reason so the page can optionally show every booking made.

import { hubspot } from "./hubspot";
import { apiFetch } from "./proxy";
import { classifyAttendance, loadAttendanceContext } from "./attendance";
import type { AttendanceStatus } from "../../shared/attendance";
import type { PeriodRange } from "./period";
import { grossMembershipEligible, membershipSaleMs } from "./consultant-memberships";
import {
  DS_TITLE_PREFIX,
  bookingSourceOf,
  isBookingConsultant,
  isStrategistOwner,
  leadSourceLabel,
  ownerName,
  MEMBERSHIP_REFUND_STAGE,
  MEMBERSHIP_SOLD_STAGES,
  MEMBERSHIP_SOLD_TIERS,
} from "./reference";

type Props = Record<string, string | undefined>;
type Obj = { id: string; properties: Props };
type Assoc = Record<string, string[]>;
type History = Record<string, Array<{ value?: string; timestamp?: string }>>;

export interface BookingRow {
  meetingId: string;
  contactId?: string;
  dealId?: string;
  client: string;
  bookedAt: string; // when the booking was made (meeting created)
  sessionAt: string; // when the session is booked for
  strategist: string | null;
  booker: string; // booking consultant, or "Unattributed"
  status: AttendanceStatus;
  statusReason: string;
  evidenceUrl?: string;
  source: string; // EMBR / Meta / other friendly label
  adName: string | null;
  campaignName: string | null;
  adId: string | null;
  leadCreatedAt: string | null;
  dials: number; // outbound calls to the lead before the booking was made
  connectedDials: number; // of those, calls logged with the Connected outcome
  // Membership outcome for this client (same gross-sale rule as Consultants):
  // "signed_up" = paid Bronze/Silver/Gold; "refunded" = sold then cancelled.
  membership: "signed_up" | "refunded" | null;
  membershipTier: string | null;
  membershipDate: string | null; // sale / paid date (ISO)
  membershipDealUrl?: string;
  counted: boolean; // included in the dashboard's DS booked total
  excludedReason?: "rebook" | "source";
  hubspotUrl?: string;
}

export interface BookingsPayload {
  ok: true;
  generatedAt: string;
  period: { key: string; label: string; start: string; end: string };
  rows: BookingRow[];
  totals: {
    counted: number;
    all: number;
    sat: number;
    notSat: number;
    upcoming: number;
    awaiting: number;
    avgDials: number | null;
    signedUp: number;
  };
  adLookup: "ok" | "unavailable";
}

const PORTAL = "442187411";
const HSA_AD_RE = /[?&]hsa_ad=(\d+)/i;
const CONNECTED_DISPOSITION = "f240bbac-87c9-4f6e-bf70-924b57d47db7";

export function clientFromTitle(title: string): string {
  const afterColon = title.slice(DS_TITLE_PREFIX.length).replace(/^:\s*/, "");
  const withIdx = afterColon.search(/\s+With\s+/i);
  return (withIdx >= 0 ? afterColon.slice(0, withIdx) : afterColon).trim() || "(unnamed)";
}

function urlParam(url: string, key: string): string | null {
  const m = new RegExp(`[?&]${key}=([^&#]+)`, "i").exec(url);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1].replace(/\+/g, " ")).trim() || null;
  } catch {
    return m[1];
  }
}

export function adIdOf(contact?: Props): string | null {
  const m = HSA_AD_RE.exec(contact?.hs_analytics_first_url || "");
  return m ? m[1] : null;
}

// Best label for "which ad did the lead come from" when no Meta ad name is
// available: UTM content / campaign, then HubSpot's drill-down source detail.
function fallbackAdLabel(contact?: Props): string | null {
  const url = contact?.hs_analytics_first_url || "";
  return (
    urlParam(url, "utm_content") ||
    urlParam(url, "utm_campaign") ||
    contact?.hs_analytics_source_data_2 ||
    null
  );
}

function isOutboundCall(p: Props): boolean {
  const dir = (p.hs_call_direction || "").toLowerCase();
  return dir.includes("outbound") || dir.includes("outgoing");
}

function isConnectedCall(p: Props): boolean {
  // Same definition as the Consultant Scorecard: HubSpot "Connected" outcome.
  return p.hs_call_disposition === CONNECTED_DISPOSITION;
}

function contactName(p?: Props): string | null {
  const n = `${p?.firstname || ""} ${p?.lastname || ""}`.trim();
  return n || null;
}

export interface BuildInput {
  meetings: Obj[];
  dealAssoc: Assoc;
  contactAssoc: Assoc;
  dealProps: Record<string, Props>;
  contactProps: Record<string, Props>;
  contactHistory: Record<string, History>;
  contactCalls: Assoc;
  callProps: Record<string, Props>;
  ads: Record<string, { name: string; campaign: string | null }>;
  contactDeals?: Assoc;
  membershipProps?: Record<string, Props>;
  now?: number;
}

const SOLD_ENTERED_PROPS = MEMBERSHIP_SOLD_STAGES.map((id) => `hs_v2_date_entered_${id}`);
export const MEMBERSHIP_DEAL_PROPS = [
  "dealname",
  "pipeline",
  "dealstage",
  "booking_consultant",
  "membership_paid_date",
  "closedate",
  "hs_v2_date_entered_2872614380",
  `hs_v2_date_entered_${MEMBERSHIP_REFUND_STAGE}`,
  ...SOLD_ENTERED_PROPS,
];

// Membership outcome across all of the client's deals. A paid membership wins
// over a refunded one; the earliest qualifying sale is shown.
export function membershipOutcome(
  dealIds: string[],
  props: Record<string, Props>,
): Pick<BookingRow, "membership" | "membershipTier" | "membershipDate" | "membershipDealUrl"> {
  let best: { kind: "signed_up" | "refunded"; ms: number; tier: string | null; id: string } | null = null;
  for (const id of dealIds) {
    const p = props[id];
    if (!p || !grossMembershipEligible(p)) continue;
    const refunded = p.dealstage === MEMBERSHIP_REFUND_STAGE;
    const kind = refunded ? "refunded" : "signed_up";
    const ms = membershipSaleMs(p);
    let tier = MEMBERSHIP_SOLD_TIERS[p.dealstage || ""] || null;
    if (!tier) {
      // Refunded/paid-date-only deals: take the last sold tier it entered.
      let latest = -Infinity;
      for (const sid of MEMBERSHIP_SOLD_STAGES) {
        const t = Date.parse(p[`hs_v2_date_entered_${sid}`] || "");
        if (Number.isFinite(t) && t > latest) {
          latest = t;
          tier = MEMBERSHIP_SOLD_TIERS[sid];
        }
      }
    }
    const better =
      !best ||
      (kind === "signed_up" && best.kind === "refunded") ||
      (kind === best.kind && (Number.isFinite(ms) ? ms : Infinity) < (Number.isFinite(best.ms) ? best.ms : Infinity));
    if (better) best = { kind, ms, tier, id };
  }
  if (!best) return { membership: null, membershipTier: null, membershipDate: null };
  return {
    membership: best.kind,
    membershipTier: best.tier,
    membershipDate: Number.isFinite(best.ms) ? new Date(best.ms).toISOString() : null,
    membershipDealUrl: `https://app.hubspot.com/contacts/${PORTAL}/record/0-3/${best.id}`,
  };
}

// Pure assembly step (unit-tested). `meetings` must already be limited to DS
// meetings created in the window.
export function buildBookingRows(input: BuildInput): BookingRow[] {
  const { meetings, dealAssoc, contactAssoc, dealProps, contactProps, contactHistory } = input;
  const now = input.now ?? Date.now();

  const resolveBooker = (meetingId: string): string => {
    for (const did of dealAssoc[meetingId] || []) {
      const bc = dealProps[did]?.booking_consultant;
      if (isBookingConsultant(bc)) return ownerName(bc);
    }
    let bookerId: string | undefined;
    let bestTs: string | undefined;
    for (const cid of contactAssoc[meetingId] || []) {
      for (const h of contactHistory[cid]?.hubspot_owner_id || []) {
        if (!isBookingConsultant(h.value)) continue;
        if (bestTs === undefined || (h.timestamp || "") < bestTs) {
          bestTs = h.timestamp || "";
          bookerId = h.value;
        }
      }
    }
    return bookerId ? ownerName(bookerId) : "Unattributed";
  };

  // Prefer the contact that carries the paid lead source (EMBR before Meta),
  // matching sourceOfMeeting() in metrics.ts.
  const primaryContact = (meetingId: string): string | undefined => {
    const cids = contactAssoc[meetingId] || [];
    return (
      cids.find((c) => bookingSourceOf(contactProps[c]) === "EMBR") ||
      cids.find((c) => bookingSourceOf(contactProps[c]) === "META") ||
      cids[0]
    );
  };

  const sorted = meetings
    .slice()
    .sort((a, b) => (a.properties.hs_createdate || "").localeCompare(b.properties.hs_createdate || ""));
  const seen = new Set<string>();
  const rows: BookingRow[] = [];

  for (const m of sorted) {
    const cids = contactAssoc[m.id] || [];
    const cid = primaryContact(m.id);
    const cp = cid ? contactProps[cid] : undefined;
    const paid = cids.some((c) => bookingSourceOf(contactProps[c]) !== null);
    const key = cids.length ? `c:${cids.slice().sort()[0]}` : `m:${m.id}`;

    let counted = false;
    let excludedReason: BookingRow["excludedReason"];
    if (!paid) excludedReason = "source";
    else if (seen.has(key)) excludedReason = "rebook";
    else {
      seen.add(key);
      counted = true;
    }

    const dealIds = dealAssoc[m.id] || [];
    const attendance = classifyAttendance(m, dealIds, dealProps, now);

    // Dials to book: outbound calls to any of the meeting's contacts placed
    // before the booking was made.
    const bookedMs = Date.parse(m.properties.hs_createdate || "");
    const callIds = new Set<string>(cids.flatMap((c) => input.contactCalls[c] || []));
    let dials = 0;
    let connectedDials = 0;
    for (const callId of Array.from(callIds)) {
      const p = input.callProps[callId];
      if (!p || !isOutboundCall(p)) continue;
      const at = Date.parse(p.hs_timestamp || p.hs_createdate || "");
      if (!Number.isFinite(at) || !(at <= bookedMs)) continue;
      dials++;
      if (isConnectedCall(p)) connectedDials++;
    }

    const adId = adIdOf(cp);
    const ad = adId ? input.ads[adId] : undefined;
    const src = bookingSourceOf(cp);
    let adName: string | null = null;
    let campaignName: string | null = null;
    if (src === "EMBR") {
      adName = "EMBR lead";
    } else if (ad) {
      adName = ad.name;
      campaignName = ad.campaign;
    } else if (adId) {
      adName = fallbackAdLabel(cp) || `Ad ${adId}`;
    } else {
      adName = fallbackAdLabel(cp);
    }

    const memberDeals = Array.from(
      new Set([...dealIds, ...cids.flatMap((c) => input.contactDeals?.[c] || [])]),
    );
    const member = membershipOutcome(memberDeals, input.membershipProps || {});

    const oid = m.properties.hubspot_owner_id;
    rows.push({
      meetingId: m.id,
      contactId: cid,
      dealId: dealIds[0],
      client: contactName(cp) || clientFromTitle(m.properties.hs_meeting_title || ""),
      bookedAt: m.properties.hs_createdate || "",
      sessionAt: m.properties.hs_meeting_start_time || "",
      strategist: isStrategistOwner(oid) ? ownerName(oid) : null,
      booker: resolveBooker(m.id),
      status: attendance.status,
      statusReason: attendance.reason,
      evidenceUrl: attendance.evidenceUrl,
      source: leadSourceLabel(cp),
      adName,
      campaignName,
      adId,
      leadCreatedAt: cp?.createdate || null,
      dials,
      connectedDials,
      ...member,
      counted,
      excludedReason,
      hubspotUrl: cid
        ? `https://app.hubspot.com/contacts/${PORTAL}/record/0-1/${cid}`
        : dealIds[0]
          ? `https://app.hubspot.com/contacts/${PORTAL}/record/0-3/${dealIds[0]}`
          : undefined,
    });
  }
  // Newest bookings first for display.
  return rows.sort((a, b) => b.bookedAt.localeCompare(a.bookedAt));
}

export function summarise(rows: BookingRow[]): BookingsPayload["totals"] {
  const c = rows.filter((r) => r.counted);
  const dials = c.map((r) => r.dials);
  return {
    counted: c.length,
    all: rows.length,
    sat: c.filter((r) => r.status === "sat").length,
    notSat: c.filter((r) => ["no_show_or_reschedule", "cancelled", "rescheduled"].includes(r.status)).length,
    upcoming: c.filter((r) => r.status === "upcoming").length,
    awaiting: c.filter((r) => r.status === "awaiting_confirmation").length,
    signedUp: c.filter((r) => r.membership === "signed_up").length,
    avgDials: dials.length ? Math.round((dials.reduce((s, d) => s + d, 0) / dials.length) * 10) / 10 : null,
  };
}

// Look up Meta ad + campaign names by ad ID (works for paused/old ads too).
async function metaAdNames(
  adIds: string[],
): Promise<{ ok: boolean; ads: Record<string, { name: string; campaign: string | null }> }> {
  const ads: Record<string, { name: string; campaign: string | null }> = {};
  if (!adIds.length) return { ok: true, ads };
  let ok = true;
  for (let i = 0; i < adIds.length; i += 50) {
    const ids = adIds.slice(i, i + 50).join(",");
    try {
      const res = await apiFetch(
        "meta",
        `/v21.0/?ids=${ids}&fields=${encodeURIComponent("name,campaign{name}")}`,
      );
      const json: any = await res.json();
      if (json?.error) {
        ok = false;
        continue;
      }
      for (const [id, v] of Object.entries<any>(json || {})) {
        if (v?.name) ads[id] = { name: v.name, campaign: v.campaign?.name || null };
      }
    } catch {
      ok = false;
    }
  }
  return { ok, ads };
}

const CONTACT_PROPS = [
  "firstname",
  "lastname",
  "createdate",
  "lead_source",
  "embr_lead_id",
  "hs_analytics_source",
  "hs_analytics_source_data_2",
  "hs_analytics_first_url",
];

export async function bookingsList(range: PeriodRange): Promise<BookingsPayload> {
  const found = await hubspot.searchObjects(
    "meetings",
    {
      filterGroups: [
        {
          filters: [
            { propertyName: "hs_createdate", operator: "GTE", value: range.start },
            { propertyName: "hs_createdate", operator: "LT", value: range.end },
          ],
        },
      ],
      properties: [
        "hs_meeting_title",
        "hs_meeting_start_time",
        "hs_meeting_end_time",
        "hs_meeting_outcome",
        "hs_createdate",
        "hubspot_owner_id",
      ],
      sorts: [{ propertyName: "hs_createdate", direction: "DESCENDING" }],
    },
    5000,
  );
  const meetings = (found as Obj[]).filter((m) =>
    (m.properties.hs_meeting_title || "").startsWith(DS_TITLE_PREFIX),
  );
  const ids = meetings.map((m) => m.id);

  let dealAssoc: Assoc = {};
  let contactAssoc: Assoc = {};
  let dealProps: Record<string, Props> = {};
  let contactProps: Record<string, Props> = {};
  let contactHistory: Record<string, History> = {};
  let contactCalls: Assoc = {};
  let callProps: Record<string, Props> = {};
  let ads: Record<string, { name: string; campaign: string | null }> = {};
  let contactDeals: Assoc = {};
  let membershipProps: Record<string, Props> = {};
  let adLookup: BookingsPayload["adLookup"] = "ok";

  if (ids.length) {
    const [directDeals, contacts] = await Promise.all([
      hubspot.batchAssociations("meetings", "deals", ids),
      hubspot.batchAssociations("meetings", "contacts", ids),
    ]);
    contactAssoc = contacts;
    const ctx = await loadAttendanceContext(meetings, directDeals, contactAssoc);
    dealAssoc = ctx.dealAssoc;
    dealProps = ctx.dealProps as Record<string, Props>;

    const contactIds = Array.from(new Set(Object.values(contactAssoc).flat()));
    if (contactIds.length) {
      [contactProps, contactHistory, contactCalls, contactDeals] = await Promise.all([
        hubspot.batchRead("contacts", contactIds, CONTACT_PROPS),
        hubspot.batchReadWithHistory("contacts", contactIds, ["hubspot_owner_id"]),
        hubspot.batchAssociations("contacts", "calls", contactIds),
        hubspot.batchAssociations("contacts", "deals", contactIds),
      ]);
      const memberDealIds = Array.from(
        new Set([...Object.values(contactDeals).flat(), ...Object.values(dealAssoc).flat()]),
      );
      membershipProps = memberDealIds.length
        ? await hubspot.batchRead("deals", memberDealIds, MEMBERSHIP_DEAL_PROPS)
        : {};
      const callIds = Array.from(new Set(Object.values(contactCalls).flat()));
      const adIds = Array.from(
        new Set(contactIds.map((c) => adIdOf(contactProps[c])).filter(Boolean) as string[]),
      );
      const [cp, adRes] = await Promise.all([
        callIds.length
          ? hubspot.batchRead("calls", callIds, [
              "hs_timestamp",
              "hs_createdate",
              "hs_call_direction",
              "hs_call_disposition",
              "hs_call_duration",
            ])
          : Promise.resolve({} as Record<string, Props>),
        metaAdNames(adIds),
      ]);
      callProps = cp;
      ads = adRes.ads;
      if (!adRes.ok) adLookup = "unavailable";
    }
  }

  const rows = buildBookingRows({
    meetings,
    dealAssoc,
    contactAssoc,
    dealProps,
    contactProps,
    contactHistory,
    contactCalls,
    callProps,
    ads,
    contactDeals,
    membershipProps,
  });

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    period: { key: range.key, label: range.label, start: range.start, end: range.end },
    rows,
    totals: summarise(rows),
    adLookup,
  };
}
