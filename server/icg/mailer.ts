// Gmail send-as helper for the accounts@innercirclegroup.com.au mailbox.
//
// AUTH: OAuth2 refresh-token flow. Once authorised as `accounts@` (offline,
// requesting the `gmail.send` scope), the refresh token stays valid until the
// user explicitly revokes it. We exchange it for a short-lived access token
// per-process and cache the result in memory.
//
// SEND: builds an RFC 5322 message (multipart/alternative when both HTML and
// text are present), base64url-encodes it, and POSTs to Gmail's
// `users.messages.send`. Gmail infers the `From:` header from the authenticated
// mailbox, but we ALWAYS set it explicitly with the friendly display name so
// the recipient sees "Inner Circle Group Accounts".

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

const FROM_HEADER = "Inner Circle Group Accounts <accounts@innercirclegroup.com.au>";

interface AccessToken {
  token: string;
  expiresAt: number;
}
let cachedToken: AccessToken | null = null;

async function refreshAccessToken(): Promise<AccessToken> {
  const clientId = process.env.GMAIL_ACCOUNTS_CLIENT_ID;
  const clientSecret = process.env.GMAIL_ACCOUNTS_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_ACCOUNTS_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Gmail Accounts credentials not configured (set GMAIL_ACCOUNTS_CLIENT_ID/SECRET/REFRESH_TOKEN).",
    );
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.error(`[mailer] token refresh failed ${res.status}: ${txt.slice(0, 300)}`);
    throw new Error(`Gmail token refresh failed (${res.status}). Rotate GMAIL_ACCOUNTS_REFRESH_TOKEN.`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: json.access_token, expiresAt: Date.now() + (json.expires_in - 30) * 1000 };
  return cachedToken;
}

async function getAccessToken(force = false): Promise<string> {
  if (!force && cachedToken && cachedToken.expiresAt - Date.now() > 2 * 60 * 1000) {
    return cachedToken.token;
  }
  const t = await refreshAccessToken();
  return t.token;
}

// --- RFC 5322 helpers -----------------------------------------------------
// Gmail accepts any well-formed RFC 5322 message, base64url encoded. We keep
// the encoder deliberately small and rely on Node's Buffer for base64.

function needsEncoding(s: string): boolean {
  // Encode when the string contains any non-ASCII char (a common cause of
  // silent header truncation across MTAs) or a control char in the subject.
  return /[^\x20-\x7e]/.test(s);
}

// RFC 2047 "encoded-word" for headers containing non-ASCII (e.g. curly quotes,
// em-dashes, accented characters). Gmail displays these correctly in-browser
// but plain 8-bit headers get mangled by strict downstream MTAs.
function encodeHeader(s: string): string {
  if (!needsEncoding(s)) return s;
  const b64 = Buffer.from(s, "utf8").toString("base64");
  return `=?UTF-8?B?${b64}?=`;
}

function base64Url(buf: Buffer | string): string {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf, "utf8");
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function normaliseRecipient(v?: string | string[] | null): string | null {
  if (!v) return null;
  if (Array.isArray(v)) {
    const joined = v.filter(Boolean).join(", ").trim();
    return joined || null;
  }
  const t = v.trim();
  return t || null;
}

export interface SendMailInput {
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
}

export interface SendMailResult {
  id: string;
  threadId: string;
}

function buildMessage(input: SendMailInput): string {
  const to = normaliseRecipient(input.to);
  if (!to) throw new Error("mailer: at least one To recipient is required");
  const cc = normaliseRecipient(input.cc);
  const bcc = normaliseRecipient(input.bcc);
  const subject = encodeHeader(input.subject || "");
  const boundary = `----=_ICG_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
  const hasHtml = !!input.html && input.html.trim().length > 0;
  const hasText = !!input.text && input.text.trim().length > 0;

  const headers: string[] = [];
  headers.push(`From: ${FROM_HEADER}`);
  headers.push(`To: ${to}`);
  if (cc) headers.push(`Cc: ${cc}`);
  if (bcc) headers.push(`Bcc: ${bcc}`);
  if (input.replyTo) headers.push(`Reply-To: ${input.replyTo}`);
  headers.push(`Subject: ${subject}`);
  headers.push(`MIME-Version: 1.0`);

  let body: string;
  if (hasHtml && hasText) {
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    body = [
      `--${boundary}`,
      `Content-Type: text/plain; charset=UTF-8`,
      `Content-Transfer-Encoding: 8bit`,
      ``,
      input.text!,
      ``,
      `--${boundary}`,
      `Content-Type: text/html; charset=UTF-8`,
      `Content-Transfer-Encoding: 8bit`,
      ``,
      input.html!,
      ``,
      `--${boundary}--`,
      ``,
    ].join("\r\n");
  } else if (hasHtml) {
    headers.push(`Content-Type: text/html; charset=UTF-8`);
    headers.push(`Content-Transfer-Encoding: 8bit`);
    body = input.html!;
  } else {
    headers.push(`Content-Type: text/plain; charset=UTF-8`);
    headers.push(`Content-Transfer-Encoding: 8bit`);
    body = input.text || "";
  }

  return `${headers.join("\r\n")}\r\n\r\n${body}`;
}

export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  const raw = base64Url(buildMessage(input));
  async function doSend(token: string): Promise<Response> {
    return fetch(SEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    });
  }

  let token = await getAccessToken();
  let res = await doSend(token);
  if (res.status === 401) {
    token = await getAccessToken(true);
    res = await doSend(token);
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.error(`[mailer] send failed ${res.status}: ${txt.slice(0, 400)}`);
    throw new Error(`Gmail send failed (${res.status}): ${txt.slice(0, 300)}`);
  }
  const json = (await res.json()) as { id: string; threadId: string };
  return { id: json.id, threadId: json.threadId };
}
