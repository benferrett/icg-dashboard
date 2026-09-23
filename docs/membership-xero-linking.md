# Membership Xero payment links

## Operator flow

Dashboard → Membership Payments → Payment follow-up → Link Xero payment.

Search by client, payment reference, invoice number or amount, with an adjustable date range. Select a receipt, review its organisation, date and amount, confirm that it belongs to the member, then choose **Link payment and mark paid** or **Link part payment**.

The feature links existing Xero records to the dashboard only. It does not create payments, reconcile bank-feed lines, modify invoices or write anything to Xero. The source is the existing membership connection to Inner Circle Group Pty Ltd.

## Payment evidence and safeguards

- Xero is re-read by receipt ID at confirmation. The browser cannot supply the authoritative amount, currency or paid flag.
- Active receipt allocations are unique by Xero organisation, source and receipt ID. One receipt cannot settle two different memberships.
- Partial payments retain the outstanding remainder. Reminder previews and send checks use that remainder, not the original balance.
- The saved evidence includes receipt ID, original receipt amount, amount applied, reference, invoice number where available, date, organisation and linking actor.
- Removing a link retains its audit record. No Xero transaction is deleted or edited.
- A changed, deleted or reversed linked receipt no longer counts as verified payment evidence. Follow-up sending is blocked pending review.
- During a Xero outage, saved links remain visible as unverified and follow-up sending is blocked. Explicit manual-paid overrides remain intact.
- Automatic settlement now requires a dated AUD receipt with both the full amount and a member-name signal, uniquely attributable to one member. A surname alone, unknown name, partial payment, foreign-currency receipt or ambiguous same-surname match cannot mark the full balance paid.
- The dashboard uses a shared staff login, so audit attribution is honestly shown as `ICG Dashboard (shared login)`.

## Xero API boundaries

Invoice payments use the Xero Payments endpoint. Receive-money records use BankTransactions; these are recorded accounting transactions, not raw bank-feed statement lines. Both endpoints are paged and a failed page is surfaced as unavailable reconciliation, never an empty-success result.

Xero documentation: https://developer.xero.com/documentation/api/accounting/payments and https://developer.xero.com/documentation/api/accounting/banktransactions

## Deployment and verification

Deploy the Property Tool backend first, then the dashboard UI. No new Xero authorisation or credentials should be required. The new SQLite table is additive and uses the existing persistent Property Tool volume.

Test with synthetic receipts before deployment. Production checks should be read-only unless a user approves an exact real receipt/member link. Existing automatic paid classifications may return to review when they do not meet the corrected full-amount matching rules; no stored manual-paid flags are removed.
