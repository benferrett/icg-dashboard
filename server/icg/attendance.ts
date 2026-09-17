import { hubspot } from "./hubspot";
import { DS_SAT_STAGES, stageName } from "./reference";
import { attendanceReviews, type AttendanceReview } from "./attendance-reviews";
import type { AttendanceResult } from "../../shared/attendance";

export interface DsMeeting {
  id: string;
  properties: Record<string, string | undefined>;
}
export type Associations = Record<string, string[]>;
export type Properties = Record<string, Record<string, string | undefined>>;
const satStages = new Set(DS_SAT_STAGES);
const membershipPipelines = new Set(["1448193481", "1446363635", "1575801320"]);

export const attendanceDealProperties = [
  "dealstage", "pipeline", "booking_consultant", "hubspot_owner_id",
];

// Prefer a direct membership deal. Only recover a missing membership link when
// the contacts resolve to exactly ONE membership deal. Do not pick an arbitrary
// property/contract deal or the first of several ambiguous memberships.
export function recoverMembershipAssociations(
  meetings: DsMeeting[], direct: Associations, contacts: Associations,
  contactDeals: Associations, properties: Properties,
): Associations {
  const resolved: Associations = {};
  for (const m of meetings) {
    const linked = (direct[m.id] || []).filter(
      (id) => membershipPipelines.has(properties[id]?.pipeline || ""),
    );
    const fallback = Array.from(new Set(
      (contacts[m.id] || []).flatMap((id) => contactDeals[id] || []),
    )).filter((id) => membershipPipelines.has(properties[id]?.pipeline || ""));
    resolved[m.id] = linked.length === 1 ? linked :
      linked.length === 0 && fallback.length === 1 ? fallback : [];
  }
  return resolved;
}

export async function loadAttendanceContext(
  meetings: DsMeeting[], direct: Associations, contacts: Associations,
) {
  const directIds = Array.from(new Set(Object.values(direct).flat()));
  const properties: Properties = directIds.length
    ? await hubspot.batchRead("deals", directIds, attendanceDealProperties) : {};
  const missing = meetings.filter((m) => !(direct[m.id] || []).some(
    (id) => membershipPipelines.has(properties[id]?.pipeline || ""),
  ));
  const contactIds = Array.from(new Set(missing.flatMap((m) => contacts[m.id] || [])));
  const contactDeals = contactIds.length
    ? await hubspot.batchAssociations("contacts", "deals", contactIds) : {};
  const missingIds = Array.from(new Set(Object.values(contactDeals).flat()))
    .filter((id) => !properties[id]);
  if (missingIds.length) Object.assign(properties,
    await hubspot.batchRead("deals", missingIds, attendanceDealProperties));
  return {
    dealAssoc: recoverMembershipAssociations(meetings, direct, contacts, contactDeals, properties),
    dealProps: properties,
  };
}

export function hasReviewedSat(dealId: string, now = Date.now()) {
  return attendanceReviews.some((r) =>
    r.dealId === dealId && r.status === "sat" && Date.parse(r.startTime) <= now);
}

export function classifyAttendance(
  meeting: DsMeeting, dealIds: string[], properties: Properties,
  now = Date.now(), reviews: readonly AttendanceReview[] = attendanceReviews,
): AttendanceResult {
  const start = Date.parse(meeting.properties.hs_meeting_start_time || "");
  if (!Number.isFinite(start)) return { status: "awaiting_confirmation", reason: "Session time is missing." };
  if (start > now) return { status: "upcoming", reason: "Session has not started." };
  const review = reviews.find((r) => r.meetingId === String(meeting.id) &&
    dealIds.includes(r.dealId) && Date.parse(r.startTime) === start);
  if (review) return {
    status: review.status,
    reason: `Strategist note ${review.noteId} reviewed ${review.reviewedAt}; see the deal's activity notes. CRM stage may still need updating.`,
    evidenceUrl: `https://app.hubspot.com/contacts/442187411/record/0-3/${review.dealId}`,
  };
  // In-progress sessions remain upcoming even when no deal is linked yet.
  const end = Date.parse(meeting.properties.hs_meeting_end_time || "");
  if (Number.isFinite(end) && end > now) return {
    status: "upcoming", reason: "Session is still in progress.",
  };
  for (const id of dealIds) {
    const props = properties[id] || {};
    if (satStages.has(props.dealstage || "")) {
      // Preserve the established stage-based rule: stage updates can be late.
      // Reviewed meeting-specific evidence takes precedence over current stage.
      // Do not infer the held date from the stage-entry/payment timestamp.
      return { status: "sat", reason: `CRM stage: ${stageName(props.dealstage)}.` };
    }
  }
  if (dealIds.some((id) => properties[id]?.dealstage === "2868125118")) return {
    status: "no_show_or_reschedule", reason: "CRM stage: DS No Show / To Reschedule.",
  };
  return {
    status: "awaiting_confirmation",
    reason: dealIds.length ? "No confirmed attendance outcome; review the strategist's notes." :
      "No unambiguous membership-deal link; review the contact's records.",
  };
}

// The numerator, denominator and drilldowns use the SAME unique-client rows.
// A re-sit counts once. Prefer the evidenced sat meeting, never a name match.
export function attendanceRows(
  meetings: DsMeeting[], deals: Associations, contacts: Associations,
  properties: Properties, now = Date.now(),
) {
  const rows = new Map<string, { key: string; meeting: DsMeeting; dealId?: string; attendance: AttendanceResult }>();
  const priority: Record<string, number> = {
    sat: 6, awaiting_confirmation: 5, no_show_or_reschedule: 4,
    cancelled: 3, rescheduled: 3, upcoming: 1,
  };
  for (const meeting of meetings.slice().sort((a, b) =>
    (a.properties.hs_meeting_start_time || "").localeCompare(b.properties.hs_meeting_start_time || ""))) {
    const ids = deals[meeting.id] || [];
    const cids = contacts[meeting.id] || [];
    const key = ids.length === 1 ? `d:${ids[0]}` :
      cids.length === 1 ? `c:${cids[0]}` : `m:${meeting.id}`;
    const attendance = classifyAttendance(meeting, ids, properties, now);
    const prior = rows.get(key);
    if (!prior || priority[attendance.status] > priority[prior.attendance.status])
      rows.set(key, { key, meeting, dealId: ids[0], attendance });
  }
  return Array.from(rows.values());
}
