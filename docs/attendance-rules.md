# Discovery session attendance

The show-up rate is unchanged: **confirmed sat / all unique clients scheduled in
the selected held-date window**. Upcoming and unresolved outcomes remain in that
denominator; the interface explicitly describes the result as provisional.
Changing the denominator to completed outcomes would inflate the historical
comparison and is outside this fix.

## Evidence and identity

- Keep the existing DS Sat stage definition, including DS Sat - Missed.
- Do not infer attendance or absence from the meeting outcome field.
- Reviewed strategist-note evidence can correct a missing CRM update. Reviews
  carry meeting ID, deal ID, exact start time, note ID and review date in
  `server/icg/attendance-reviews.ts`. No membership tier, sale or payment is
  inferred from attendance.
- Reviews are explicit, auditable decisions, not automatic keyword matching on
  notes. To add one, inspect the strategist's actual post-session note and confirm
  its association and held date. Booking confirmations are not attendance proof.
- A missing direct meeting-to-deal link can resolve via the contact, but only to
  one unambiguous membership/consultant/DNQ deal. Never guess between multiple
  memberships or treat a property contract as a discovery session.
- Counts and consultant status rows share one CRM-ID grouping. Names are display
  text only. A re-sit within the same window counts once.
- Future/in-progress sessions are not counted as attended.
- The ordinary stage-based rule retains its known limitation: current stage
  alone cannot prove which of several historical appointments was attended.
  Meeting-specific reviewed evidence takes precedence. Do not use stage-entry
  dates as attendance dates: real stage updates are often delayed.

## Statuses

Sat; no-show / to reschedule (the exact combined CRM stage); cancelled;
rescheduled; awaiting confirmation; upcoming / in progress.

No matching sat evidence is **awaiting confirmation**, not a confirmed no-show.
Summary cards therefore say "Not confirmed sat" rather than turning the residual
scheduled-minus-sat count into a no-show claim.

## Reporting and rollout

Overview, Consultants, Strategists, source funnel, Business Performance and the
annual DS reporting use the corrected shared held-window attendance calculation.
Marketing BETA's lifetime cohort sat count also recognises reviewed attendance,
without inferring a membership sale. Business Performance's scheduled population
now matches its existing all-channel sat population and the Overview denominator.
Bookings retain their existing source boundaries.

Computed attendance snapshots are versioned so pre-fix disk snapshots cannot
reintroduce false no-show displays after redeployment. HubSpot records, payment
dates, memberships, accounts receivable and commission rules are not modified.

## QA inventory

- Regression tests: reviewed sat/date scoping, unknown outcomes, no-show stage,
  DS Sat - Missed, future sessions, late stage updates, missing/ambiguous links,
  repeat meetings, identical names, cancellations and connector failure.
- Replay the reviewed 14–16 September 2026 session records privately; reconcile
  headline counts with consultant/source/strategist totals and row statuses.
- Browser: desktop and mobile status rows; evidence links; Overview quality
  notice; unknown/future/error states; no name-based red-cross matching.
- Production validation requires authenticated dashboard access after deploy.

## Validation completed 17 September 2026

- 15 automated tests pass, including an end-to-end discovery-session aggregation
  test reconciling consultant, strategist, source and client-row totals.
- Private replay of 11 audited DS meetings held 14–16 September: old stage/direct
  association logic counted 4 sat; corrected logic counts 6 sat, 1 awaiting
  confirmation, 1 cancelled, 1 rescheduled and 2 no-show/to-reschedule. This is an
  audited sample, not a claim that all historical outcomes have been reviewed.
- Production build passes. After rebasing onto the latest production update
  (Patrick Nong reporting, PR #23), all three Patrick regression tests also pass.
  The full TypeScript check reports nine remaining baseline errors: missing
  refund types, iterator target settings and optional forecast dates. PR #23
  already removed the duplicate owner-map key. No new errors introduced.
- Browser QA of the actual Overview, Consultants and Marketing components with
  synthetic data: 1440px and 375px widths, no document overflow or page errors.
  Verified 55% display, six green sat marks, one amber pending mark, four explicit
  non-attendance marks, empty/loading/error states and theme switching.
- Reviewed-evidence links open the associated deal activity record. Note IDs are
  included in the row's explanatory tooltip; logged-in HubSpot link verification
  and live dashboard verification remain rollout checks.
