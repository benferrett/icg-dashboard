// Accounts Receivable reconciliation for the ICG dashboard.
//
// Pulls open invoices from all three state-entity Xero tenants (VIC/QLD/WA) in
// parallel, applies local "marked paid" overrides, and classifies each into one
// of four business buckets used by the weekly report and the dashboard UI.
//
// BUCKETS:
//   - overdue                — invoiced, due date has passed, no override.
//   - within_terms           — invoiced, still within the vendor's terms.
//   - cash_received_pending  — a local override marks the invoice as paid but
//                              the Xero clearing entry hasn't landed yet. The
//                              invoice stays visible so we don't lose track,
//                              but it doesn't count against "overdue".
//   - earned_not_invoiced    — a HubSpot UC deal exists whose commission
//                              hasn't been invoiced yet. Populated separately
//                              (see TODO); the weekly report can use the first
//                              three buckets on their own.

import {
  XERO_TENANTS,
  listOpenInvoices,
  getContact,
  type XeroInvoice,
  type XeroTenant,
} from "./xero";
import { listOverrides, type InvoiceOverride } from "./ar-overrides";

export type ArBucket =
  | "overdue"
  | "within_terms"
  | "cash_received_pending"
  | "earned_not_invoiced";

export interface OpenInvoice {
  invoice_id: string;
  tenant_id: string;
  tenant_name: string;
  state: "VIC" | "QLD" | "WA";
  invoice_number: string;
  contact_id: string | null;
  contact_name: string | null;
  contact_email: string | null; // enriched via getContact when available
  reference: string | null;
  date_iso: string | null;
  due_date_iso: string | null;
  amount_due: number;
  total: number;
  days_overdue: number; // negative when still within terms
  is_overdue: boolean;
  bucket: ArBucket;
  override?: {
    marked_paid_at_iso: string;
    marked_by: string | null;
    note: string | null;
  };
}

export interface UnpaidInvoicesResult {
  invoices: OpenInvoice[]; // active (not-yet-paid or pending-clear) rows
  cleared: OpenInvoice[]; // rows that carry a paid-override (kept for UI + audit)
}

function toIsoDate(d: Date | null): string | null {
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromMs: number, toMs: number): number {
  const DAY = 24 * 60 * 60 * 1000;
  return Math.floor((toMs - fromMs) / DAY);
}

// --- Contact enrichment ---------------------------------------------------
// Fetching each contact one-by-one on every AR page load would be wasteful, so
// we memoise vendor emails per (tenant, contactId) for the process lifetime.
// The set of vendors changes slowly enough that a periodic cache-clear (on
// server restart) is fine; if an email really needs refreshing, `?refresh=1` on
// the AR endpoint will force a rebuild of the invoice list but not (yet) the
// contact cache. Acceptable trade-off — emails almost never change silently.
const contactEmailCache = new Map<string, string | null>(); // key = `${tenant}:${contactId}`

async function enrichContactEmails(
  invoices: Array<{ tenant_id: string; contact_id: string | null }>,
): Promise<Map<string, string | null>> {
  const needed = new Map<string, { tenant_id: string; contact_id: string }>();
  for (const inv of invoices) {
    if (!inv.contact_id) continue;
    const key = `${inv.tenant_id}:${inv.contact_id}`;
    if (contactEmailCache.has(key)) continue;
    needed.set(key, { tenant_id: inv.tenant_id, contact_id: inv.contact_id });
  }
  // Bounded concurrency so we don't storm Xero — 4 in flight is safely under
  // Xero's per-second cap (60/min sustained, 5/sec burst).
  const entries = Array.from(needed.entries());
  const LIMIT = 4;
  let cursor = 0;
  async function worker() {
    while (cursor < entries.length) {
      const i = cursor++;
      const [key, { tenant_id, contact_id }] = entries[i];
      try {
        const c = await getContact(tenant_id, contact_id);
        contactEmailCache.set(key, c?.EmailAddress || null);
      } catch {
        contactEmailCache.set(key, null);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(LIMIT, entries.length) }, worker));
  return contactEmailCache;
}

// Classify a single invoice into a bucket, given the current time + optional
// override. Encapsulates the business rules in one place so the weekly report
// and the API return identical numbers.
function classify(
  inv: XeroInvoice,
  override: InvoiceOverride | undefined,
  now: Date,
): { bucket: ArBucket; days_overdue: number; is_overdue: boolean } {
  const nowMs = now.getTime();
  const dueMs = inv.DueDate ? inv.DueDate.getTime() : nowMs;
  const days_overdue = daysBetween(dueMs, nowMs); // >0 = overdue, <=0 = within terms
  const is_overdue = days_overdue > 0;
  if (override && override.marked_paid_at) {
    return { bucket: "cash_received_pending", days_overdue, is_overdue };
  }
  return { bucket: is_overdue ? "overdue" : "within_terms", days_overdue, is_overdue };
}

// Per-tenant fetch outcome; exposed on the API response so operators can see
// exactly which tenant failed and why (missing env var, wrong grant type,
// unauthorised org, etc.) instead of silently getting an empty list.
export interface TenantFetchStatus {
  state: string;
  tenant_id: string;
  ok: boolean;
  invoice_count: number;
  error?: string;
}

