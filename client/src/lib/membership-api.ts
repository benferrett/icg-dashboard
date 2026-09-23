import { apiGet } from "./api";

const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

export function membershipApi(token: string) {
  return async (method: string, path: string, body?: unknown): Promise<Response> => {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json", "x-icg-token": token },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    return res;
  };
}

export { apiGet };
