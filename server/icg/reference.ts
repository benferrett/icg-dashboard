// Reference data for Inner Circle Group HubSpot portal (account 442187411)
// Owner IDs -> names (used when the live owners API scope is unavailable)

export const OWNERS: Record<string, string> = {
  "50246816": "Ayaz Madhiya",
  "70227876": "Simon Dane",
  "78011708": "Jemina Numos",
  "79594731": "Alexa Rosales",
  "82710130": "Ben Ferrett",
  "87052837": "Ace Evangelista",
  "88976933": "Kellie Dane",
  "360492591": "Jean-Jerome Vacher",
  "360721384": "Lukas Jessop",
  "361455466": "Ben Houghton",
  "361919740": "Steven Mau",
  "361919911": "Steven Mau",
  "362352488": "Patrick Van Orsouw",
  "362495114": "Akhil Venugopal",
  "362496198": "Alina Pariyar",
  "362741341": "Steven Green",
  "363101784": "System Architect",
  "363184380": "Rob Gallacher",
  "363222039": "Renee O'Connell",
  "363808537": "Moses Emmanuel",
  "363811156": "Moses Emmanuel",
  "364595873": "Raul Garcia",
};

export function ownerName(id?: string | null): string {
  if (!id) return "Unassigned";
  return OWNERS[id] || `Owner ${id}`;
}

// Pipelines
export const PIPELINES: Record<string, string> = {
  "1446363635": "Consultants Pipeline",
  "1448193481": "Membership Pipeline",
  "1527507417": "Property Sales Pipeline",
  "1578114550": "Contract Pipeline",
  "1814691263": "Land and 1 Part Settlement",
  "1841864138": "2 Part - Construction",
  "1575801320": "Do Not Contact/DNQ",
};

export function pipelineName(id?: string | null): string {
  if (!id) return "Unknown";
  return PIPELINES[id] || id;
}

// Deal stages (id -> label)
export const STAGES: Record<string, string> = {
  "2399433174": "New Lead",
  "3040945601": "Easy Property Leads",
  "2868125118": "DS No Show / To Reschedule",
  "2639381966": "Nurture",
  "2639381968": "New Not Interested",
  "2399433175": "First Contact Attempt",
  "2399433176": "Second Contact Attempt",
  "2399433177": "Third Contact Attempt",
  "2399433178": "Fourth Contact Attempt",
  "2399433179": "Fifth Contact Attempt",
  "2399433180": "Sixth Contact Attempt",
  "2546757056": "Seventh Contact Attempt",
  "2400252392": "Eighth Contact Attempt",
  "2639381960": "Ninth Contact Attempt",
  "2639381961": "Tenth Contact Attempt",
  "2924092907": "Incomplete Info N/A",
  "2924092908": "Over 65 N/A",
  "2639381967": "March Leads to Allocate",
  "2981546459": "Pre March 2026 Leads",
  "2870714823": "Discovery Session Booked",
  "2400252396": "DS Sat - Follow up Required",
  "2400252397": "DS Sat - Follow Up Booked",
  "2697062899": "DS Sat - Nurture 3 month+",
  "2400252401": "DS Sat - Bronze Membership Sold",
  "2399433181": "DS Sat - Silver Membership Sold",
  "2547683827": "DS Sat - Gold Membership Sold",
  "2872614380": "Referral Membership",
  "3057158608": "DS Sat - DNQ",
  "2400252399": "DS Sat - Missed",
  "3152097752": "DS Sat - Membership Cancelled/Refund",
  "2546761181": "Property Opportunity",
  "2981493180": "30 min Meeting Booked",
  "2546761182": "Referred to SMSF Provider",
  "2546761183": "Entity Details Created",
  "2546761184": "Ready 12 Months +",
  "2546761185": "Ready 6 - 12 Months",
  "2546761186": "Portfolio Acquisition Meeting Booked",
  "2546761188": "Follow Up Booked",
  "2546761189": "Did Not Buy",
  "3051561412": "EOI Signed, EOI Paid",
  "2639405543": "EOI & Deposit Receipt Sent - Contract Requested",
  "2639405544": "ICG Issued Contracts",
  "2639405545": "Vendor Issued Contracts",
  "2639405546": "Contract Signed Awaiting Exchange",
  "2639405547": "Fully Executed - Awaiting Cash Deposit",
  "2639405548": "Fully Executed - Awaiting Refi Deposit",
  "2639368657": "Fully Executed - Awaiting SMSF Deposit",
  "2639368658": "Awaiting Conditions",
  "3113781723": "Fully Executed/Uncon - Deposit Paid",
  "3112795614": "EOI Cancelled",
  // Land and 1 Part Settlement pipeline
  "3102861791": "Unconditional Contract Handover to Settlements",
  "3102861792": "Welcome/Updates Email",
  "3102861793": "120 Days from Settlement",
  "3102861794": "90 Days from Settlement",
  "3102861795": "60 Days from Settlement",
  "3102861796": "30 Days from Settlement",
  "3102861797": "Settlement Week",
  "3102861798": "Settled",
  "3103789531": "1 Part - Property Manager Handover",
  "3103789532": "2 Part - Intro Into Construction",
  "3103789533": "Not Settled - Lost",
  // 2 Part - Construction pipeline
  "3147236833": "Welcome/Updates Email",
  "3147236832": "Land Settled - Awaiting Construction",
  "3147236834": "Slab Stage Completed",
  "3147236835": "Frame Stage Completed",
  "3147236836": "Lock Up Stage Completed",
  "3147236837": "Fixing Stage Completed",
  "3147236838": "Practical Completion Approaching",
  "3147236839": "Practical Completion Received",
  "3147236840": "Property Manager Handover",
  "3147236841": "30 Days Post Settlement",
  "3147855313": "Post 3 Months Handover",
  "3147236842": "Unable to Build",
};

