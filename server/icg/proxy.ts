// Credential pass-through helper.
// When the server is started with api_credentials=['custom-cred:<host>'], the platform injects:
//   CUSTOM_CRED_<HOST>_URL   = https://agent-proxy.perplexity.ai/agent_pass_through  (base)
//   CUSTOM_CRED_<HOST>_TOKEN = <proxy token>                                          (x-api-key)
// We call URL_BASE + <target path> and send the token as the x-api-key header. The proxy
// forwards to the real host with the real saved credential (HubSpot pat-/Meta token) attached.

interface CredEnv {
  base: string;
  token: string;
}

function cred(envKey: string): CredEnv {
  return {
    base: process.env[`CUSTOM_CRED_${envKey}_URL`] || "",
    token: process.env[`CUSTOM_CRED_${envKey}_TOKEN`] || "",
  };
}

export const HUBSPOT_CRED = () => cred("API_HUBAPI_COM");
export const META_CRED = () => cred("GRAPH_FACEBOOK_COM");

// Perform a request through the pass-through proxy for a given credential + target path.
export async function proxyFetch(
  c: CredEnv,
  path: string,
  init: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<Response> {
  if (!c.base || !c.token) {
    throw new Error("Credential not available (server not started with api_credentials).");
  }
  const url = c.base + path;
  const headers: Record<string, string> = {
    "x-api-key": c.token,
    "Content-Type": "application/json",
    ...(init.headers || {}),
  };
  return fetch(url, { method: init.method || "GET", headers, body: init.body });
}
