import { hubspot } from "./hubspot";
import type { PeriodRange } from "./period";
import { MEMBERSHIP_SOLD_STAGES, MEMBERSHIP_REFUND_STAGE, isBookingConsultant, ownerName } from "./reference";

type Props = Record<string, string | undefined>;
type MembershipDeal = { id: string; properties: Props };
type History = Record<string, { hubspot_owner_id?: Array<{ value: string; timestamp?: string }> }>;
const MEMBERSHIP_PIPELINES = ["1448193481", "1446363635", "1575801320"];
const REFERRAL_STAGE = "2872614380";
const REFERRAL_ENTERED = `hs_v2_date_entered_${REFERRAL_STAGE}`;
const REFUND_ENTERED = `hs_v2_date_entered_${MEMBERSHIP_REFUND_STAGE}`;
const SOLD_ENTERED = MEMBERSHIP_SOLD_STAGES.map(id => `hs_v2_date_entered_${id}`);
const MEMBERSHIP_PROPERTIES = [
  "dealname", "pipeline", "dealstage", "booking_consultant", "membership_paid_date",
  "closedate", REFERRAL_ENTERED, REFUND_ENTERED, ...SOLD_ENTERED,
];

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

export interface MembershipDateIssue { name: string; url: string; reason?: string }

function isMembershipRecord(p: Props): boolean {
  // Pipeline alone cannot establish identity: property opportunities can be
  // moved into the membership/refund pipeline. Require a named membership
  // plus CRM sale evidence; never match records by customer-name similarity.
  return MEMBERSHIP_PIPELINES.includes(p.pipeline || "") &&
    /\bmembership\b/i.test(p.dealname || "") &&
    !/\b(?:smsf|property|personal)\s+opportunity\b/i.test(p.dealname || "") &&
    grossMembershipEligible(p);
}

export async function resolveLinkedMembershipDeals(input: MembershipDeal[]) {
  const originals = Array.from(new Map(input.map(d => [d.id, d])).values());
  const byId = new Map(originals.map(d => [d.id, d]));
  const needsCheck = originals.filter(({ properties: p }) =>
    grossMembershipEligible(p) &&
    (!isMembershipRecord(p) || !Number.isFinite(membershipSaleMs(p))));
  const resolvedFrom: Record<string, string> = {};
  const linkIssues: Record<string, string> = {};
  if (!needsCheck.length) return { deals: originals, resolvedFrom, linkIssues };

  // Explicit CRM deal-to-deal links only. Do not infer identity from names,
  // shared contacts/households or which candidate has the most convenient date.
  const links = await hubspot.batchAssociations("deals", "deals", needsCheck.map(d => d.id), { strict: true });
  if (needsCheck.some(d => !Object.prototype.hasOwnProperty.call(links, d.id))) {
    throw new Error("Linked membership lookup incomplete; cannot determine date warnings.");
  }
  const missingIds = Array.from(new Set(Object.values(links).flat())).filter(id => !byId.has(id));
  if (missingIds.length) {
    const properties = await hubspot.batchRead("deals", missingIds, MEMBERSHIP_PROPERTIES, { strict: true });
    for (const id of missingIds) {
      if (!properties[id]) throw new Error("Linked membership details unavailable; cannot determine date warnings.");
      byId.set(id, { id, properties: properties[id] });
    }
  }
  for (const source of needsCheck) {
    const memberships = Array.from(new Set(links[source.id] || []))
      .filter(id => id !== source.id)
      .map(id => byId.get(id)!)
      .filter(d => d && isMembershipRecord(d.properties));
    if (memberships.length > 1) {
      linkIssues[source.id] = "Multiple linked membership deals; the original membership must be confirmed.";
      continue;
    }
    if (memberships.length === 1) {
      const target = memberships[0];
      // Two undated membership records do not resolve each other. This also
      // avoids cycles or arbitrary selection among linked, undated originals.
      if (isMembershipRecord(source.properties) && !Number.isFinite(membershipSaleMs(target.properties))) continue;
      resolvedFrom[source.id] = target.id;
    }
  }
  // Replace the source with the whole authoritative membership, including its
  // booker and date, then dedupe by its ID. Do not add a date to the opportunity.
  const canonical = new Map<string, MembershipDeal>();
  for (const source of originals) {
    const target = byId.get(resolvedFrom[source.id] || source.id)!;
    canonical.set(target.id, target);
  }
  return { deals: Array.from(canonical.values()), resolvedFrom, linkIssues };
}

export async function consultantMembershipSummary(range: PeriodRange) {
  const deals = await hubspot.searchDeals({
    filterGroups: [
      { filters: [{ propertyName: "dealstage", operator: "IN", values: [...MEMBERSHIP_SOLD_STAGES, MEMBERSHIP_REFUND_STAGE] }] },
      { filters: [
        { propertyName: "pipeline", operator: "IN", values: MEMBERSHIP_PIPELINES },
        { propertyName: "membership_paid_date", operator: "HAS_PROPERTY" },
      ] },
    ],
    properties: MEMBERSHIP_PROPERTIES,
  }, 10000);
  if (deals.length >= 10000) throw new Error("Membership search reached its limit; refusing to report incomplete gross members.");
  const start = Date.parse(range.start), end = Date.parse(range.end);
  const resolved = await resolveLinkedMembershipDeals(deals);
  const unique = resolved.deals;
  const inPeriod = unique.filter(({ properties: p }) => {
    const sale = membershipSaleMs(p);
    return grossMembershipEligible(p) && Number.isFinite(sale) && sale >= start && sale < end;
  });
  // Ambiguous sources are excluded even when the opportunity has its own date:
  // counting it as an extra membership would inflate gross results.
  const periodMembers = inPeriod.filter(d => !resolved.linkIssues[d.id]);
  const undated = unique.filter(({ id, properties: p }) => grossMembershipEligible(p) &&
    (!Number.isFinite(membershipSaleMs(p)) || !!resolved.linkIssues[id]));
  const missing = [...periodMembers, ...undated].filter(({ properties: p }) => !isBookingConsultant(p.booking_consultant));
  const assoc = missing.length
    ? await hubspot.batchAssociations("deals", "contacts", missing.map(d => d.id)) : {};
  const contactIds = Array.from(new Set(Object.values(assoc).flat()));
  const history: History = contactIds.length
    ? await hubspot.batchReadWithHistory("contacts", contactIds, ["hubspot_owner_id"]) : {};
  const counts: Record<string, number> = {};
  for (const { id, properties } of periodMembers) {
    const booker = membershipBooker(properties, assoc[id] || [], history);
    counts[booker] = (counts[booker] || 0) + 1;
  }
  const undatedByConsultant: Record<string, MembershipDateIssue[]> = {};
  for (const { id, properties } of undated) {
    const booker = membershipBooker(properties, assoc[id] || [], history);
    (undatedByConsultant[booker] ||= []).push({
      name: properties.dealname || "Membership with missing sale date",
      url: `https://app.hubspot.com/contacts/442187411/record/0-3/${id}`,
      reason: resolved.linkIssues[id] || "No reliable original sale date after checking linked membership deals.",
    });
  }
  return { counts, undatedByConsultant };
}

export async function consultantGrossMemberships(range: PeriodRange): Promise<Record<string, number>> {
  return (await consultantMembershipSummary(range)).counts;
}