export function stageName(id?: string | null): string {
  if (!id) return "Unknown";
  return STAGES[id] || id;
}

// Key stage groupings for funnel + membership metrics
export const MEMBERSHIP_STAGES = {
  bronze: "2400252401",
  silver: "2399433181",
  gold: "2547683827",
};

export const DISCOVERY_BOOKED_STAGE = "2870714823";

// Booking consultants who work fresh leads + book Discovery Sessions.
// Maps every owner-id variant -> canonical name. Ben Houghton is Head of
// Consultants (separate comp plan) but still books, so he's included here.
export const BOOKING_CONSULTANTS: Record<string, string> = {
  "362741341": "Steven Green",
  "363811156": "Moses Emmanuel",
  "363808537": "Moses Emmanuel",
  "362495114": "Akhil Venugopal",
  "361455466": "Ben Houghton",
};

// True only for the booking-consultant team. Used to attribute a DS booking to
// the genuine consultant and to REJECT strategists/contract-team owners that
// later take over the contact (so they never appear in the consultant table).
export function isBookingConsultant(id?: string | null): boolean {
  return !!id && id in BOOKING_CONSULTANTS;
}

// Discovery Session meetings are titled "Inner Circle Group Discovery Session: …".
// Title-matching is required because many DS meetings lack an activity-type.
export const DS_TITLE_PREFIX = "Inner Circle Group Discovery Session";

// A deal in any "DS Sat - …" stage means the prospect ATTENDED (sat) the discovery
// session. We validate sat from the associated deal's stage rather than the raw
// meeting outcome (the team leaves most held sessions as SCHEDULED, so the outcome
// field massively over-counts — it once produced 90 for June vs the true 68).
// Consultants are paid on sat sessions, so this must be exact.
//
// Per Ben (ICG): "DS Sat - Missed" DOES count as a sit — the prospect attended and
// "Missed" refers to a later follow-up, not the DS itself. The genuinely-not-sat
// stages are "Discovery Session Booked", "DS No Show / To Reschedule",
// "Not Interested", the consultants-pipeline "Nurture", and Referral — none of
// which appear in this list.
export const DS_SAT_STAGES = [
  "2400252396", // DS Sat - Follow up Required
  "2400252397", // DS Sat - Follow Up Booked
  "2697062899", // DS Sat - Nurture 3 month+
  "2400252401", // DS Sat - Bronze Membership Sold
  "2399433181", // DS Sat - Silver Membership Sold
  "2547683827", // DS Sat - Gold Membership Sold
  "3057158608", // DS Sat - DNQ (they sat, then did not qualify)
  "3152097752", // DS Sat - Membership Cancelled/Refund (sat, then cancelled)
  "2400252399", // DS Sat - Missed (they SAT; "Missed" = missed follow-up, per Ben)
];

