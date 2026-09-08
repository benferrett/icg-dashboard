// Xero API client for the Accounts Receivable feature.
//
// AUTH: OAuth2 refresh-token flow. A long-lived refresh token (issued once via a
// Xero Custom Connection OR a standard OAuth2 authorisation) is exchanged for a
// short-lived access token (~30 min) which is cached in memory here. On 401 or
// when the token has < 2 min to live we refresh transparently.
//
// TENANTS: ICG runs one Xero organisation per Australian state (VIC / QLD / WA)
// plus a central "Inner Circle Group Pty Ltd" org used for the master bank
// account. Tenant IDs are stable — we hard-code them so callers can request one
// specifically without a Connections lookup on every call.
//
// SAFETY: all upstream errors are logged with the `[xero]` prefix. A 429 is
// retried once after a 1s sleep (Xero's minute-limit almost always clears
// well before that). Anything else propagates so the caller (route handler)
// can convert it into a 5xx.

// Tenant IDs are stable per-org — safe to hard-code here.
export const XERO_TENANT_VIC = "72b5ae5e-00c2-47df-b95c-26b0f5c0e01d";
export const XERO_TENANT_QLD = "a43dc7a9-b2f7-4555-9dc6-e7592bf62ef0";
export const XERO_TENANT_WA = "fad3f7f1-a364-4d3d-98fe-f606a3876c75";
// Central holding entity — used for cross-checking received payments only.
// NOT included in XERO_TENANTS below (which drives the state-entity AR view).
export const XERO_TENANT_CENTRAL = "55a37885-188e-40da-a8f5-90cb79f1afe1";

export interface XeroTenant {
  id: string;
  name: string;
  state: "VIC" | "QLD" | "WA";
}

// The three revenue-bearing state entities the AR dashboard scans for open
// invoices. Central is intentionally excluded here.
export const XERO_TENANTS: XeroTenant[] = [
  { id: XERO_TENANT_VIC, name: "Inner Circle Group (VIC) Pty Ltd", state: "VIC" },
  { id: XERO_TENANT_QLD, name: "Inner Circle Group (QLD) Pty Ltd", state: "QLD" },
  { id: XERO_TENANT_WA, name: "Inner Circle Group (WA) Pty Ltd", state: "WA" },
];

// --- Access token cache ---------------------------------------------------
interface AccessToken {
  token: string;
  expiresAt: number; // epoch ms
}
let cachedToken: AccessToken | null = null;
const TOKEN_URL = "https://identity.xero.com/connect/token";
const XERO_BASE = "https://api.xero.com";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// Exchange the persistent refresh token for a fresh access token. Xero rotates
// the refresh token on every exchange in some flows — for Custom Connection
// (client credentials) it does not, and for standard OAuth2 the rotation is
// benign since we always request `offline_access` and keep re-using the same
// initial refresh token from env. If the env token becomes invalid the caller
// must rotate `XERO_REFRESH_TOKEN` — we log clearly when that happens.
async function refreshAccessToken(): Promise<AccessToken> {
  const clientId = process.env.XERO_CLIENT_ID;
  const clientSecret = process.env.XERO_CLIENT_SECRET;
  const refreshToken = process.env.XERO_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Xero credentials not configured (set XERO_CLIENT_ID, XERO_CLIENT_SECRET, XERO_REFRESH_TOKEN).",
    );
  }
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.error(`[xero] token refresh failed ${res.status}: ${txt.slice(0, 300)}`);
    throw new Error(`Xero token refresh failed (${res.status}). Rotate XERO_REFRESH_TOKEN.`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  const expiresAt = Date.now() + (json.expires_in - 30) * 1000; // trim 30s for clock skew
  cachedToken = { token: json.access_token, expiresAt };
  return cachedToken;
}

async function getAccessToken(force = false): Promise<string> {
  const now = Date.now();
  // Refresh proactively when < 2 min remaining so an in-flight request never
  // races the expiry (a 401 mid-batch would be uglier than a proactive spend).
  if (!force && cachedToken && cachedToken.expiresAt - now > 2 * 60 * 1000) {
    return cachedToken.token;
  }
  const t = await refreshAccessToken();
  return t.token;
}

// Low-level fetch wrapper. Accepts a path (starting with `/`) and optional
// query params. Sets the tenant header + Authorization header. On 401 refreshes
// the token once and retries; on 429 sleeps 1s and retries once.
export async function xeroGet<T = any>(
  tenantId: string,
  path: string,
  params?: Record<string, string | number | undefined>,
): Promise<T> {
  const url = new URL(XERO_BASE + path);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }

  async function doFetch(token: string): Promise<Response> {
    return fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "xero-tenant-id": tenantId,
        Accept: "application/json",
      },
    });
  }

  let token = await getAccessToken();
  let res = await doFetch(token);

  if (res.status === 401) {
    // Token might have been revoked or clock-skewed just past expiry.
    token = await getAccessToken(true);
    res = await doFetch(token);
  }
  if (res.status === 429) {
    await sleep(1000);
    res = await doFetch(token);
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.error(`[xero] GET ${path} tenant=${tenantId} failed ${res.status}: ${txt.slice(0, 400)}`);
    throw new Error(`Xero ${path} ${res.status}`);
  }
  return (await res.json()) as T;
}

