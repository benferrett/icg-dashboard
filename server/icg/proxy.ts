// HTTP helper for HubSpot + Meta with two auth modes:
//
// 1. DIRECT (production / self-hosting): set HUBSPOT_TOKEN and META_TOKEN env vars.
//    Requests go straight to the real API host with `Authorization: Bearer <token>`
//    (HubSpot) or `?access_token=<token>` (Meta). This is what runs on Railway.
//
// 2. PROXY (Perplexity preview sandbox): if a direct token is absent but the
//    platform injected CUSTOM_CRED_<HOST>_URL / _TOKEN, route through the
//    credential pass-through proxy instead. Lets the same code run in-preview.
//
// Direct mode takes priority when its token is set.

const HUBSPOT_BASE = "https://api.hubapi.com";
const META_BASE = "https://graph.facebook.com";

interface Target {
  /** Full URL to call (already includes host + path + any query string). */
  url: string;
  /** Headers to attach. */
  headers: Record<string, string>;
}

// --- HubSpot --------------------------------------------------------------
function hubspotTarget(path: string): Target {
  const direct = process.env.HUBSPOT_TOKEN;
  if (direct) {
    return {
      url: HUBSPOT_BASE + path,
      headers: { Authorization: `Bearer ${direct}`, "Content-Type": "application/json" },
    };
  }
  // Preview proxy fallback
  const base = process.env.CUSTOM_CRED_API_HUBAPI_COM_URL;
  const token = process.env.CUSTOM_CRED_API_HUBAPI_COM_TOKEN;
  if (base && token) {
    return {
      url: base + path,
      headers: { "x-api-key": token, "Content-Type": "application/json" },
    };
  }
  throw new Error("HubSpot token not configured (set HUBSPOT_TOKEN).");
}

// --- Meta -----------------------------------------------------------------
function metaTarget(path: string): Target {
  const direct = process.env.META_TOKEN;
  if (direct) {
    // Append the access token as a query param (Graph API convention).
    const sep = path.includes("?") ? "&" : "?";
    return {
      url: `${META_BASE}${path}${sep}access_token=${encodeURIComponent(direct)}`,
      headers: { "Content-Type": "application/json" },
    };
  }
  const base = process.env.CUSTOM_CRED_GRAPH_FACEBOOK_COM_URL;
  const token = process.env.CUSTOM_CRED_GRAPH_FACEBOOK_COM_TOKEN;
  if (base && token) {
    return {
      url: base + path,
      headers: { "x-api-key": token, "Content-Type": "application/json" },
    };
  }
  throw new Error("Meta token not configured (set META_TOKEN).");
}

export type Service = "hubspot" | "meta";

// Perform a request to the given service + path, choosing the right auth mode.
export async function apiFetch(
  service: Service,
  path: string,
  init: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<Response> {
  const target = service === "hubspot" ? hubspotTarget(path) : metaTarget(path);
  return fetch(target.url, {
    method: init.method || "GET",
    headers: { ...target.headers, ...(init.headers || {}) },
    body: init.body,
  });
}