// Membership-sold stages keyed by tier (for sold-this-period counting via
// hs_v2_date_entered_<stageId>).
// NOTE: Referral memberships (2872614380) are intentionally EXCLUDED — per Ben,
// referrals are not counted as sales.
export const MEMBERSHIP_SOLD_TIERS: Record<string, string> = {
  "2400252401": "Bronze",
  "2399433181": "Silver",
  "2547683827": "Gold",
};

// Stages that represent a "won" membership (sold).
// NOTE: Referral memberships (2872614380) are intentionally EXCLUDED — referrals
// don't count as sales.
export const MEMBERSHIP_SOLD_STAGES = [
  "2400252401", // Bronze
  "2399433181", // Silver
  "2547683827", // Gold
];

// ---- CONTRACT FUNNEL ------------------------------------------------------
// Ben's 5-step contract funnel. Each deal counts ONCE in its CURRENT stage.
// UC additionally includes ALL settlement-pipeline deals (see CONTRACT_UC_PIPELINES).
// Excludes EOI Cancelled (3112795614) entirely.
export const CONTRACT_PIPELINE = "1578114550";

export const CONTRACT_FUNNEL_STEPS: { key: string; label: string; stages: string[] }[] = [
  {
    key: "eoi",
    label: "EOI Received",
    stages: [
      "3051561412", // EOI Signed, EOI Paid
      "2639405543", // EOI & Deposit Receipt Sent - Contract Requested
    ],
  },
  {
    key: "issued",
    label: "Contracts Issued",
    stages: [
      "2639405544", // ICG Issued Contracts
      "2639405545", // Vendor Issued Contracts
    ],
  },
  {
    key: "signed",
    label: "Contracts Signed",
    stages: [
      "2639405546", // Contract Signed Awaiting Exchange
    ],
  },
  {
    key: "exchanged",
    label: "Contracts Exchanged",
    stages: [
      "2639405547", // Fully Executed - Awaiting Cash Deposit
      "2639405548", // Fully Executed - Awaiting Refi Deposit
      "2639368657", // Fully Executed - Awaiting SMSF Deposit
      "2639368658", // Awaiting Conditions
    ],
  },
  {
    key: "uc",
    label: "Unconditional (UC)",
    stages: [
      "3113781723", // Fully Executed/Uncon - Deposit Paid
    ],
  },
];

// Settlement pipelines: ANY deal in these counts as UC.
export const CONTRACT_UC_PIPELINES = [
  "1814691263", // Land and 1 Part Settlement
  "1841864138", // 2 Part - Construction
];

// Pipelines that can hold an EOI ("EOI Signed, EOI Paid") deal. The Property
// Sales pipeline shares the SAME EOI stage id (3051561412) as the Contract
// pipeline, so a client who signs/pays an EOI while still on the Property Sales
// board is a real EOI sale and MUST be counted. We pull it alongside the
// Contract pipeline so those EOIs are never missed. Property Sales deals only
// ever reach the EOI milestone here (they have no UC / settlement stages), so
// including the pipeline cannot inflate UC.
export const CONTRACT_EOI_PIPELINES = [
  "1527507417", // Property Sales Pipeline
];

// Stage explicitly excluded from the contract funnel (lost / cancelled).
export const CONTRACT_EXCLUDE_STAGES = ["3112795614"]; // EOI Cancelled

// Strategist owner IDs. Contract/settlement deals are owned by the contract
// team (Raul Garcia), so strategist attribution for contracts must come from
// the associated CLIENT CONTACT's owner. When a deal has multiple contacts we
// prefer one whose owner is a known strategist.
// Consultants (Moses, Akhil) and the contract team (Raul) are deliberately
// EXCLUDED so they can never be credited a contract via the contact-owner
// fallback. Ben is included because a contract may legitimately belong to him.
export const STRATEGIST_OWNERS: Record<string, string> = {
  "362352488": "Patrick Van Orsouw",
  "363222039": "Renee O'Connell",
  "363184380": "Rob Gallacher",
  "361919911": "Steven Mau",
  "361919740": "Steven Mau",
  "82710130": "Ben Ferrett",
};

