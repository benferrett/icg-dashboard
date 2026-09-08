// Email templates for AR follow-ups.
//
// Rendered server-side (frontend passes structured fields, not HTML) so both
// the "click Follow-up in the dashboard" flow and the "weekly summary" flow
// produce identically styled output.
//
// Design principles for the HTML:
// - Uses ICG's real brand palette pulled from innercirclegroup.com.au
//   (black header, ivory body, warm-gold accent #A8966B).
// - Table-based layout with inline styles ONLY — Gmail/Outlook strip <style>
//   blocks and ignore flexbox/grid. Tables + inline CSS is the deliverable
//   HTML email idiom.
// - No remote images except the ICG logo (hosted at the ICG public site, so
//   caching / firewall behaviour matches every other ICG email). No tracking
//   pixels, no CSS references, no web fonts.
// - Also emits a clean plain-text version. Some vendors' mail clients (esp.
//   older Outlook / procurement portals) render text/plain first.

export interface PoliteReminderInput {
  contact_name?: string | null;
  invoice_number: string;
  amount: number;
  due_date: string; // display-ready ("15 Aug 2026") or "—"
  days_overdue: number; // <=0 means within terms
  property?: string | null;
  tenant_name: string;
  online_invoice_url?: string | null; // Xero "view & pay" link, if we have it
  // Free-form body written by the operator in the dashboard dialog. When
  // present, replaces the auto-generated opening paragraphs so the operator's
  // wording is what ships (still inside the branded chrome). Blank/null uses
  // the default polite-reminder wording below.
  body_override?: string | null;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

// --- Brand tokens ---------------------------------------------------------
// Pulled from innercirclegroup.com.au theme CSS on 2026-09-08.
const BRAND = {
  gold: "#A8966B",
  ink: "#000000",
  ivory: "#F6F5F3",
  stone: "#D9D7D2",
  paper: "#FFFFFF",
  text: "#17212B",
  textSoft: "#5A6672",
  logoLight: "https://innercirclegroup.com.au/wp-content/uploads/2025/10/inner-circle-w.png",
  abn: "ABN 52 690 564 786",
  accounts: "accounts@innercirclegroup.com.au",
} as const;

function fmtAud(n: number): string {
  return "$" + n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeSalutation(name: string | null | undefined): string {
  const trimmed = (name || "").trim();
  if (!trimmed) return "Hi there";
  const first = trimmed.split(/\s+/)[0];
  return `Hi ${first}`;
}

function buildSubject(invoice_number: string, property: string | null | undefined, amount: number): string {
  const propPart = property && property.trim() ? ` (${property.trim()})` : "";
  return `Friendly reminder — ICG invoice ${invoice_number}${propPart} — ${fmtAud(amount)}`;
}

// --- Body copy ------------------------------------------------------------
function defaultOpeningText(input: PoliteReminderInput): string {
  const { contact_name, invoice_number, amount, due_date, days_overdue, property, tenant_name } = input;
  const hi = safeSalutation(contact_name);
  const propRef = property ? ` for ${property}` : "";
  if (days_overdue > 0) {
    return `${hi},

Just a friendly follow-up on ICG invoice ${invoice_number}${propRef}, issued by ${tenant_name} for ${fmtAud(amount)}. Our records show it was due on ${due_date} (${days_overdue} day${days_overdue === 1 ? "" : "s"} ago) and is still showing as outstanding.

Could you let me know when we can expect payment? If there's any query or missing paperwork, please reply to this email and I'll sort it out today.`;
  }
  return `${hi},

Just a friendly heads-up on ICG invoice ${invoice_number}${propRef}, issued by ${tenant_name} for ${fmtAud(amount)}, which is due on ${due_date}. If there's anything you need from us to have it processed on time, please let me know.`;
}

// Convert a plain-text body (double-newline paragraphs, single-newline breaks)
// into safe inline-styled HTML paragraphs.
function textToHtmlParas(body: string): string {
  const paras = body.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  return paras
    .map((p) => {
      const escaped = escapeHtml(p).replace(/\n/g, "<br>");
      return `<p style="margin:0 0 14px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:${BRAND.text}">${escaped}</p>`;
    })
    .join("\n");
}

// --- HTML template --------------------------------------------------------
function renderHtml(input: PoliteReminderInput): string {
  const { invoice_number, amount, due_date, days_overdue, property, tenant_name, online_invoice_url } = input;
  const bodyText = (input.body_override && input.body_override.trim()) || defaultOpeningText(input);
  const bodyHtml = textToHtmlParas(bodyText);

  const overdueBadge =
    days_overdue > 0
      ? `<span style="display:inline-block;background:#B00020;color:#fff;font-family:Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;letter-spacing:0.4px;text-transform:uppercase;padding:3px 8px;border-radius:3px;">${days_overdue} day${days_overdue === 1 ? "" : "s"} overdue</span>`
      : `<span style="display:inline-block;background:${BRAND.stone};color:${BRAND.text};font-family:Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;letter-spacing:0.4px;text-transform:uppercase;padding:3px 8px;border-radius:3px;">Within terms</span>`;

  const propRow = property && property.trim()
    ? `<tr>
        <td style="padding:6px 12px 6px 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:${BRAND.textSoft};text-transform:uppercase;letter-spacing:0.4px;">Property / Ref</td>
        <td style="padding:6px 0;font-family:Helvetica,Arial,sans-serif;font-size:14px;color:${BRAND.text};text-align:right;">${escapeHtml(property.trim())}</td>
      </tr>`
    : "";

  const cta = online_invoice_url
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 4px;">
        <tr>
          <td align="center" bgcolor="${BRAND.gold}" style="border-radius:4px;">
            <a href="${escapeHtml(online_invoice_url)}" target="_blank" style="display:inline-block;padding:12px 24px;font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:0.3px;">View &amp; pay invoice →</a>
          </td>
        </tr>
      </table>`
    : "";

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(buildSubject(invoice_number, property, amount))}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.ivory};font-family:Helvetica,Arial,sans-serif;color:${BRAND.text};">
<!-- Preheader (hidden preview text) -->
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">
${escapeHtml("Invoice " + invoice_number + " — " + fmtAud(amount) + (days_overdue > 0 ? " · " + days_overdue + " days overdue" : " · due " + due_date))}
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.ivory};">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:${BRAND.paper};border-radius:6px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05);">

        <!-- Header -->
        <tr>
          <td style="background:${BRAND.ink};padding:24px 32px;text-align:center;">
            <img src="${BRAND.logoLight}" alt="Inner Circle Group" width="86" height="68" style="display:inline-block;border:0;outline:none;text-decoration:none;height:auto;max-width:86px;">
          </td>
        </tr>
        <tr>
          <td style="background:${BRAND.gold};height:3px;line-height:3px;font-size:0;">&nbsp;</td>
        </tr>

        <!-- Body copy -->
        <tr>
          <td style="padding:32px 32px 8px;">
            ${bodyHtml}
          </td>
        </tr>

        <!-- Invoice summary card -->
        <tr>
          <td style="padding:8px 32px 8px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.ivory};border:1px solid ${BRAND.stone};border-radius:4px;">
              <tr>
                <td style="padding:20px 24px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="font-family:Helvetica,Arial,sans-serif;font-size:12px;color:${BRAND.textSoft};text-transform:uppercase;letter-spacing:0.6px;font-weight:600;padding-bottom:6px;">Invoice ${escapeHtml(invoice_number)}</td>
                      <td style="text-align:right;padding-bottom:6px;">${overdueBadge}</td>
                    </tr>
                    <tr>
                      <td colspan="2" style="font-family:Helvetica,Arial,sans-serif;font-size:26px;font-weight:600;color:${BRAND.text};padding:2px 0 14px;">${fmtAud(amount)}</td>
                    </tr>
                  </table>
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${BRAND.stone};">
                    <tr>
                      <td style="padding:12px 12px 6px 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:${BRAND.textSoft};text-transform:uppercase;letter-spacing:0.4px;">Issued by</td>
                      <td style="padding:12px 0 6px;font-family:Helvetica,Arial,sans-serif;font-size:14px;color:${BRAND.text};text-align:right;">${escapeHtml(tenant_name)}</td>
                    </tr>
                    ${propRow}
                    <tr>
                      <td style="padding:6px 12px 12px 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:${BRAND.textSoft};text-transform:uppercase;letter-spacing:0.4px;">Due date</td>
                      <td style="padding:6px 0 12px;font-family:Helvetica,Arial,sans-serif;font-size:14px;color:${BRAND.text};text-align:right;">${escapeHtml(due_date)}</td>
                    </tr>
                  </table>
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr><td align="center">${cta}</td></tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Sign-off -->
        <tr>
          <td style="padding:20px 32px 8px;">
            <p style="margin:0 0 4px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:${BRAND.text}">Thanks so much for your help.</p>
            <p style="margin:16px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:${BRAND.text}">
              Kind regards,<br>
              <strong>ICG Accounts</strong><br>
              Inner Circle Group
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:20px 32px 28px;border-top:1px solid ${BRAND.stone};">
            <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:${BRAND.textSoft};">
              <a href="mailto:${BRAND.accounts}" style="color:${BRAND.textSoft};text-decoration:underline;">${BRAND.accounts}</a> &nbsp;·&nbsp; ${BRAND.abn}
            </p>
            <p style="margin:6px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:11px;line-height:1.5;color:${BRAND.textSoft};">
              This is a payment reminder from Inner Circle Group. If you believe you have received it in error, reply to this email.
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

// --- Plain-text template --------------------------------------------------
function renderText(input: PoliteReminderInput): string {
  const bodyText = (input.body_override && input.body_override.trim()) || defaultOpeningText(input);
  const summary = [
    "",
    "─────────────────────────────",
    `INVOICE:   ${input.invoice_number}`,
    `AMOUNT:    ${fmtAud(input.amount)}`,
    `ISSUED BY: ${input.tenant_name}`,
    input.property && input.property.trim() ? `PROPERTY:  ${input.property.trim()}` : null,
    `DUE:       ${input.due_date}${input.days_overdue > 0 ? ` (${input.days_overdue} day${input.days_overdue === 1 ? "" : "s"} overdue)` : ""}`,
    input.online_invoice_url ? `\nView & pay: ${input.online_invoice_url}` : null,
    "─────────────────────────────",
    "",
  ]
    .filter((l) => l !== null)
    .join("\n");

  return `${bodyText}
${summary}
Thanks so much for your help.

Kind regards,
ICG Accounts
Inner Circle Group
${BRAND.accounts}
${BRAND.abn}
`;
}

export function politeReminderTemplate(input: PoliteReminderInput): RenderedEmail {
  return {
    subject: buildSubject(input.invoice_number, input.property, input.amount),
    html: renderHtml(input),
    text: renderText(input),
  };
}
