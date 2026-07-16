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

// --- Period selector ---
export type PeriodKey =
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "this_year";

export const PERIOD_OPTIONS: { key: PeriodKey; label: string }[] = [
  { key: "this_week", label: "This Week" },
  { key: "last_week", label: "Last Week" },
  { key: "this_month", label: "This Month" },
  { key: "last_month", label: "Last Month" },
  { key: "this_year", label: "This Year" },
];

// --- Shared data types (mirror server/icg/metrics.ts) ---
export interface Dashboard {
  generatedAt: string;
  cached: boolean;
  cacheAgeSec: number;
  period: { key: PeriodKey; label: string; start: string; end: string };
  pipelines: { id: string; name: string; total: number }[];
  marketing: {
    newLeads7: number;
    newLeads30: number;
    newLeads90: number;
    totalDeals: number;
    periodLeads: number;
    sources: { name: string; count: number }[];
    trend: { date: string; count: number }[];
    sampleSize: number;
    leadBooking: {
      ok: boolean;
      meta: { leads: number; booked: number; bookRate: number };
      embr: { leads: number; booked: number; bookRate: number };
      total: { leads: number; booked: number; bookRate: number };
    };
  };
  embr: {
    cpl: number;
    ok: boolean;
    error?: string;
    last7: { leads: number; spend: number; cpl: number };
    last30: { leads: number; spend: number; cpl: number };
    last90: { leads: number; spend: number; cpl: number };
    total: { leads: number; spend: number; cpl: number };
    period?: { leads: number; spend: number; cpl: number };
  };
  // Memberships sold in the period attributed to each acquisition channel
  // (via the sold deal's contact lead_source). Denominator for CAC.
  soldByChannel: { meta: number; embr: number };
  salesFunnel: SalesFunnel;
  consultants: {
    name: string;
    deals: number;
    dsBooked: number;
    dsScheduled: number;
    dsSat: number;
    showUp: number | null;
    sold: number;
    talkMs: number;
    bookings: { client: string; date: string }[];
    scheduleds: { client: string; date: string }[];
    sats: { client: string; date: string }[];
  }[];
  strategists: {
    name: string;
    assigned: number;
    sold: number;
    conversion: number;
    dsBooked: number;
    dsSat: number;
    satConversion: number | null;
    soldOnSession: number;
    soldFollowUp: number;
    memberships: {
      name: string;
      tier: string;
      closedate: string;
      onSession: boolean;
      url: string;
    }[];
  }[];
  memberships: { bronze: number; silver: number; gold: number; total: number };
  contracts: ContractsData;
  financial: {
    totalValue: number;
    dealCount: number;
    byPipeline: { name: string; count: number; value: number }[];
    monthly: { month: string; value: number }[];
  };
}

export interface ContractStep {
  key: string;
  label: string;
  count: number;
  value: number;
}

export interface ContractStrategistRow {
  name: string;
  total: number;
  // one count per funnel step key (eoi, issued, signed, exchanged, uc)
  [stepKey: string]: number | string;
}

export interface ContractsData {
  totalContracts: number;
  pipelineValue: number;
  funnel: ContractStep[];
  byStrategist: ContractStrategistRow[];
  steps: { key: string; label: string }[];
  recent: ContractDeal[];
  // Full list of every contract deal in the selected period (no cap).
  deals: ContractDeal[];
}

export interface ContractDeal {
  name: string;
  step: string;
  stage: string;
  amount: number;
  owner: string;
  date: string;
  url: string;
  // Milestone dates (cumulative): when the deal reached EOI / UC. A deal may
  // carry both (it did EOI then progressed to UC).
  eoiDate?: string;
  ucDate?: string;
  reachedUC?: boolean;
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
  end: string;
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
  window?: FunnelWindow;
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
