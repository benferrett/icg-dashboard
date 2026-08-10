// Excellent Consultant Scorecard
// ---------------------------------------------------------------------------
// Outreach quality is intentionally calculated from raw HubSpot activities,
// rather than a contact's lifecycle stage. A contact can be moved between
// stages or reassigned, whereas the calls/texts below preserve the actual
// activity that happened during the selected reporting period.

import { hubspot } from "./hubspot";
import type { PeriodRange } from "./period";

type Props = Record<string, string | undefined>;
type HubSpotObject = { id: string; properties: Props };

export type ScorecardRole = "Booker" | "Strategist";
export type RAG = "green" | "amber" | "red" | "neutral";

export interface ScorecardLead {
  id: string;
  name: string;
  email: string;
  owner: string;
  createdAt: string;
  source: string;
  dials: number;
  sms: number;
  firstTouchMins: number | null;
  lastOutboundAt: string | null;
  reason?: string;
}

export interface ScorecardRow {
  name: string;
  role: ScorecardRole;
  ownedLeads: number;
  workedLeads: number;
  dials: number;
  connected: number;
  connectRate: number | null;
  totalTalkMs: number;
  totalTalkMin: number;
  avgTalkSec: number;
  over3mCalls: number;
  over3mPctOfConnected: number;
  spokeLeads: number;
  conversationRate: number | null;
  unanswered: number;
  doubleTaps: number;
  doubleTapRate: number | null;
  dialsPerLead: number | null;
  sms: number;
  smsPerLead: number | null;
  medianFirstTouchMins: number | null;
  zeroTouch: number;
  underWorked0Sms: number;
  underWorked1Sms: number;
  underWorked2Sms: number;
  underWorked3PlusSms: number;
  slowTouch: number;
  missedDoubleTaps: number;
  rag: Record<string, RAG>;
  drilldowns: {
    zeroTouch: ScorecardLead[];
    underWorked: {
      zero: ScorecardLead[];
      one: ScorecardLead[];
      two: ScorecardLead[];
      threePlus: ScorecardLead[];
    };
    slowTouch: ScorecardLead[];
    missedDoubleTaps: ScorecardLead[];
  };
}

export interface ConsultantScorecard {
  ok: true;
  sourceNote: string;
  rows: ScorecardRow[];
}

// The roster deliberately mirrors the weekly review cohort. Booker and
// strategist rows are both shown, but the RAG legend is aimed at bookers;
// strategist outreach figures are contextual only.
const ROSTER: Array<{ name: string; role: ScorecardRole; ownerIds: string[] }> = [
  { name: "Steven Green", role: "Booker", ownerIds: ["362741341"] },
  { name: "Moses Emmanuel", role: "Booker", ownerIds: ["363808537", "363811156"] },
  { name: "Akhil Venugopal", role: "Booker", ownerIds: ["362495114"] },
  { name: "Ben Ferrett", role: "Strategist", ownerIds: ["361455466"] },
  { name: "Renee O'Connell", role: "Strategist", ownerIds: ["363222039"] },
  { name: "Patrick Van Orsouw", role: "Strategist", ownerIds: ["362352488"] },
  { name: "Steven Mau", role: "Strategist", ownerIds: ["361919740", "361919911"] },
];

// HubSpot call disposition UUIDs — DO NOT change these strings.
export const CALL_DISPOSITION = {
  CONNECTED: "f240bbac-87c9-4f6e-bf70-924b57d47db7",
  NO_ANSWER: "73a0d17f-1163-4015-bdd5-ec830791da20",
  BUSY: "9d9162e7-6cf3-4944-bf63-4dff82258764",
  VOICEMAIL: "b2cf5968-551e-4856-9783-52b3da59a7d0",
} as const;

// Unanswered dials that are eligible for a double-tap follow-up. Wrong
// numbers are deliberately excluded because they should not be redialled.
export const UNANSWERED_DISPOSITIONS: readonly string[] = [
  CALL_DISPOSITION.NO_ANSWER,
  CALL_DISPOSITION.BUSY,
  CALL_DISPOSITION.VOICEMAIL,
];

