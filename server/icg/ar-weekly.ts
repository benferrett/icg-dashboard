// Weekly AR summary — the "Unpaid Vendor Commissions" email sent every Monday.
//
// Mirrors the manual report we produced this morning (see
// reports/unpaid-commissions/2026-09-07/ICG_Weekly_Unpaid_Vendor_Commissions_...html)
// so the recipients see a consistent layout week-to-week. Only the numbers move.

import { getUnpaidInvoices, getAgedDebtors, getHeadlineTotals, type OpenInvoice } from "./ar";
import { sendMail } from "./mailer";

function fmtAud(n: number): string {
  return "$" + n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtInt(n: number): string {
  return n.toLocaleString("en-AU");
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

// Monday of the current week (local time). Used for the subject line.
function currentMondayLabel(now = new Date()): string {
  const d = new Date(now);
  const dow = d.getDay(); // 0=Sun, 1=Mon
  const diff = (dow + 6) % 7; // days since Monday
  d.setDate(d.getDate() - diff);
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
}

function styleBlock(): string {
  // Kept inline in <style> so most mail clients respect it. Palette matches the
  // manual weekly report so the recipients see the same look.
  return `body{margin:0;background:#f4f6f8;color:#17212b;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.4}
.wrap{max-width:940px;margin:0 auto;padding:28px 18px 40px}
.card{background:#fff;border:1px solid #dfe5ea;border-radius:8px;padding:22px;margin:0 0 16px}
h1{font-size:24px;line-height:1.2;margin:0 0 5px;color:#102a43}
h2{font-size:16px;margin:0 0 12px;color:#102a43}
.sub{color:#5b6b7b;margin:0}
.total{font-size:30px;font-weight:700;color:#0c4a6e;margin:10px 0 3px}
.note{font-size:12px;color:#607080}
table{border-collapse:collapse;width:100%;font-size:13px}
th{background:#102a43;color:#fff;text-align:left;padding:8px 9px;font-weight:600}
td{padding:8px 9px;border-bottom:1px solid #e5ebf0;vertical-align:top}
tr:last-child td{border-bottom:0}
.num{text-align:right;white-space:nowrap;display:block}
.risk{color:#b42318;font-weight:700}
.pill{display:inline-block;background:#eaf2f8;color:#0c4a6e;padding:3px 8px;border-radius:10px;font-weight:600;font-size:12px}
.alert{background:#fff7ed;border-left:4px solid #f59e0b;padding:11px 13px;margin:0 0 12px;color:#7c2d12}
.footer{font-size:11px;color:#687785;padding:4px 2px}`;
}

// Aged debtors block — mirrors the manual report exactly (VIC/QLD/WA rows).
function agedDebtorsHtml(invoices: OpenInvoice[]): string {
  const aged = getAgedDebtors(invoices);
  const states = ["VIC", "QLD", "WA"] as const;
  const rows = states
    .map((s) => {
      const r = aged[s];
      if (!r) return `<tr><td>${s}</td><td colspan="5"><span class="num">—</span></td></tr>`;
      const riskClass = (v: number) => (v > 0 ? "num risk" : "num");
      return `<tr><td>${s}</td>
<td><span class="num">${fmtAud(r["0-30"].amount)}</span></td>
<td><span class="num">${fmtAud(r["31-60"].amount)}</span></td>
<td><span class="num">${fmtAud(r["61-90"].amount)}</span></td>
<td><span class="${riskClass(r["90+"].amount)}">${fmtAud(r["90+"].amount)}</span></td>
<td><span class="num"><strong>${fmtAud(r.total.amount)}</strong></span></td></tr>`;
    })
    .join("");
  const total = aged.TOTAL;
  const totalRow = total
    ? `<tr><td><strong>Total</strong></td>
<td><span class="num"><strong>${fmtAud(total["0-30"].amount)}</strong></span></td>
<td><span class="num"><strong>${fmtAud(total["31-60"].amount)}</strong></span></td>
<td><span class="num"><strong>${fmtAud(total["61-90"].amount)}</strong></span></td>
<td><span class="num risk"><strong>${fmtAud(total["90+"].amount)}</strong></span></td>
<td><span class="num"><strong>${fmtAud(total.total.amount)}</strong></span></td></tr>`
    : "";
  return `<div class="card"><h2>Aged debtors — open state-entity AR</h2>
<table><thead><tr><th>State entity</th><th>0–30</th><th>31–60</th><th>61–90</th><th>90+</th><th>Total</th></tr></thead>
<tbody>${rows}${totalRow}</tbody></table>
<p class="note" style="margin:12px 0 0">0–30 includes invoices due today or still within terms. Aging is from due date.</p></div>`;
}

function headlineHtml(totals: ReturnType<typeof getHeadlineTotals>): string {
  const b = totals.buckets;
  return `<div class="card"><h2>Headline split</h2>
<table><thead><tr><th>Bucket</th><th>Amount</th><th>Count</th><th>Note</th></tr></thead><tbody>
<tr><td>Cash received, clearing entry pending</td><td><span class="num">${fmtAud(b.cash_received_pending.amount)}</span></td><td><span class="num">${fmtInt(b.cash_received_pending.count)}</span></td><td>Locally marked paid; awaiting Xero clearing entry</td></tr>
<tr><td>Invoiced &amp; overdue</td><td><span class="num">${fmtAud(b.overdue.amount)}</span></td><td><span class="num">${fmtInt(b.overdue.count)}</span></td><td></td></tr>
<tr><td>Invoiced &amp; within terms</td><td><span class="num">${fmtAud(b.within_terms.amount)}</span></td><td><span class="num">${fmtInt(b.within_terms.count)}</span></td><td></td></tr>
<tr><td>Earned, not yet invoiced</td><td><span class="num">${fmtAud(b.earned_not_invoiced.amount)}</span></td><td><span class="num">${fmtInt(b.earned_not_invoiced.count)}</span></td><td>Populated from HubSpot UC deals (TODO — 0 for now)</td></tr>
</tbody></table></div>`;
}

// "Top 10 largest outstanding invoices" — matches the manual report layout.
function topOutstandingHtml(invoices: OpenInvoice[]): string {
  const sorted = [...invoices]
    .filter((i) => i.bucket === "overdue" || i.bucket === "within_terms")
    .sort((a, b) => b.amount_due - a.amount_due)
    .slice(0, 10);
  const rows = sorted
    .map((i) => {
      const days = i.is_overdue ? String(i.days_overdue) : "Within terms";
      return `<tr>
<td>${escapeHtml(i.contact_name || "—")}</td>
<td>${escapeHtml(i.invoice_number)}</td>
<td><span class="num">${fmtAud(i.amount_due)}</span></td>
<td><span class="num">${days}</span></td>
<td>${i.state}</td></tr>`;
    })
    .join("");
  return `<div class="card"><h2>Top 10 largest outstanding invoices</h2>
<table><thead><tr><th>Vendor</th><th>Invoice #</th><th>Amount</th><th>Days overdue</th><th>State entity</th></tr></thead>
<tbody>${rows || `<tr><td colspan="5">No outstanding invoices.</td></tr>`}</tbody></table></div>`;
}

// New this week — invoices raised in the past 7 days.
function newThisWeekHtml(invoices: OpenInvoice[], now: Date): string {
  const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const recent = invoices
    .filter((i) => i.date_iso && new Date(i.date_iso) >= cutoff)
    .sort((a, b) => (a.date_iso! < b.date_iso! ? -1 : 1));
  const rows = recent
    .map(
      (i) => `<tr>
<td>${i.state}</td>
<td>${escapeHtml(i.contact_name || "—")}</td>
<td>${escapeHtml(i.invoice_number)}</td>
<td>${fmtDate(i.date_iso)}</td>
<td><span class="num">${fmtAud(i.amount_due)}</span></td></tr>`,
    )
    .join("");
  return `<div class="card"><h2>New this week</h2>
<p class="pill">Invoices raised</p>
<table><thead><tr><th>State</th><th>Vendor</th><th>Invoice #</th><th>Raised</th><th>Amount</th></tr></thead>
<tbody>${rows || `<tr><td colspan="5">No new invoices raised in the past 7 days.</td></tr>`}</tbody></table></div>`;
}

function anomaliesHtml(invoices: OpenInvoice[]): string {
  const pending = invoices.filter((i) => i.bucket === "cash_received_pending");
  const pendingRows = pending
    .map(
      (i) => `<tr>
<td>${escapeHtml(i.contact_name || "—")} (${escapeHtml(i.invoice_number)})</td>
<td><span class="num">${fmtAud(i.amount_due)}</span></td>
<td>${i.override?.marked_paid_at_iso?.slice(0, 10) ?? "—"}</td>
<td>Confirm the Xero clearing entry has landed.</td></tr>`,
    )
    .join("");
  return `<div class="card"><h2>Anomalies / actions</h2>
<h3 style="font-size:14px;margin:0 0 8px">Cash received, clearing entry pending</h3>
<table><thead><tr><th>Item</th><th>Amount</th><th>Marked</th><th>Action</th></tr></thead>
<tbody>${pendingRows || `<tr><td colspan="4">No pending clearings.</td></tr>`}</tbody></table>
<div class="alert" style="margin-top:14px"><strong>Note:</strong> The "earned, not yet invoiced" line is TODO — the dashboard will populate it from HubSpot UC deals once the reconciliation join is in place.</div></div>`;
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface WeeklyReport {
  subject: string;
  html_body: string;
  generated_at_iso: string;
  totals: ReturnType<typeof getHeadlineTotals>;
  invoices: OpenInvoice[];
}

export async function buildWeeklyReport(): Promise<WeeklyReport> {
  const now = new Date();
  const { invoices, cleared } = await getUnpaidInvoices();
  // The report considers pending-clearing invoices as still visible so the
  // recipient sees the pipeline of "cash-in-transit" alongside true unpaid.
  const all = [...invoices, ...cleared];
  const totals = getHeadlineTotals(all);
  const mondayLabel = currentMondayLabel(now);

  const html_body = `<!doctype html><html><head><meta charset="utf-8"><style>${styleBlock()}</style></head><body><div class="wrap">
<div class="card"><h1>ICG Weekly Unpaid Vendor Commissions</h1>
<p class="sub">Receivables/debtors view as at ${now.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
<div class="total">${fmtAud(totals.total)}</div>
<p class="sub">Total across open state-entity AR (${fmtInt(all.length)} invoice${all.length === 1 ? "" : "s"}).</p></div>
${headlineHtml(totals)}
${agedDebtorsHtml(all)}
${topOutstandingHtml(all)}
${newThisWeekHtml(all, now)}
${anomaliesHtml(all)}
<div class="footer">Data source: Xero open ACCREC invoices for the VIC, QLD and WA entities. Generated ${now.toISOString()}.</div>
</div></body></html>`;

  return {
    subject: `ICG Unpaid Vendor Commissions — Week of ${mondayLabel}`,
    html_body,
    generated_at_iso: now.toISOString(),
    totals,
    invoices: all,
  };
}

export async function sendWeeklyReport(to: string): Promise<{ id: string; threadId: string; subject: string }> {
  const rep = await buildWeeklyReport();
  const res = await sendMail({
    to,
    subject: rep.subject,
    html: rep.html_body,
    // Plain-text fallback: a compact one-liner. Most recipients will read HTML,
    // but keeping the text alternative avoids spam-filter penalties.
    text: `ICG Weekly Unpaid Vendor Commissions\nTotal unpaid: ${fmtAud(rep.totals.total)}\nOverdue: ${fmtAud(
      rep.totals.buckets.overdue.amount,
    )} (${rep.totals.buckets.overdue.count} inv)\nWithin terms: ${fmtAud(rep.totals.buckets.within_terms.amount)} (${rep.totals.buckets.within_terms.count} inv)\nView the full HTML version.`,
  });
  return { id: res.id, threadId: res.threadId, subject: rep.subject };
}
