// Email templates for AR follow-ups.
//
// Kept plain-text-first for maximum deliverability, with a lightly-styled HTML
// counterpart. Templates deliberately avoid heavy CSS, remote images, or
// tracking pixels — this is B2B accounts collections, not marketing.

export interface PoliteReminderInput {
  contact_name?: string | null;
  invoice_number: string;
  amount: number;
  due_date: string; // display-ready ("15 Aug 2026") or ISO — caller decides
  days_overdue: number;
  property?: string | null;
  tenant_name: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

// Match the ICG accounts sign-off used elsewhere.
const SIGNOFF_HTML = `
<p style="margin:16px 0 0">Kind regards,<br>
<strong>ICG Accounts</strong><br>
Inner Circle Group<br>
<a href="mailto:accounts@innercirclegroup.com.au">accounts@innercirclegroup.com.au</a><br>
ABN 52 690 564 786</p>`;

const SIGNOFF_TEXT = `
Kind regards,
ICG Accounts
Inner Circle Group
accounts@innercirclegroup.com.au
ABN 52 690 564 786
`;

function fmtAud(n: number): string {
  // "$1,234.50" — plain leading-dollar; the AUD context is understood.
  return "$" + n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function safeName(name: string | null | undefined): string {
  // Emails opening "Hi ," look sloppy. Fall back to a generic salutation when
  // we don't have a contact name from Xero.
  const trimmed = (name || "").trim();
  if (!trimmed) return "Hi there";
  // Use the first name only when it's clearly a person; leave company names whole.
  const first = trimmed.split(/\s+/)[0];
  return `Hi ${first}`;
}

// Subject: `Friendly reminder — ICG invoice INV-0002 (Lot 170) — $22,000.00`
// When there's no property we drop the parens rather than leave "()" behind.
function buildSubject(invoice_number: string, property: string | null | undefined, amount: number): string {
  const propPart = property && property.trim() ? ` (${property.trim()})` : "";
  return `Friendly reminder — ICG invoice ${invoice_number}${propPart} — ${fmtAud(amount)}`;
}

export function politeReminderTemplate(input: PoliteReminderInput): RenderedEmail {
  const {
    contact_name,
    invoice_number,
    amount,
    due_date,
    days_overdue,
    property,
    tenant_name,
  } = input;

  const subject = buildSubject(invoice_number, property, amount);
  const hi = safeName(contact_name);

  // Overdue tone vs. within-terms tone: within-terms is a heads-up ("just a
  // friendly reminder that this is coming due"); overdue politely asks for an
  // ETA or a note about any query, without being heavy-handed.
  const openingHtml =
    days_overdue > 0
      ? `<p>${hi},</p><p>Just a friendly follow-up on <strong>ICG invoice ${invoice_number}</strong>${
          property ? ` for <strong>${property}</strong>` : ""
        }, issued by <em>${tenant_name}</em> for <strong>${fmtAud(amount)}</strong>. Our records show it was due on <strong>${due_date}</strong> (${days_overdue} day${
          days_overdue === 1 ? "" : "s"
        } ago) and is still showing as outstanding.</p><p>Could you let me know when we can expect payment? If there's any query or missing paperwork, please reply to this email and I'll sort it out today.</p>`
      : `<p>${hi},</p><p>Just a friendly heads-up on <strong>ICG invoice ${invoice_number}</strong>${
          property ? ` for <strong>${property}</strong>` : ""
        }, issued by <em>${tenant_name}</em> for <strong>${fmtAud(amount)}</strong>, which is due on <strong>${due_date}</strong>. If there's anything you need from us to have it processed on time, please let me know.</p>`;

  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#17212b;line-height:1.5">
${openingHtml}
<p>Thanks so much for your help.</p>
${SIGNOFF_HTML}
</body></html>`;

  const openingText =
    days_overdue > 0
      ? `${hi},

Just a friendly follow-up on ICG invoice ${invoice_number}${property ? ` for ${property}` : ""}, issued by ${tenant_name} for ${fmtAud(amount)}. Our records show it was due on ${due_date} (${days_overdue} day${days_overdue === 1 ? "" : "s"} ago) and is still showing as outstanding.

Could you let me know when we can expect payment? If there's any query or missing paperwork, please reply to this email and I'll sort it out today.`
      : `${hi},

Just a friendly heads-up on ICG invoice ${invoice_number}${property ? ` for ${property}` : ""}, issued by ${tenant_name} for ${fmtAud(amount)}, which is due on ${due_date}. If there's anything you need from us to have it processed on time, please let me know.`;

  const text = `${openingText}

Thanks so much for your help.
${SIGNOFF_TEXT}`;

  return { subject, html, text };
}