// --- Date parsing ---------------------------------------------------------
// Xero returns dates in the .NET-ish `"/Date(1234567890000+0000)/"` format on
// most endpoints. Some newer endpoints also return ISO — support both.
export function parseXeroDate(s: string | undefined | null): Date | null {
  if (!s) return null;
  const m = /^\/Date\((-?\d+)([+-]\d{4})?\)\/$/.exec(s);
  if (m) {
    const ms = Number(m[1]);
    if (!Number.isFinite(ms)) return null;
    return new Date(ms);
  }
  // Fallback: ISO-like or YYYY-MM-DD.
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

// --- Domain types (subset we use) ----------------------------------------
export interface XeroLineItem {
  Description?: string;
  Quantity?: number;
  UnitAmount?: number;
  LineAmount?: number;
  AccountCode?: string;
}
export interface XeroInvoiceContact {
  ContactID?: string;
  Name?: string;
  EmailAddress?: string;
}
export interface XeroInvoice {
  InvoiceID: string;
  InvoiceNumber: string;
  Contact: XeroInvoiceContact;
  Date: Date | null;
  DueDate: Date | null;
  AmountDue: number;
  Total: number;
  LineItems: XeroLineItem[];
  Reference?: string;
  Status?: string;
  Type?: string;
}

// GET open AR invoices for a tenant (AUTHORISED + Type=ACCREC).
export async function listOpenInvoices(tenantId: string): Promise<XeroInvoice[]> {
  const json = await xeroGet<any>(tenantId, "/api.xro/2.0/Invoices", {
    Statuses: "AUTHORISED",
    Type: "ACCREC",
    // Include LineItems so callers can extract a property reference if we don't
    // find one in the Reference field. Xero's default omits line detail on list.
    page: 1,
  });
  const rows: any[] = json?.Invoices || [];
  return rows.map((r): XeroInvoice => ({
    InvoiceID: r.InvoiceID,
    InvoiceNumber: r.InvoiceNumber ?? "",
    Contact: {
      ContactID: r.Contact?.ContactID,
      Name: r.Contact?.Name,
      EmailAddress: r.Contact?.EmailAddress,
    },
    Date: parseXeroDate(r.Date),
    DueDate: parseXeroDate(r.DueDate),
    AmountDue: Number(r.AmountDue ?? 0),
    Total: Number(r.Total ?? 0),
    LineItems: Array.isArray(r.LineItems) ? r.LineItems : [],
    Reference: r.Reference || undefined,
    Status: r.Status,
    Type: r.Type,
  }));
}

// Full contact record. We use this to enrich each invoice with the vendor's
// primary email so a follow-up dialog can pre-fill the To: field.
export interface XeroContact {
  ContactID: string;
  Name?: string;
  EmailAddress?: string;
  Phones?: Array<{ PhoneType?: string; PhoneNumber?: string }>;
  Addresses?: Array<{ AddressType?: string; AddressLine1?: string; City?: string; Region?: string; PostalCode?: string }>;
}

export async function getContact(tenantId: string, contactId: string): Promise<XeroContact | null> {
  try {
    const json = await xeroGet<any>(tenantId, `/api.xro/2.0/Contacts/${contactId}`);
    const c = json?.Contacts?.[0];
    if (!c) return null;
    return {
      ContactID: c.ContactID,
      Name: c.Name,
      EmailAddress: c.EmailAddress,
      Phones: c.Phones,
      Addresses: c.Addresses,
    };
  } catch (e) {
    console.error(`[xero] getContact ${contactId} failed:`, (e as any)?.message);
    return null;
  }
}

// GET bank transactions of type RECEIVE for cross-checking payments received
// centrally against state-entity AR. `fromIso` is a YYYY-MM-DD string.
export async function listReceivedPayments(
  centralTenantId: string,
  fromIso: string,
): Promise<any[]> {
  // Xero's `where` clause uses its own DSL. DateTime() takes a date literal.
  const where = `Type=="RECEIVE" AND Date >= DateTime(${fromIso.replace(/-/g, ",")})`;
  const json = await xeroGet<any>(centralTenantId, "/api.xro/2.0/BankTransactions", {
    where,
  });
  return json?.BankTransactions || [];
}
