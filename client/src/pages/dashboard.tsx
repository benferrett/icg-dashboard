import { useQuery } from "@tanstack/react-query";
import { apiGet, Dashboard, MetaData, PeriodKey, PERIOD_OPTIONS } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { Logo } from "@/components/dashboard/Logo";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  RefreshCw,
  LogOut,
  LayoutDashboard,
  Megaphone,
  Users,
  Target,
  FileSignature,
  TrendingUp,
  AlertTriangle,
  Moon,
  Sun,
  Menu,
} from "lucide-react";
import { useState, useEffect } from "react";
import { OverviewView } from "./views/OverviewView";
import { MarketingView } from "./views/MarketingView";
import { ConsultantsView } from "./views/ConsultantsView";
import { StrategistsView } from "./views/StrategistsView";
import { ContractsView } from "./views/ContractsView";
import { BusinessPerformanceView } from "./views/BusinessPerformanceView";

type TabKey =
  | "overview"
  | "marketing"
  | "consultants"
  | "strategists"
  | "contracts"
  | "business";

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: "overview", label: "Overview", icon: <LayoutDashboard className="h-4 w-4" /> },
  { key: "marketing", label: "Marketing", icon: <Megaphone className="h-4 w-4" /> },
  { key: "consultants", label: "Consultants", icon: <Users className="h-4 w-4" /> },
  { key: "strategists", label: "Strategists", icon: <Target className="h-4 w-4" /> },
  { key: "contracts", label: "Contracts", icon: <FileSignature className="h-4 w-4" /> },
  { key: "business", label: "Business Performance", icon: <TrendingUp className="h-4 w-4" /> },
];

function useDarkMode() {
  const [dark, setDark] = useState(
    typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);
  return { dark, toggle: () => setDark((d) => !d) };
}

