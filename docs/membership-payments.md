# Membership payments in the dashboard

## Architecture and records

The dashboard owns the operator interface and accounts Gmail delivery. The Property Tool remains the shared backend for HubSpot candidate discovery, Xero reconciliation, email templates, duplicate checks and durable payment/send history. No records are exported, copied or deleted. The existing property-tool Xero connection remains in use for membership matching; the dashboard's vendor receivables connection is separate.

The dashboard forwards only an explicit allowlist of membership routes after dashboard authentication. A server-only bearer secret protects both directions. Browser session tokens and Google credentials are never forwarded to the other app.

The Property Tool sends reviewed messages to the dashboard's internal Gmail relay. The relay uses the existing `GMAIL_ACCOUNTS_CLIENT_ID`, `GMAIL_ACCOUNTS_CLIENT_SECRET` and `GMAIL_ACCOUNTS_REFRESH_TOKEN` for the accounts mailbox. Both preview and delivery show:

- From: Inner Circle Group Accounts <accounts@innercirclegroup.com.au>
- Reply-To: accounts@innercirclegroup.com.au
- CC: raul.garcia@innercirclegroup.com.au, plus the existing strategist/partner recipients, deduplicated.

Gmail delivery explicitly targets `users/accounts%40innercirclegroup.com.au/messages/send`, creating an accounts Sent item rather than relying on `me`. There is no Resend fallback or automatic retry after an ambiguous send error. The underlying Gmail OAuth authorisation must belong to accounts, not a personal mailbox.

## Deployment order

1. On Railway, open the Property Tool production service, then Variables. Use its existing `MEMBERSHIP_EMAIL_API_TOKEN`, if configured. Do not rotate an existing token without checking other callers.
2. On Railway, open the dashboard production service, then Variables. Add `MEMBERSHIP_EMAIL_API_TOKEN` with exactly the same value. If the property service does not yet have one, create a strong random secret and set the same value on both services. Do not paste secrets into chat or GitHub.
3. Deploy the dashboard change first. The three accounts Gmail credentials above should already exist for Accounts Receivable; do not replace them. Confirm that their OAuth grant belongs to accounts.
4. Deploy the Property Tool change. Its old worklist URLs now show a link to Dashboard → Membership Payments. Its strategy/joining-fee checkout workflow is not moved.
5. Sign into the dashboard and open Membership Payments. Compare the live balance, awaiting, ready-to-chase and paid records with the pre-cutover lists.
6. Open a preview. Verify the exact To, From, Reply-To, CC including Raul, subject, property and amount. Preview must not send.
7. With explicit approval, send one internal test and verify it in the accounts mailbox's Sent folder and Raul's inbox. No live test email was sent during automated QA.
8. Verify manual-paid/undo changes survive refresh and the dashboard deployment.

## Operational limits

The shared dashboard login cannot identify a particular staff member. Audit rows are honestly labelled `ICG Dashboard (shared login)`, not attributed to Raul or another person.

The Property Tool must remain running because it still owns membership records and reconciliation. A full backend/data migration is a separate change. Do not unmount or delete its persistent volume.

Automated tests use synthetic data and mocked Gmail transport, not real client email. Production mailbox visibility and live record parity require post-deploy verification.
