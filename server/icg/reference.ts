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

// Discovery Session meetings are titled "Inner Circle Group Discovery Session: …".
// Title-matching is required because many DS meetings lack an activity-type.
export const DS_TITLE_PREFIX = "Inner Circle Group Discovery Session";

// Every "DS Sat - …" stage means the session was actually sat (held). Used to
// validate sat sessions from the associated deal rather than trusting the raw
// meeting outcome. Consultants are paid on sat sessions, so this must be exact.
export const DS_SAT_STAGES = [
  "2400252396", // DS Sat - Follow up Required
  "2400252397", // DS Sat - Follow Up Booked
  "2697062899", // DS Sat - Nurture 3 month+
  "2400252401", // DS Sat - Bronze Membership Sold
  "2399433181", // DS Sat - Silver Membership Sold
  "2547683827", // DS Sat - Gold Membership Sold
  "3057158608", // DS Sat - DNQ
  "2400252399", // DS Sat - Missed
  "3152097752", // DS Sat - Membership Cancelled/Refund
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
