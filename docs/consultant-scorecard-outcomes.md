# Consultant scorecard outcome metrics

The Consultants page now adds four metrics to every scorecard card and the
comparison table, alongside the existing outreach metrics.

- Discovery Sessions Booked: existing consultant `dsBooked`.
- Sit rate: confirmed `dsSat / dsScheduled`, rounded to a whole percentage.
- Members: gross memberships by membership paid date, exposed as consultant `sold`.
- Membership conversion: `sold / dsSat`, rounded to a whole percentage.

The scorecard reuses the same selected-period `dashboard.consultants` payload as
Consultant Performance. Changing period updates both surfaces.
The five-person scorecard roster is unchanged; names are matched exactly, so
Patrick Nong is never confused with Patrick Van Orsouw.

A zero or missing denominator displays N/A. Actual zero results display 0 or 0%. If a
scorecard consultant has no matching performance row, counts display an em dash
and rates N/A rather than inventing zero activity. No RAG targets have been
invented for these new metrics.

The corrected backend uses membership paid date as the authoritative date,
falling back to Close Date for legacy non-refunded sales with missing/invalid paid dates. It never
dates a sale by deal creation or refund date. Paid/refunded memberships retain
the original sale date. Referral and test records are excluded.
For a refunded deal missing its paid date, original sold-stage history is
preferred; Close Date qualifies only if it demonstrably predates cancellation.
Otherwise the record is flagged in a linked, all-dates review list above the
scorecard and excluded from period counts, rather than guessed into a month.
The query includes paid-date membership deals that have moved beyond sold
stages, and deduplicates by deal ID. It refuses truncated 10,000-record results.
Booking Consultant takes precedence; missing valid booking-consultant credit
is recovered from the earliest known booking-consultant contact-owner history,
consistent with DS attribution. Current owner is not sales credit. Unresolved
memberships appear in the separate Unattributed reconciliation row.
The five-person scorecard roster does not expand to include that row.
Old dashboard snapshots are invalidated via `_consultantMembershipVersion: 1`.
This correction is scoped to the Consultants page and scorecard; unrelated
membership calculations on other dashboard tabs are not silently redefined.
Period gross members divided by period sits is not a same-booking-cohort conversion,
and may exceed 100%. The UI states that distinction and does not cap it.

The old ambiguous outreach column "Conv %" is renamed "Conversation %" to
distinguish it from membership conversion. Cards use the selected period label
rather than incorrectly saying weekly when a month/custom range is selected.

## QA inventory

- Verify all four card values match the comparison table and Consultant
  Performance for each of the five roster names.
- Change reporting month and confirm values and card period label change.
- Check zero denominators, actual zero conversion and missing-row handling.
- Confirm the original-sale-date review warning displays without adding an
  undated membership to any period's gross sales or conversion.
- Check desktop/mobile, light/dark and horizontal table scrolling.
- Confirm the existing zero-touch drilldown still opens and closes.
- Run unit tests and the production build. The pre-existing backend TypeScript
  errors documented in the preceding EOI release are outside this UI change.
