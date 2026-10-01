import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OverviewView } from "./pages/views/OverviewView";
import { BusinessPerformanceView } from "./pages/views/BusinessPerformanceView";
import "./index.css";

// Synthetic fixture only: no CRM records or production credentials in preview.
function App() {
  const [tab, setTab] = useState("Overview");
  const [month, setMonth] = useState("September");
  const [empty, setEmpty] = useState(false);
  const [dark, setDark] = useState(false);
  const value = (n: number) => empty ? 0 : n;
  const client = useMemo(() => {
    const q = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, enabled: false } } });
    for (const granularity of ["week", "month"]) {
      const rows = granularity === "month" ? [
        { label: "Aug 26", start: "2026-07-31T14:00:00Z", end: "2026-08-31T14:00:00Z", leads: 250, bookings: 70, scheduled: 60, sats: 42, members: 14, eois: 10, eoiRefunds: 0, uc: 5 },
        { label: "Sep 26", start: "2026-08-31T14:00:00Z", end: "2026-09-30T14:00:00Z", leads: 320, bookings: 80, scheduled: 70, sats: 50, members: 18, eois: 16, eoiRefunds: 3, uc: 7 },
        { label: "Oct 26", start: "2026-09-30T14:00:00Z", end: "2026-10-31T14:00:00Z", leads: 12, bookings: 4, scheduled: 3, sats: 2, members: 1, eois: 0, eoiRefunds: 1, uc: 1 },
      ] : [
        { label: "21 Sep", start: "2026-09-20T14:00:00Z", end: "2026-09-27T14:00:00Z", leads: 60, bookings: 20, scheduled: 18, sats: 14, members: 5, eois: 3, eoiRefunds: 0, uc: 2 },
        { label: "28 Sep", start: "2026-09-27T14:00:00Z", end: "2026-10-04T14:00:00Z", leads: 72, bookings: 22, scheduled: 20, sats: 16, members: 6, eois: 5, eoiRefunds: 2, uc: 3 },
      ];
      const keys = ["leads", "bookings", "scheduled", "sats", "members", "eois", "eoiRefunds", "uc"];
      const previewRows = rows.map(r => ({ ...r, ...Object.fromEntries(keys.map(k => [k, empty ? 0 : (r as any)[k]])) }));
      q.setQueryData(["/api/business-performance", granularity], {
        granularity, generatedAt: new Date().toISOString(), rows: previewRows,
        totals: Object.fromEntries(keys.map(k => [k, previewRows.reduce((s, r) => s + (r as any)[k], 0)])),
      });
    }
    return q;
  }, [empty]);
  const september = month === "September";
  const win = {
    dsBooked: value(80), dsStarted: value(70), dsScheduled: value(70), dsSat: value(50),
    membershipsSold: value(18), membershipTiers: { Silver: value(18) },
    totals: { leads: value(320), contacted: value(280), connected: value(180), contactRate: value(88), connectRate: value(56) },
  };
  const d: any = {
    salesFunnel: { ok: true, window: win }, embr: { period: { leads: value(120) } },
    contracts: { funnel: [
      { key: "eoi", count: value(september ? 16 : 0), value: value(september ? 8000000 : 0) },
      { key: "uc", count: value(september ? 7 : 1), value: value(september ? 3500000 : 500000) },
    ], eoiRefunds: value(september ? 3 : 1) },
  };
  return <QueryClientProvider key={empty ? "empty" : "sample"} client={client}>
    <main className={`min-h-screen bg-background text-foreground ${dark ? "dark" : ""}`} style={{ padding: "clamp(16px,3vw,40px)" }}>
      <header className="mb-8">
        <h1 className="text-xl font-semibold">ICG Gross EOI Reporting Preview</h1>
        <p className="mt-3 text-sm text-muted-foreground">Synthetic demonstration only. The live dashboard is unchanged pending release approval.</p>
        <div className="mt-5 flex flex-wrap gap-2">
          {["Overview", "Business Performance"].map(t => <button data-testid={`preview-${t}`} key={t} onClick={() => setTab(t)} className={`border rounded-md px-4 py-2 ${tab === t ? "bg-primary text-primary-foreground" : ""}`}>{t}</button>)}
          {tab === "Overview" && <select aria-label="Overview month" data-testid="preview-month" value={month} onChange={e => setMonth(e.target.value)} className="border rounded-md px-3 bg-background">
            <option>September</option><option>October</option>
          </select>}
          <button data-testid="preview-empty" className="border rounded-md px-4 py-2" onClick={() => setEmpty(!empty)}>{empty ? "Show sample data" : "Show zero activity"}</button>
          <button data-testid="preview-theme" className="border rounded-md px-4 py-2" onClick={() => setDark(!dark)}>Toggle theme</button>
        </div>
      </header>
      {tab === "Overview" ? <OverviewView d={d} loading={false} periodLabel={month} meta={{ status: "ok", totals: { leads: value(200) } } as any}/> : <BusinessPerformanceView token="synthetic-preview"/>}
    </main>
  </QueryClientProvider>;
}
createRoot(document.getElementById("root")!).render(<App/>);