export const OWNER_MAP: Record<string, string> = {
  "361919911": "Steven Mau",
  "363811156": "Moses Emmanuel",
  "362352488": "Patrick Van Orsouw",
  "362741341": "Steven Green",
  "362495114": "Akhil Venugopal",
  "363222039": "Renee O'Connell",
  "361455466": "Ben Ferrett",
  "364595873": "Jean-Jerome Vacher",
  // Existing legacy owners remain supported.
  "363808537": "Moses Emmanuel",
  "361919740": "Steven Mau",
  // 82710130 is the legacy/admin owner — do NOT map to a consultant.
};

const AIRCALL_LINE_RE = /call<\/span><\/strong>\s+on\s+<strong>([^<]+)<\/strong>/;
const AIRCALL_MADE_BY_RE = /made by\s+<strong>([^<]+)<\/strong>/;

const AIRCALL_LINE_MAP: Record<string, string> = {
  moses: "Moses Emmanuel",
  "steven green": "Steven Green",
  "steve green": "Steven Green",
  akhil: "Akhil Venugopal",
  "ben ferrett": "Ben Ferrett",
  patrick: "Patrick Van Orsouw",
  renee: "Renee O'Connell",
  "steve mau": "Steven Mau",
  "steven mau": "Steven Mau",
  jean: "Jean-Jerome Vacher",
};

const ownerToConsultant = new Map(Object.entries(OWNER_MAP));

const MINUTE_MS = 60 * 1000;
const DOUBLE_TAP_WINDOW_MS = 2 * MINUTE_MS;
// A slow first touch is a lead whose first dial was more than 15 minutes after
// create time. It is intentionally surfaced as a coaching list, not hidden in
// a percentage where a few extreme delays can be lost.
const SLOW_TOUCH_MINUTES = 15;

function asTime(value?: string): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isNaN(timestamp)) return timestamp;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function isInRange(timestamp: number | null, range: PeriodRange): boolean {
  if (timestamp == null) return false;
  return timestamp >= Date.parse(range.start) && timestamp < Date.parse(range.end);
}

function normalized(value?: string): string {
  return (value || "").trim().toLowerCase();
}

function isOutbound(props: Props, kind: "call" | "sms"): boolean {
  const direction = normalized(
    props.hs_call_direction ||
      props.hs_communication_direction ||
      props.hs_direction ||
      props.direction,
  );
  // HubSpot's native values are normally INBOUND/OUTBOUND. The suffix handling
  // also covers Aircall and communication records that use "outgoing".
  if (direction.includes("outbound") || direction.includes("outgoing")) return true;
  // Communications can omit a direction for an agent-created SMS. In that case
  // treat a roster-owned SMS as outbound, but never infer calls as outbound.
  return kind === "sms" && !direction && !!ownerToConsultant.get(props.hubspot_owner_id || "");
}

function isSms(props: Props): boolean {
  const channel = normalized(
    props.hs_communication_channel_type ||
      props.hs_communication_channel ||
      props.hs_channel_type ||
      props.channel_type,
  );
  return channel === "sms" || channel.includes("text message") || channel.includes("sms");
}

export function isConnected(call: { hs_call_disposition?: string | null }): boolean {
  return call.hs_call_disposition === CALL_DISPOSITION.CONNECTED;
}

export function isUnanswered(call: { hs_call_disposition?: string | null }): boolean {
  return (
    !!call.hs_call_disposition &&
    UNANSWERED_DISPOSITIONS.includes(call.hs_call_disposition)
  );
}

function normaliseLine(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let line = raw.trim().toLowerCase();
  const parts = line.split(/\s+/);
  if (parts.length > 1 && /^\d+$/.test(parts[parts.length - 1])) {
    line = parts.slice(0, -1).join(" ");
  }
  for (const [key, consultant] of Object.entries(AIRCALL_LINE_MAP)) {
    if (line.includes(key)) return consultant;
  }
  return null;
}