// Fetch + normalise open AR across all three state entities.
export async function getUnpaidInvoices(): Promise<UnpaidInvoicesResult & { tenant_status: TenantFetchStatus[] }> {
  const overrides = listOverrides();
  const now = new Date();

  // Fan out to all three tenants in parallel; on a per-tenant failure we log,
  // record the error in tenant_status, and skip that tenant rather than
  // failing the whole endpoint. The endpoint always returns a shape; the UI
  // can surface tenant errors to the operator without breaking.
  const perTenant = await Promise.all(
    XERO_TENANTS.map(async (t: XeroTenant): Promise<{ tenant: XeroTenant; rows: XeroInvoice[]; status: TenantFetchStatus }> => {
      try {
        const rows = await listOpenInvoices(t.id);
        return {
          tenant: t,
          rows,
          status: { state: t.state, tenant_id: t.id, ok: true, invoice_count: rows.length },
        };
      } catch (e) {
        const msg = (e as any)?.message || String(e);
        console.error(`[ar] listOpenInvoices ${t.state} failed:`, msg);
        return {
          tenant: t,
          rows: [] as XeroInvoice[],
          status: { state: t.state, tenant_id: t.id, ok: false, invoice_count: 0, error: msg },
        };
      }
    }),
  );

  const tenant_status = perTenant.map((p) => p.status);

  // Flatten + classify.
  const active: OpenInvoice[] = [];
  const cleared: OpenInvoice[] = [];
  const flat: Array<{ tenant: XeroTenant; raw: XeroInvoice }> = [];
  for (const { tenant, rows } of perTenant) {
    for (const raw of rows) flat.push({ tenant, raw });
  }

  // Enrich vendor emails first so every returned invoice has a contact_email
  // if Xero knew one. This is the field the follow-up dialog pre-fills.
  await enrichContactEmails(
    flat.map((f) => ({ tenant_id: f.tenant.id, contact_id: f.raw.Contact?.ContactID || null })),
  );

  for (const { tenant, raw } of flat) {
    const override = overrides.get(raw.InvoiceID);
    const { bucket, days_overdue, is_overdue } = classify(raw, override, now);
    const contact_id = raw.Contact?.ContactID || null;
    const contact_email = contact_id ? contactEmailCache.get(`${tenant.id}:${contact_id}`) ?? null : null;
    const norm: OpenInvoice = {
      invoice_id: raw.InvoiceID,
      tenant_id: tenant.id,
      tenant_name: tenant.name,
      state: tenant.state,
      invoice_number: raw.InvoiceNumber,
      contact_id,
      contact_name: raw.Contact?.Name || null,
      contact_email,
      reference: raw.Reference || null,
      date_iso: toIsoDate(raw.Date),
      due_date_iso: toIsoDate(raw.DueDate),
      amount_due: raw.AmountDue,
      total: raw.Total,
      days_overdue,
      is_overdue,
      bucket,
      override: override?.marked_paid_at
        ? {
            marked_paid_at_iso: new Date(override.marked_paid_at).toISOString(),
            marked_by: override.marked_by,
            note: override.note,
          }
        : undefined,
    };
    if (override?.marked_paid_at) cleared.push(norm);
    else active.push(norm);
  }

  return { invoices: active, cleared, tenant_status };
}

// --- Aged debtors summary -------------------------------------------------
export interface AgedBucket {
  count: number;
  amount: number;
}
export type AgedRow = {
  "0-30": AgedBucket;
  "31-60": AgedBucket;
  "61-90": AgedBucket;
  "90+": AgedBucket;
  total: AgedBucket;
};
export type AgedDebtors = Record<string, AgedRow>;

function emptyRow(): AgedRow {
  return {
    "0-30": { count: 0, amount: 0 },
    "31-60": { count: 0, amount: 0 },
    "61-90": { count: 0, amount: 0 },
    "90+": { count: 0, amount: 0 },
    total: { count: 0, amount: 0 },
  };
}

// Buckets from DUE DATE, per common convention. Within-terms invoices (negative
// days_overdue) also count in 0-30 because that column doubles as "current".
export function getAgedDebtors(invoices: OpenInvoice[]): AgedDebtors {
  const out: AgedDebtors = {};
  function ensure(state: string): AgedRow {
    if (!out[state]) out[state] = emptyRow();
    return out[state];
  }
  const total = emptyRow();
  for (const inv of invoices) {
    // Overrides ("cash received pending") do NOT age — they've functionally
    // been paid. Excluding them keeps the aging table honest.
    if (inv.bucket === "cash_received_pending") continue;
    const row = ensure(inv.state);
    const d = inv.days_overdue;
    let col: keyof AgedRow;
    if (d <= 30) col = "0-30";
    else if (d <= 60) col = "31-60";
    else if (d <= 90) col = "61-90";
    else col = "90+";
    row[col].count += 1;
    row[col].amount += inv.amount_due;
    row.total.count += 1;
    row.total.amount += inv.amount_due;
    total[col].count += 1;
    total[col].amount += inv.amount_due;
    total.total.count += 1;
    total.total.amount += inv.amount_due;
  }
  out.TOTAL = total;
  return out;
}

// --- Headline totals ------------------------------------------------------
export interface HeadlineTotals {
  total: number;
  buckets: Record<ArBucket, { count: number; amount: number }>;
}

export function getHeadlineTotals(invoices: OpenInvoice[]): HeadlineTotals {
  const buckets: Record<ArBucket, { count: number; amount: number }> = {
    overdue: { count: 0, amount: 0 },
    within_terms: { count: 0, amount: 0 },
    cash_received_pending: { count: 0, amount: 0 },
    // TODO(ar): populate earned_not_invoiced from HubSpot UC deals that don't
    // yet have a matching Xero invoice. Requires reconciling by property/deal
    // reference against the state-entity Contacts list — not blocking for the
    // first release; the weekly report cites just the first three buckets.
    earned_not_invoiced: { count: 0, amount: 0 },
  };
  let total = 0;
  for (const inv of invoices) {
    buckets[inv.bucket].count += 1;
    buckets[inv.bucket].amount += inv.amount_due;
    total += inv.amount_due;
  }
  return { total, buckets };
}