export function isStrategistOwner(id?: string | null): boolean {
  return !!id && id in STRATEGIST_OWNERS;
}

// Lowercased name tokens -> strategist owner id, used to derive the handling
// strategist from a deal's ACTIVITY (meeting titles, note bodies, call titles)
// when no strategist field / strategist contact-owner is set. Excludes Ben on
// purpose: a Ben mention in activity text is almost always admin, not delivery.
export const STRATEGIST_NAME_TOKENS: Record<string, string> = {
  patrick: "362352488",
  "van orsouw": "362352488",
  orsouw: "362352488",
  renee: "363222039",
  "o'connell": "363222039",
  oconnell: "363222039",
  rob: "363184380",
  gallacher: "363184380",
  "steven mau": "361919911",
};

// Map every contract-funnel stage id -> funnel step key, for fast lookup.
export const CONTRACT_STAGE_TO_STEP: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const step of CONTRACT_FUNNEL_STEPS) {
    for (const s of step.stages) m[s] = step.key;
  }
  return m;
})();

// ---- MILESTONE STAGES (cumulative) ----------------------------------------
// An EOI is a MILESTONE that a deal achieves: once it has entered an EOI stage
// it counts as an EOI done, even if it has since progressed to Contracts
// Issued / Exchanged / UC. We detect the milestone via the per-deal
// hs_v2_date_entered_<stageId> timestamp, which HubSpot retains for every
// stage the deal has passed through within its pipeline.
// EOI milestone = entered either EOI stage.
export const CONTRACT_EOI_STAGES = [
  "3051561412", // EOI Signed, EOI Paid
  "2639405543", // EOI & Deposit Receipt Sent - Contract Requested
];

// UC milestone = reached Unconditional. In the Contract pipeline this is the
// 3113781723 stage; in the settlement pipelines ANY deal is already UC.
export const CONTRACT_UC_STAGE = "3113781723";

export const SOURCE_LABELS: Record<string, string> = {
  ORGANIC_SEARCH: "Organic Search",
  PAID_SEARCH: "Paid Search",
  EMAIL_MARKETING: "Email Marketing",
  SOCIAL_MEDIA: "Organic Social",
  REFERRALS: "Referrals",
  OTHER_CAMPAIGNS: "Other Campaigns",
  DIRECT_TRAFFIC: "Direct Traffic",
  OFFLINE: "Offline",
  PAID_SOCIAL: "Paid Social",
  AI_REFERRALS: "AI Referrals",
};

export function sourceLabel(id?: string | null): string {
  if (!id) return "Unknown";
  return SOURCE_LABELS[id] || id;
}

// ---- Booking lead-source attribution ----------------------------------------
// A Discovery Session only counts as a BOOKING if the associated contact's lead
// source is EMBR or META (paid social). Every other source is excluded:
//   * EMBR  = contact tagged lead_source == "EMBR" (equivalently embr_lead_id set)
//   * META  = hs_analytics_source == "PAID_SOCIAL" (Facebook/Instagram ads)
//   * EXCLUDE = DIRECT_TRAFFIC (strategist personal booking links, e.g.
//               meetings-ap1.hubspot.com/{strategist}/intro-to-icg), OFFLINE,
//               ORGANIC_SEARCH, REFERRALS, and anything else.
// Returns "EMBR", "META", or null (excluded).
export function bookingSourceOf(
  contactProps?: {
    lead_source?: string | null;
    embr_lead_id?: string | null;
    hs_analytics_source?: string | null;
  } | null,
): "EMBR" | "META" | null {
  if (!contactProps) return null;
  if (contactProps.lead_source === "EMBR" || contactProps.embr_lead_id) {
    return "EMBR";
  }
  if (contactProps.hs_analytics_source === "PAID_SOCIAL") return "META";
  return null;
}

// The contact properties needed to classify a booking's lead source.
export const BOOKING_SOURCE_PROPS = [
  "lead_source",
  "embr_lead_id",
  "hs_analytics_source",
];
