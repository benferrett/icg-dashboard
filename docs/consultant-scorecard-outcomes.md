# Consultant scorecard outcome metrics

The Consultants page now adds four metrics to every scorecard card and the
comparison table, alongside the existing outreach metrics.

- Discovery Sessions Booked: existing consultant `dsBooked`.
- Sit rate: confirmed `dsSat / dsScheduled`, rounded to a whole percentage.
- Members: existing consultant `sold`.
- Membership conversion: `sold / dsSat`, rounded to a whole percentage.

The scorecard reuses the same selected-period `dashboard.consultants` payload as
Consultant Performance. No new CRM queries, attribution rules, backend changes
or cache invalidation are required. Changing period updates both surfaces.
The five-person scorecard roster is unchanged; names are matched exactly, so
Patrick Nong is never confused with Patrick Van Orsouw.

No denominator displays N/A. Actual zero results display 0 or 0%. If a
scorecard consultant has no matching performance row, counts display an em dash
and rates N/A rather than inventing zero activity. No RAG targets have been
invented for these new metrics.

This is a display addition, not a membership-methodology migration. Members
inherit the existing Consultant Performance attribution and date rules.
Specifically, the current backend selects created-in-period deals in sold
stages; this change does not redefine that as a paid-date gross measure.
Period members divided by period sits is not a same-booking-cohort conversion,
and may exceed 100%. The UI states that distinction and does not cap it.

The old ambiguous outreach column "Conv %" is renamed "Conversation %" to
distinguish it from membership conversion. Cards use the selected period label
rather than incorrectly saying weekly when a month/custom range is selected.

## QA inventory

- Verify all four card values match the comparison table and Consultant
  Performance for each of the five roster names.
- Change reporting month and confirm values and card period label change.
- Check zero denominators, actual zero conversion and missing-row handling.
- Check desktop/mobile, light/dark and horizontal table scrolling.
- Confirm the existing zero-touch drilldown still opens and closes.
- Run unit tests and the production build. The pre-existing backend TypeScript
  errors documented in the preceding EOI release are outside this UI change.
