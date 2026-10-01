# Gross EOI reporting

An EOI is an activity milestone, not a current-pipeline balance. Overview,
Business Performance, Contracts and the 2026 report share the same EOI date
resolver and property-pipeline query.

- Gross EOIs use `eoi_paid_date`, falling back to the earliest valid EOI
  stage-entry timestamp if the paid date is unavailable.
- Later progression, cancellation or missing strategist attribution does not
  remove the original EOI. Unknown strategist credit appears as Unattributed.
- EOI refunds use the date the deal entered EOI Cancelled. They are displayed
  separately, never deducted from gross. A later stage move does not erase the
  recorded cancellation event.
- A September EOI cancelled in October counts as one gross September EOI and
  one October refund. A September cancellation of an August EOI does not add a
  September gross EOI.
- These are deal counts, not unique-client counts or cash refunds reconciled
  against bank receipts. Two property deals for one client count as two EOIs.
- Obvious test-named deals are excluded. A missing milestone date is not
  inferred from creation or close date. A missing cancellation date is not
  inferred from the original close date.
- Property Sales is searched regardless of current stage. Attribution work
  skips early opportunities without a milestone or contract stage.
- Old aggregate snapshots are invalidated using `_eoiReportingVersion: 1`.
  Searches reaching the 10,000-record ceiling fail rather than silently show
  incomplete totals.

Membership counting and UC eligibility are unchanged by this EOI-specific
release. The existing global reporting timezone/bucket implementation is
unchanged.

## Verification

`npm test` exercises date precedence, same/cross-month refunds, local month
boundaries, progressed deals, property-stage movement, unattributed deals,
test exclusion, missing dates, weekly totals and cross-view reconciliation.

The preview uses synthetic data and the actual Overview/Business Performance
components. QA covers month/week switches, the separate cards, chart legend and
table columns, zero-EOI/nonzero-refund periods, all-zero activity, desktop/mobile
overflow and light/dark rendering.

The production build passes. The repository-wide TypeScript check still reports
six pre-existing backend errors (iteration target and optional forecast dates),
verified against the unchanged main-branch checkout. This change removes three
pre-existing EOI/refund API typing errors and introduces no new check errors.
