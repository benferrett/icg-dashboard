import { hubspot } from "./hubspot";
import type { PeriodRange } from "./period";
import { MEMBERSHIP_SOLD_STAGES, MEMBERSHIP_REFUND_STAGE, isBookingConsultant, ownerName } from "./reference";

type Props = Record<string, string | undefined>;
type History = Record<string, { hubspot_owner_id?: Array<{ value: string; timestamp?: string }> }>;
const MEMBERSHIP_PIPELINES = ["1448193481", "1446363635", "1575801320"];
const REFERRAL_STAGE = "2872614380";
const REFERRAL_ENTERED = `hs_v2_date_entered_${REFERRAL_STAGE}`;
const REFUND_ENTERED = `hs_v2_date_entered_${MEMBERSHIP_REFUND_STAGE}`;
const SOLD_ENTERED = MEMBERSHIP_SOLD_STAGES.map(id => `hs_v2_date_entered_${id}`);

export function grossMembershipEligible(p: Props): boolean {
  if (/\btest\b/i.test(p.dealname || "")) return false;
  if (p.dealstage === REFERRAL_STAGE || /\breferral\b/i.test(p.dealname || "")) return false;
  // A refunded referral is not a paid membership sale. A documented later
  // paid-tier upgrade can qualify once it has entered a real sold stage.
  const soldHistory = SOLD_ENTERED.some(key => Number.isFinite(Date.parse(p[key] || "")));
  if (p[REFERRAL_ENTERED] && !soldHistory && !MEMBERSHIP_SOLD_STAGES.includes(p.dealstage || "")) return false;
  return MEMBERSHIP_SOLD_STAGES.includes(p.dealstage || "") ||
    p.dealstage === MEMBERSHIP_REFUND_STAGE ||
    (MEMBERSHIP_PIPELINES.includes(p.pipeline || "") && !!p.membership_paid_date);
}

export function membershipSaleMs(p: Props): number {
  // HubSpot DATE properties encode a calendar day, not a UTC payment instant.
  // Align the day with the existing dashboard's AEST midnight boundaries.
  const paid = p.membership_paid_date;
  if (paid) {
    const iso = /^\d{13}$/.test(paid) ? new Date(Number(paid)).toISOString() : paid;
    const day = iso.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      const utc = Date.parse(`${day}T00:00:00Z`);
      if (Number.isFinite(utc) && new Date(utc).toISOString().slice(0, 10) === day) {
        return utc - 10 * 60 * 60 * 1000;
      }
    }
  }
  // A refunded deal's close date can be overwritten on cancellation. Prefer
  // documented original sold-stage history; only trust a legacy close date
  // when it demonstrably predates the cancellation.
  if (p.dealstage === MEMBERSHIP_REFUND_STAGE || p[REFUND_ENTERED]) {
    const sold = SOLD_ENTERED.map(key => Date.parse(p[key] || "")).filter(Number.isFinite);
    if (sold.length) return Math.min(...sold);
    const closed = Date.parse(p.closedate || "");
    const refund = Date.parse(p[REFUND_ENTERED] || "");
    return Number.isFinite(closed) && Number.isFinite(refund) && closed < refund ? closed : NaN;
  }
  // Established legacy fallback for non-refunded sales only.
  return Date.parse(p.closedate || "");
}

export function membershipBooker(p: Props, contactIds: string[], history: History): string {
  if (isBookingConsultant(p.booking_consultant)) return ownerName(p.booking_consultant);
  let earliest = Infinity;
  let owner: string | undefined;
  for (const id of contactIds) {
    for (const entry of history[id]?.hubspot_owner_id || []) {
      const at = Date.parse(entry.timestamp || "");
      if (isBookingConsultant(entry.value) && Number.isFinite(at) && at < earliest) {
        earliest = at;
        owner = entry.value;
      }
    }
  }
  // Current owner is routing, not sales credit; do not credit a strategist or
  // guess a booker when the original assignment cannot be established.
  return owner ? ownerName(owner) : "Unattributed";
}

export interface MembershipDateIssue { name: string; url: string }

export async function consultantMembershipSummary(range: PeriodRange) {
  const deals = await hubspot.searchDeals({
    filterGroups: [
      { filters: [{ propertyName: "dealstage", operator: "IN", values: [...MEMBERSHIP_SOLD_STAGES, MEMBERSHIP_REFUND_STAGE] }] },
      { filters: [
        { propertyName: "pipeline", operator: "IN", values: MEMBERSHIP_PIPELINES },
        { propertyName: "membership_paid_date", operator: "HAS_PROPERTY" },
      ] },
    ],
    properties: [
      "dealname", "pipeline", "dealstage", "booking_consultant", "membership_paid_date",
      "closedate", REFERRAL_ENTERED, REFUND_ENTERED, ...SOLD_ENTERED,
    ],
  }, 10000);
  if (deals.length >= 10000) throw new Error("Membership search reached its limit; refusing to report incomplete gross members.");
  const start = Date.parse(range.start), end = Date.parse(range.end);
  const unique = Array.from(new Map(deals.map(deal => [deal.id, deal])).values());
  const inPeriod = unique.filter(({ properties: p }) => {
    const sale = membershipSaleMs(p);
    return grossMembershipEligible(p) && Number.isFinite(sale) && sale >= start && sale < end;
  });
  const undated = unique.filter(({ properties: p }) => grossMembershipEligible(p) && !Number.isFinite(membershipSaleMs(p)));
  const missing = [...inPeriod, ...undated].filter(({ properties: p }) => !isBookingConsultant(p.booking_consultant));
  const assoc = missing.length
    ? await hubspot.batchAssociations("deals", "contacts", missing.map(d => d.id)) : {};
  const contactIds = Array.from(new Set(Object.values(assoc).flat()));
  const history: History = contactIds.length
    ? await hubspot.batchReadWithHistory("contacts", contactIds, ["hubspot_owner_id"]) : {};
  const counts: Record<string, number> = {};
  for (const { id, properties } of inPeriod) {
    const booker = membershipBooker(properties, assoc[id] || [], history);
    counts[booker] = (counts[booker] || 0) + 1;
  }
  const undatedByConsultant: Record<string, MembershipDateIssue[]> = {};
  for (const { id, properties } of undated) {
    const booker = membershipBooker(properties, assoc[id] || [], history);
    (undatedByConsultant[booker] ||= []).push({
      name: properties.dealname || "Membership with missing sale date",
      url: `https://app.hubspot.com/contacts/442187411/record/0-3/${id}`,
    });
  }
  return { counts, undatedByConsultant };
}

export async function consultantGrossMemberships(range: PeriodRange): Promise<Record<string, number>> {
  return (await consultantMembershipSummary(range)).counts;
}