export default function DashboardPage({
  token,
  onLogout,
}: {
  token: string;
  onLogout: () => void;
}) {
  const { dark, toggle } = useDarkMode();
  const [refreshing, setRefreshing] = useState(false);
  const [period, setPeriod] = useState<PeriodKey>("this_week");
  const [tab, setTab] = useState<TabKey>("overview");
  const [navOpen, setNavOpen] = useState(false);

  const dash = useQuery<Dashboard>({
    queryKey: ["/api/dashboard", period],
    queryFn: () => apiGet<Dashboard>(`/api/dashboard?period=${period}`, token),
  });
  const meta = useQuery<MetaData>({
    queryKey: ["/api/meta", period],
    queryFn: () => apiGet<MetaData>(`/api/meta?period=${period}`, token),
  });

  useEffect(() => {
    if (
      (dash.error as Error)?.message === "UNAUTHORIZED" ||
      (meta.error as Error)?.message === "UNAUTHORIZED"
    ) {
      onLogout();
    }
  }, [dash.error, meta.error, onLogout]);

  async function refresh() {
    setRefreshing(true);
    await Promise.all([
      apiGet(`/api/dashboard?period=${period}&refresh=1`, token).catch(() => {}),
      apiGet(`/api/meta?period=${period}&refresh=1`, token).catch(() => {}),
    ]);
    await Promise.all([dash.refetch(), meta.refetch()]);
    setRefreshing(false);
  }

  const d = dash.data;
  const loading = dash.isLoading;
  const periodLabel =
    d?.period.label ?? PERIOD_OPTIONS.find((p) => p.key === period)?.label ?? "";

  const activeTab = TABS.find((t) => t.key === tab)!;

  const NavItems = () => (
    <>
      {TABS.map((t) => (
        <button
          key={t.key}
          data-testid={`nav-${t.key}`}
          onClick={() => {
            setTab(t.key);
            setNavOpen(false);
          }}
          className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors text-left ${
            tab === t.key
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          {t.icon}
          <span>{t.label}</span>
        </button>
      ))}
    </>
  );

  return (
    <div className="h-[100dvh] flex flex-col overflow-hidden bg-background text-foreground">
      {/* Header */}
      <header className="flex items-center justify-between gap-4 border-b px-4 md:px-6 py-3 shrink-0">
        <div className="flex items-center gap-3">
          <Button
            size="icon"
            variant="ghost"
            className="lg:hidden"
            onClick={() => setNavOpen((o) => !o)}
            data-testid="button-nav-toggle"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <Logo size={30} className="text-primary" />
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold">Inner Circle Group</span>
            <span className="text-xs text-muted-foreground">Business Dashboard</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {tab !== "business" && (
            <Select value={period} onValueChange={(v) => setPeriod(v as PeriodKey)}>
              <SelectTrigger className="w-[140px] h-9" data-testid="select-period">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIOD_OPTIONS.map((p) => (
                  <SelectItem key={p.key} value={p.key} data-testid={`period-${p.key}`}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <span className="hidden md:inline text-xs text-muted-foreground tabular-nums">
            {d ? `Updated ${timeAgo(d.generatedAt)}` : "Loading…"}
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={refresh}
            disabled={refreshing || loading}
            data-testid="button-refresh"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline ml-1">Refresh</span>
          </Button>
          <Button size="icon" variant="ghost" onClick={toggle} data-testid="button-theme">
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <Button size="icon" variant="ghost" onClick={onLogout} data-testid="button-logout">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Body: sidebar + content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar — desktop */}
        <aside className="hidden lg:flex w-56 shrink-0 flex-col gap-1 border-r p-3 overflow-y-auto">
          <NavItems />
        </aside>

        {/* Sidebar — mobile drawer */}
        {navOpen && (
          <div className="lg:hidden fixed inset-0 z-40 flex">
            <div
              className="absolute inset-0 bg-black/40"
              onClick={() => setNavOpen(false)}
            />
            <aside className="relative z-50 w-60 bg-background border-r p-3 flex flex-col gap-1 overflow-y-auto">
              <NavItems />
            </aside>
          </div>
        )}

        {/* Content */}
        <main
          className="flex-1 overflow-y-auto px-4 md:px-6 py-6"
          style={{ overscrollBehavior: "contain" }}
        >
          {/* Section title bar */}
          <div className="flex items-center gap-2 mb-6">
            <span className="text-primary">{activeTab.icon}</span>
            <h1 className="text-lg font-semibold">{activeTab.label}</h1>
            {tab !== "business" && (
              <span className="text-sm text-muted-foreground ml-2">
                · {periodLabel}
              </span>
            )}
          </div>

          {dash.error && (dash.error as Error).message !== "UNAUTHORIZED" && (
            <Card className="mb-6 p-4 border-destructive/40 flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
              <div className="text-sm">
                <div className="font-medium">Couldn’t load live data</div>
                <div className="text-muted-foreground">
                  {(dash.error as Error).message}
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="ml-auto"
                onClick={() => dash.refetch()}
              >
                Retry
              </Button>
            </Card>
          )}

          {tab === "overview" && (
            <OverviewView d={d} meta={meta.data} loading={loading} periodLabel={periodLabel} />
          )}
          {tab === "marketing" && (
            <MarketingView
              d={d}
              meta={meta.data}
              metaLoading={meta.isLoading}
              loading={loading}
              periodLabel={periodLabel}
            />
          )}
          {tab === "consultants" && (
            <ConsultantsView d={d} loading={loading} periodLabel={periodLabel} />
          )}
          {tab === "strategists" && (
            <StrategistsView d={d} loading={loading} periodLabel={periodLabel} />
          )}
          {tab === "contracts" && (
            <ContractsView d={d} loading={loading} periodLabel={periodLabel} />
          )}
          {tab === "business" && <BusinessPerformanceView token={token} />}

          <footer className="text-center text-xs text-muted-foreground pt-8 pb-4">
            Live data from HubSpot &amp; Meta · cached up to 5 min · Inner Circle Group
          </footer>
        </main>
      </div>
    </div>
  );
}