export function resolveConsultant(call: {
  hubspot_owner_id?: string | null;
  hs_call_body?: string | null;
}): string {
  const ownerId = call.hubspot_owner_id ? String(call.hubspot_owner_id) : null;
  if (ownerId && OWNER_MAP[ownerId]) return OWNER_MAP[ownerId];

  const body = call.hs_call_body || "";
  const lineMatch = body.match(AIRCALL_LINE_RE);
  if (lineMatch) {
    const consultant = normaliseLine(lineMatch[1]);
    if (consultant) return consultant;
  }
  const madeByMatch = body.match(AIRCALL_MADE_BY_RE);
  if (madeByMatch) {
    const consultant = normaliseLine(madeByMatch[1]);
    if (consultant) return consultant;
  }
  return "Unassigned";
}

function consultantForActivity(props: Props, fallbackOwnerId?: string): string | undefined {
  const consultant = resolveConsultant(props);
  return consultant === "Unassigned"
    ? ownerToConsultant.get(fallbackOwnerId || "")
    : consultant;
}

function sourceIsEligible(source?: string): boolean {
  const value = normalized(source);
  if (!value || value.startsWith("userid:") || value === "36503") return false;
  return (
    value.includes("layer 2") ||
    value.includes("layer 3") ||
    value.includes("embr") ||
    value === "31000482" ||
    value === "36255028"
  );
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function percent(numerator: number, denominator: number): number | null {
  return denominator ? (numerator / denominator) * 100 : null;
}

function average(numerator: number, denominator: number): number | null {
  return denominator ? numerator / denominator : null;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function callDurationMs(value?: string): number {
  const duration = Number(value);
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

function rateRag(value: number | null, green: number, amber: number): RAG {
  if (value == null) return "neutral";
  if (value >= green) return "green";
  if (value >= amber) return "amber";
  return "red";
}

function higherIsBetterRag(value: number | null, green: number, amber: number): RAG {
  return rateRag(value, green, amber);
}

function lowerIsBetterRag(value: number | null, green: number, amber: number): RAG {
  if (value == null) return "neutral";
  if (value <= green) return "green";
  if (value <= amber) return "amber";
  return "red";
}

function leadName(contact: HubSpotObject): string {
  const value = `${contact.properties.firstname || ""} ${contact.properties.lastname || ""}`.trim();
  return value || "(no name)";
}

interface OutboundActivity {
  id: string;
  at: number;
  consultant?: string;
  connected?: boolean;
  unanswered?: boolean;
  durationMs?: number;
}

interface LeadActivity {
  contact: HubSpotObject;
  owner: string | undefined;
  calls: OutboundActivity[];
  sms: OutboundActivity[];
}

function makeLead(
  activity: LeadActivity,
  periodCalls: OutboundActivity[],
  periodSms: OutboundActivity[],
  reason?: string,
): ScorecardLead {
  const createdAt = activity.contact.properties.createdate || "";
  const createdMs = asTime(createdAt);
  const firstCall = activity.calls.length
    ? Math.min(...activity.calls.map((call) => call.at))
    : null;
  const lastActivity = [...activity.calls, ...activity.sms]
    .map((event) => event.at)
    .sort((a, b) => b - a)[0];
  return {
    id: activity.contact.id,
    name: leadName(activity.contact),
    email: activity.contact.properties.email || "—",
    owner: activity.owner || "Unassigned",
    createdAt,
    source: activity.contact.properties.lead_source || "—",
    dials: periodCalls.length,
    sms: periodSms.length,
    firstTouchMins:
      createdMs != null && firstCall != null
        ? Math.max(0, Math.round((firstCall - createdMs) / MINUTE_MS))
        : null,
    lastOutboundAt: lastActivity != null ? new Date(lastActivity).toISOString() : null,
    reason,
  };
}

/**
 * Builds the weekly coaching scorecard from contacts created in the selected
 * range and their associated call/SMS activities. Every HubSpot lookup uses the
 * existing read-through client, so normal snapshot + SQLite response caching
 * still applies and this module never creates a second data store.
 */
export async function consultantScorecard(range: PeriodRange): Promise<ConsultantScorecard> {
  const contacts = (await hubspot.searchObjects(
    "contacts",
    {
      filterGroups: [
        {
          filters: [
            { propertyName: "createdate", operator: "GTE", value: range.start },
            { propertyName: "createdate", operator: "LT", value: range.end },
            {
              propertyName: "hubspot_owner_id",
              operator: "IN",
              values: ROSTER.flatMap((person) => person.ownerIds),
            },
          ],
        },
      ],
      properties: [
        "firstname",
        "lastname",
        "email",
        "createdate",
        "hubspot_owner_id",
        "lead_source",
      ],
      sorts: [{ propertyName: "createdate", direction: "DESCENDING" }],
    },
    20000,
  )) as HubSpotObject[];

  const contactIds = contacts.map((contact) => contact.id);
  const emptyAssociations: Record<string, string[]> = {};
  const [callAssociations, communicationAssociations] = await Promise.all([
    contactIds.length
      ? hubspot.batchAssociations("contacts", "calls", contactIds)
      : Promise.resolve(emptyAssociations),
    // HubSpot records SMS as a communication. The shared data layer degrades a
    // missing/unauthorised activity type to an empty association map, allowing
    // the rest of the scorecard to remain useful without direct API calls.
    contactIds.length
      ? hubspot.batchAssociations("contacts", "communications", contactIds)
      : Promise.resolve(emptyAssociations),
  ]);

  const callIds = Array.from(new Set<string>(Object.values(callAssociations).flat()));
  const communicationIds = Array.from(
    new Set<string>(Object.values(communicationAssociations).flat()),
  );
  const [callProps, communicationProps] = await Promise.all([
    callIds.length
      ? hubspot.batchRead("calls", callIds, [
          "hs_timestamp",
          "hs_createdate",
          "hs_call_direction",
          "hs_call_disposition",
          "hs_call_status",
          "hs_call_duration",
          "hubspot_owner_id",
          "hs_call_body",
          "hs_call_title",
        ])
      : Promise.resolve({} as Record<string, Props>),
    communicationIds.length
      ? hubspot.batchRead("communications", communicationIds, [
          "hs_timestamp",
          "hs_createdate",
          "hs_communication_channel_type",
          "hs_communication_channel",
          "hs_communication_direction",
          "hs_direction",
          "hubspot_owner_id",
          "hs_communication_body",
        ])
      : Promise.resolve({} as Record<string, Props>),
  ]);

  const activities = new Map<string, LeadActivity>();
  for (const contact of contacts) {
    const owner = ownerToConsultant.get(contact.properties.hubspot_owner_id || "");
    const calls: OutboundActivity[] = [];
    const sms: OutboundActivity[] = [];
    for (const callId of callAssociations[contact.id] || []) {
      const props = callProps[callId];
      if (!props || !isOutbound(props, "call")) continue;
      const at = asTime(props.hs_timestamp || props.hs_createdate);
      if (at == null) continue;
      calls.push({
        id: callId,
        at,
        consultant: consultantForActivity(props, contact.properties.hubspot_owner_id),
        connected: isConnected(props),
        unanswered: isUnanswered(props),
        durationMs: callDurationMs(props.hs_call_duration),
      });
    }
    for (const communicationId of communicationAssociations[contact.id] || []) {
      const props = communicationProps[communicationId];
      if (!props || !isSms(props) || !isOutbound(props, "sms")) continue;
      const at = asTime(props.hs_timestamp || props.hs_createdate);
      if (at == null) continue;
      sms.push({
        id: communicationId,
        at,
        consultant: consultantForActivity(props, contact.properties.hubspot_owner_id),
      });
    }
    activities.set(contact.id, { contact, owner, calls, sms });
  }

  const rows: ScorecardRow[] = ROSTER.map((person) => {
    const ownedActivities = Array.from(activities.values()).filter(
      (activity) => activity.owner === person.name,
    );
    const periodCallEvents = ownedActivities.flatMap((activity) =>
      activity.calls
        .filter((call) => isInRange(call.at, range) && call.consultant === person.name)
        .map((call) => ({ contactId: activity.contact.id, call })),
    );
    const periodSmsEvents = ownedActivities.flatMap((activity) =>
      activity.sms
        .filter((sms) => isInRange(sms.at, range) && sms.consultant === person.name)
        .map((sms) => ({ contactId: activity.contact.id, sms })),
    );

    const workedContactIds = new Set([
      ...periodCallEvents.map((event) => event.contactId),
      ...periodSmsEvents.map((event) => event.contactId),
    ]);
    const spokeContactIds = new Set(
      periodCallEvents.filter((event) => event.call.connected).map((event) => event.contactId),
    );
    const unansweredEvents = periodCallEvents.filter((event) => event.call.unanswered);

    // Double tap: after each unanswered outbound call, inspect the complete
    // outbound call sequence for that contact. The follow-up may be logged by a
    // different owner (e.g. a handoff); it still counts because the lead was
    // genuinely called again inside the two-minute window.
    const doubleTappedInitialIds = new Set<string>();
    const missedDoubleTapContacts = new Map<string, OutboundActivity>();
    for (const { contactId, call } of unansweredEvents) {
      const allOutboundCalls = activities.get(contactId)?.calls || [];
      const hasFollowUp = allOutboundCalls.some(
        (candidate) =>
          candidate.at > call.at && candidate.at - call.at <= DOUBLE_TAP_WINDOW_MS,
      );
      if (hasFollowUp) doubleTappedInitialIds.add(call.id);
      else {
        const previous = missedDoubleTapContacts.get(contactId);
        if (!previous || call.at > previous.at) missedDoubleTapContacts.set(contactId, call);
      }
    }

    const zeroTouch: ScorecardLead[] = [];
    const underWorked = {
      zero: [] as ScorecardLead[],
      one: [] as ScorecardLead[],
      two: [] as ScorecardLead[],
      threePlus: [] as ScorecardLead[],
    };
    const slowTouch: ScorecardLead[] = [];

    for (const activity of ownedActivities) {
      const eligible = sourceIsEligible(activity.contact.properties.lead_source);
      const currentPeriodCalls = activity.calls.filter((call) =>
        isInRange(call.at, range),
      );
      const currentPeriodSms = activity.sms.filter((sms) => isInRange(sms.at, range));
      const anyOutboundCalls = activity.calls.length;
      const anyOutboundSms = activity.sms.length;
      const lead = makeLead(activity, currentPeriodCalls, currentPeriodSms);
      if (eligible && anyOutboundCalls === 0 && anyOutboundSms === 0) {
        zeroTouch.push({ ...lead, reason: "No outbound calls or SMS" });
      }
      const hasEverSpoken = activity.calls.some((call) => call.connected);
      if (eligible && anyOutboundCalls >= 1 && anyOutboundCalls <= 4 && !hasEverSpoken) {
        const item = { ...lead, dials: anyOutboundCalls, sms: anyOutboundSms };
        if (anyOutboundSms === 0)
          underWorked.zero.push({ ...item, reason: "1–4 dials, no conversation, 0 SMS" });
        else if (anyOutboundSms === 1)
          underWorked.one.push({ ...item, reason: "1–4 dials, no conversation, 1 SMS" });
        else if (anyOutboundSms === 2)
          underWorked.two.push({ ...item, reason: "1–4 dials, no conversation, 2 SMS" });
        else
          underWorked.threePlus.push({
            ...item,
            reason: "1–4 dials, no conversation, 3+ SMS",
          });
      }
      if (eligible && lead.firstTouchMins != null && lead.firstTouchMins > SLOW_TOUCH_MINUTES) {
        slowTouch.push({
          ...lead,
          reason: `First outbound call ${lead.firstTouchMins} min after creation`,
        });
      }
    }

    const missedDoubleTaps = Array.from(missedDoubleTapContacts.entries()).map(
      ([contactId, call]) => {
        const activity = activities.get(contactId)!;
        const calls = activity.calls.filter((candidate) => isInRange(candidate.at, range));
        const sms = activity.sms.filter((candidate) => isInRange(candidate.at, range));
        return {
          ...makeLead(activity, calls, sms),
          reason: `Unanswered outbound call at ${new Date(call.at).toISOString()} was not redialled within 2 min`,
        };
      },
    );

    const firstTouchMins = ownedActivities
      .map((activity) => makeLead(activity, [], []).firstTouchMins)
      .filter((value): value is number => value != null);
    const dials = periodCallEvents.length;
    const connectedEvents = periodCallEvents.filter((event) => event.call.connected);
    const connected = connectedEvents.length;
    const totalTalkMs = connectedEvents.reduce(
      (total, event) => total + (event.call.durationMs || 0),
      0,
    );
    const totalTalkMin = round1(totalTalkMs / MINUTE_MS);
    const avgTalkSec = connected ? round1(totalTalkMs / connected / 1000) : 0;
    const over3mCalls = connectedEvents.filter(
      (event) => (event.call.durationMs || 0) >= 180_000,
    ).length;
    const over3mPctOfConnected = connected
      ? round1((over3mCalls / connected) * 100)
      : 0;
    const workedLeads = workedContactIds.size;
    const unanswered = unansweredEvents.length;
    const doubleTaps = doubleTappedInitialIds.size;
    const connectRate = percent(connected, dials);
    const conversationRate = percent(spokeContactIds.size, workedLeads);
    const doubleTapRate = percent(doubleTaps, unanswered);
    const dialsPerLead = average(dials, workedLeads);
    const smsPerLead = average(periodSmsEvents.length, workedLeads);
    const medianFirstTouchMins = median(firstTouchMins);

    return {
      name: person.name,
      role: person.role,
      ownedLeads: ownedActivities.length,
      workedLeads,
      dials,
      connected,
      connectRate,
      totalTalkMs,
      totalTalkMin,
      avgTalkSec,
      over3mCalls,
      over3mPctOfConnected,
      spokeLeads: spokeContactIds.size,
      conversationRate,
      unanswered,
      doubleTaps,
      doubleTapRate,
      dialsPerLead,
      sms: periodSmsEvents.length,
      smsPerLead,
      medianFirstTouchMins,
      zeroTouch: zeroTouch.length,
      underWorked0Sms: underWorked.zero.length,
      underWorked1Sms: underWorked.one.length,
      underWorked2Sms: underWorked.two.length,
      underWorked3PlusSms: underWorked.threePlus.length,
      slowTouch: slowTouch.length,
      missedDoubleTaps: missedDoubleTaps.length,
      rag: {
        connectRate: higherIsBetterRag(connectRate, 85, 75),
        conversationRate: higherIsBetterRag(conversationRate, 90, 80),
        doubleTapRate: higherIsBetterRag(doubleTapRate, 80, 60),
        dialsPerLead: higherIsBetterRag(dialsPerLead, 8, 5),
        smsPerLead: higherIsBetterRag(smsPerLead, 3, 1),
        firstTouch: lowerIsBetterRag(medianFirstTouchMins, 5, SLOW_TOUCH_MINUTES),
        zeroTouch: lowerIsBetterRag(zeroTouch.length, 0, 2),
      },
      drilldowns: {
        zeroTouch: zeroTouch.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        underWorked: {
          zero: underWorked.zero.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
          one: underWorked.one.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
          two: underWorked.two.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
          threePlus: underWorked.threePlus.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        },
        slowTouch: slowTouch.sort(
          (a, b) => (b.firstTouchMins || 0) - (a.firstTouchMins || 0),
        ),
        missedDoubleTaps: missedDoubleTaps.sort(
          (a, b) => (b.lastOutboundAt || "").localeCompare(a.lastOutboundAt || ""),
        ),
      },
    };
  });

  return {
    ok: true,
    sourceNote:
      "Contacts created in the selected period; calls/SMS are HubSpot activities associated to those contacts.",
    rows,
  };
}
