// Token-aware API helpers for the ICG dashboard.
// The session token lives in React state (no localStorage in the sandbox iframe),
// so callers pass it in. We send it as the x-icg-token header.

const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

export async function login(password: string): Promise<string> {
  const res = await fetch(`${API_BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || "Login failed");
  }
  const j = await res.json();
  return j.token as string;
}

export async function apiGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "x-icg-token": token },
  });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// --- Shared data types (mirror server/icg/metrics.ts) ---
export interface Dashboard {
  generatedAt: string;
  cached: boolean;
  cacheAgeSec: number;
  pipelines: { id: string; name: string; total: number }[];
  marketing: {
    newLeads7: number;
    newLeads30: number;
    newLeads90: number;
    totalDeals: number;
    sources: { name: string; count: number }[];
    trend: { date: string; count: number }[];
    sampleSize: number;
  };
  embr: {
    cpl: number;
    ok: boolean;
    error?: string;
    last7: { leads: number; spend: number; cpl: number };
    last30: { leads: number; spend: number; cpl: number };
    last90: { leads: number; spend: number; cpl: number };
    total: { leads: number; spend: number; cpl: number };
  };
  salesFunnel: SalesFunnel;
  consultants: { name: string; deals: number; dsBooked: number; sold: number }[];
  strategists: { name: string; assigned: number; sold: number; conversion: number }[];
  memberships: { bronze: number; silver: number; gold: number; total: number };
  contracts: {
    totalContracts: number;
    pipelineValue: number;
    contractStatus: { name: string; count: number }[];
    byStage: { name: string; count: number }[];
    recent: {
      name: string;
      stage: string;
      contractStatus: string;
      paymentStatus: string;
      amount: number;
      owner: string;
      url: string;
    }[];
  };
  financial: {
    totalValue: number;
    dealCount: number;
    byPipeline: { name: string; count: number; value: number }[];
    monthly: { month: string; value: number }[];
  };
}

export interface FunnelConsultant {
  name: string;
  leads: number;
  contacted: number;
  connected: number;
  contactRate: number;
  connectRate: number;
}

export interface FunnelWindow {
  label: string;
  start: string;
  consultants: FunnelConsultant[];
  totals: {
    leads: number;
    contacted: number;
    connected: number;
    contactRate: number;
    connectRate: number;
  };
  dsBooked: number;
  dsStarted: number;
  dsSat: number;
  membershipsSold: number;
  membershipTiers: Record<string, number>;
}

export interface SalesFunnel {
  ok: boolean;
  error?: string;
  week?: FunnelWindow;
  month?: FunnelWindow;
  fy?: FunnelWindow;
}

export interface MetaData {
  status: "ok" | "error" | "no_accounts";
  message?: string;
  code?: number;
  window?: string;
  cached?: boolean;
  cacheAgeSec?: number;
  accounts?: {
    accountId: string;
    name: string;
    currency: string;
    spend: number;
    impressions: number;
    clicks: number;
    ctr: number;
    cpc: number;
    leads: number;
    cpl: number;
  }[];
  totals?: {
    spend: number;
    leads: number;
    clicks: number;
    impressions: number;
    cpl: number;
    currency: string;
  };
}
