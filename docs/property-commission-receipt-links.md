# Property commission receipt links

## Purpose

Accounts Receivable tracks property commissions owed to ICG, not outgoing commissions. The new receipt picker links recorded Xero cash receipts to state-company sales invoices and marks cash received in the dashboard. It does not create payments, change invoices, post intercompany entries or write to Xero.

## Operator flow

- Open Accounts Receivable and choose **Link Xero payment** on an invoice.
- The receipt organisation defaults to central Inner Circle Group Pty Ltd. The invoice's own state organisation is also available.
- Only receipts matching the invoice's current **AmountDue**, exactly in cents, are listed. An invoice that has already been partly paid uses its remaining balance, not its original total.
- Search the matching results by vendor, reference or invoice. Review the organisation, property/reference, date and bank-reconciliation status.
- Explicitly confirm **Link receipt and mark received**. The invoice moves out of the overdue workload into **Cash received (pending)**.
- Saved receipt evidence appears on the invoice and in **Payment link history**. History remains even after Xero removes a settled invoice from the open list.
- Removing a link requires confirmation and retains an audit trail. It never changes Xero or deletes a separate manual-paid override.

## Accounting safeguards

- Both the sales invoice and receipt are re-read from Xero at confirmation. Client-supplied amounts and status cannot mark an invoice received.
- Only positive, dated AUD receipts for the exact current outstanding balance can be linked.
- A receipt cannot be actively linked to two AR invoices; an invoice cannot have two active full-balance links. Retries are idempotent.
- Invoice payments from the invoice's own organisation already affect Xero invoice balances, so they cannot be counted again. Central-company receipts can support cross-company collection evidence, subject to staff confirmation.
- Same-dollar results are candidates, not automatic matches. Property/vendor ownership must be confirmed.
- A deleted, reversed, changed or invalid receipt returns an open invoice to review. Follow-up sending remains blocked until the evidence is reviewed.
- A Xero outage retains saved evidence as unverified, rather than silently restoring collection activity.
- Existing manual-paid records remain separate. Follow-up preview and send are blocked for manual-paid invoices and invoices with active receipt links; the send path also checks the current outstanding amount.
- Commission emails retain the accounts mailbox sender and Sent-folder delivery path. Raul is always included in CC; replies go to accounts.
- Invoice and receipt collection endpoints are paginated. Failed reads do not become empty-success responses.

## Boundaries

The picker is deliberately one receipt to one exact outstanding invoice balance. Bundled remittances, split receipts and allocation between invoices require separate review; they are not silently distributed. Duplicate protection applies within this AR receipt-link store, not across unrelated external accounting systems. Raw unreconciled bank-feed lines are not exposed by these accounting-record endpoints.

Xero invoice, payment and recorded bank transaction API documentation: https://developer.xero.com/documentation/api/accounting/invoices ; https://developer.xero.com/documentation/api/accounting/payments ; https://developer.xero.com/documentation/api/accounting/banktransactions

## Deployment

Dashboard-only deployment. The additive receipt-link table uses the existing durable AR database on the Railway volume. No new credentials or Xero write permissions are required. Existing Accounts Receivable snapshots are versioned out once so the first read includes receipt evidence and history.

Tests use synthetic records only. Live verification must not link a real receipt or send an email unless separately authorised for that exact action.
