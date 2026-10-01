import {
  CONTRACT_PIPELINE, CONTRACT_UC_PIPELINES, CONTRACT_EOI_PIPELINES,
  CONTRACT_EOI_STAGES, CONTRACT_EOI_REFUND_ENTERED_PROP,
} from "./reference";

export const EOI_PAID_DATE_PROP = "eoi_paid_date";

// Pull whole property pipelines: current stage is not proof that a historical
// milestone did (or did not) happen. HubSpot search deduplicates the IN query.
export function eoiPipelineFilterGroups() {
  return [{
    filters: [{
      propertyName: "pipeline", operator: "IN",
      values: Array.from(new Set([CONTRACT_PIPELINE, ...CONTRACT_UC_PIPELINES, ...CONTRACT_EOI_PIPELINES])),
    }],
  }];
}

export function eoiMilestoneMs(props: Record<string, any>): number {
  // HubSpot date fields encode the calendar date at midnight UTC. Bucket the
  // calendar date itself; do not use close date, creation date or current stage.
  const paid = props[EOI_PAID_DATE_PROP] ? Date.parse(props[EOI_PAID_DATE_PROP]) : NaN;
  if (Number.isFinite(paid)) return paid;
  const entered = CONTRACT_EOI_STAGES
    .map(id => Date.parse(props[`hs_v2_date_entered_${id}`] || ""))
    .filter(Number.isFinite);
  return entered.length ? Math.min(...entered) : NaN;
}

export function eoiRefundMs(props: Record<string, any>): number {
  // Retain the dated cancellation event even if the deal later moves again.
  // A missing event date is unknown, not the original sale's close date.
  return Date.parse(props[CONTRACT_EOI_REFUND_ENTERED_PROP] || "");
}

export function isEoiTestRecord(props: Record<string, any>): boolean {
  return /\btest\b/i.test(String(props.dealname || ""));
}
