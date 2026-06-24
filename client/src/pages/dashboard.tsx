import { useQuery } from "@tanstack/react-query";
import { apiGet, Dashboard, MetaData } from "@/lib/api";
import { fmtCurrency, fmtNumber, fmtMonth, fmtDateShort, timeAgo } from "@/lib/format";
import { Logo } from "@/components/dashboard/Logo";
import { Stat } from "@/components/dashboard/Stat";
import { Section } from "@/components/dashboard/Section";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from "recharts";
import {
  RefreshCw,
  LogOut,
  Megaphone,
  Users,
  Target,
  FileSignature,
  DollarSign,
  TrendingUp,
  Facebook,
  AlertTriangle,
  Moon,
  Sun,
  Layers,
} from "lucide-react";
import { useState, useEffect } from "react";

const CHART_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
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

function ChartTooltip({ active, payload, label, valueFmt }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="font-medium mb-0.5">{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} className="tabular-nums text-muted-foreground">
          {valueFmt ? valueFmt(p.value) : p.value}
        </div>
      ))}
    </div>
  );
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

  const dash = useQuery<Dashboard>({
    queryKey: ["/api/dashboard"],
    queryFn: () => apiGet<Dashboard>("/api/dashboard", token),
  });
  const meta = useQuery<MetaData>({
    queryKey: ["/api/meta"],
    queryFn: () => apiGet<MetaData>("/api/meta", token),
  });

  // Surface auth failures by logging out
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
      apiGet("/api/dashboard?refresh=1", token).catch(() => {}),
      apiGet("/api/meta?refresh=1", token).catch(() => {}),
    ]);
    await Promise.all([dash.refetch(), meta.refetch()]);
    setRefreshing(false);
  }

  const d = dash.data;
  const loading = dash.isLoading;

  return (
    <div className="h-[100dvh] flex flex-col overflow-hidden bg-background text-foreground">
      {/* Header */}
      <header className="flex items-center justify-between gap-4 border-b px-6 py-3 shrink-0">
        <div className="flex items-center gap-3">
          <Logo size={30} className="text-primary" />
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold">Inner Circle Group</span>
            <span className="text-xs text-muted-foreground">Business Dashboard</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden sm:inline text-xs text-muted-foreground tabular-nums">
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

      {/* Scroll region */}
      <main
        className="flex-1 overflow-y-auto px-6 py-6 flex flex-col gap-8"
        style={{ overscrollBehavior: "contain" }}
      >
        {dash.error && (dash.error as Error).message !== "UNAUTHORIZED" && (
          <Card className="p-4 border-destructive/40 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
            <div className="text-sm">
              <div className="font-medium">Couldn’t load live data</div>
              <div className="text-muted-foreground">{(dash.error as Error).message}</div>
            </div>
            <Button size="sm" variant="outline" className="ml-auto" onClick={() => dash.refetch()}>
              Retry
            </Button>
          </Card>
        )}

        {/* KPI ROW */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)
          ) : d ? (
            <>
              <Stat
                label="New leads · 7d"
                value={fmtNumber(d.marketing.newLeads7)}
                sub={`${fmtNumber(d.marketing.newLeads30)} in 30d`}
                testId="stat-leads7"
                accent
              />
              <Stat
                label="Memberships sold"
                value={fmtNumber(d.memberships.total)}
                sub={`${d.memberships.gold}G · ${d.memberships.silver}S · ${d.memberships.bronze}B`}
                testId="stat-memberships"
              />
              <Stat
                label="Active contracts"
                value={fmtNumber(d.contracts.totalContracts)}
                sub={fmtCurrency(d.contracts.pipelineValue, true)}
                testId="stat-contracts"
              />
              <Stat
                label="Property pipeline"
                value={fmtCurrency(d.financial.totalValue, true)}
                sub={`${fmtNumber(d.financial.dealCount)} deals`}
                testId="stat-pipeline-value"
              />
              <Stat
                label="Total deals"
                value={fmtNumber(d.marketing.totalDeals)}
                sub="all-time"
                testId="stat-total-deals"
              />
              <Stat
                label="Ad spend · 30d"
                value={
                  meta.data?.status === "ok" && meta.data.totals
                    ? fmtCurrency(meta.data.totals.spend, true)
                    : "—"
                }
                sub={
                  meta.data?.status === "ok" && meta.data.totals
                    ? `${fmtNumber(meta.data.totals.leads)} leads`
                    : "Meta offline"
                }
                testId="stat-adspend"
              />
            </>
          ) : null}
        </div>

        {/* MARKETING */}
        <Section title="Marketing" icon={<Megaphone className="h-4 w-4 text-primary" />}>
          <div className="grid lg:grid-cols-3 gap-4">
            <Card className="p-4 lg:col-span-2">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium">New leads · last 30 days</span>
                {d && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {fmtNumber(d.marketing.newLeads90)} in 90d
                  </span>
                )}
              </div>
              {loading || !d ? (
                <Skeleton className="h-48 w-full" />
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={d.marketing.trend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="leadFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tickFormatter={fmtDateShort}
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      interval={6}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      tickLine={false}
                      axisLine={false}
                      width={34}
                    />
                    <Tooltip
                      content={(p) => (
                        <ChartTooltip {...p} label={p.label ? fmtDateShort(p.label as string) : ""} valueFmt={(v: number) => `${v} leads`} />
                      )}
                    />
                    <Area
                      type="monotone"
                      dataKey="count"
                      stroke="hsl(var(--chart-1))"
                      strokeWidth={2}
                      fill="url(#leadFill)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </Card>

            <Card className="p-4">
              <span className="text-sm font-medium">Lead sources · 90d</span>
              <div className="mt-3 flex flex-col gap-2.5">
                {loading || !d
                  ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)
                  : d.marketing.sources.slice(0, 6).map((s, i) => {
                      const max = d.marketing.sources[0]?.count || 1;
                      return (
                        <div key={s.name} className="flex flex-col gap-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="truncate">{s.name}</span>
                            <span className="tabular-nums text-muted-foreground">
                              {fmtNumber(s.count)}
                            </span>
                          </div>
                          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${(s.count / max) * 100}%`,
                                background: CHART_COLORS[i % CHART_COLORS.length],
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
              </div>
            </Card>
          </div>
        </Section>

        {/* CONSULTANT + STRATEGIST TEAMS */}
        <div className="grid lg:grid-cols-2 gap-8">
          <Section title="Consultant team" icon={<Users className="h-4 w-4 text-primary" />}>
            <Card className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Consultant</TableHead>
                    <TableHead className="text-right">Leads · 90d</TableHead>
                    <TableHead className="text-right">DS booked</TableHead>
                    <TableHead className="text-right">Sold</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading || !d
                    ? Array.from({ length: 6 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell colSpan={4}>
                            <Skeleton className="h-5 w-full" />
                          </TableCell>
                        </TableRow>
                      ))
                    : d.consultants.slice(0, 8).map((c) => (
                        <TableRow key={c.name} data-testid={`row-consultant-${c.name}`}>
                          <TableCell className="font-medium">{c.name}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtNumber(c.deals)}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtNumber(c.dsBooked)}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtNumber(c.sold)}</TableCell>
                        </TableRow>
                      ))}
                </TableBody>
              </Table>
            </Card>
          </Section>

          <Section title="Strategist team" icon={<Target className="h-4 w-4 text-primary" />}>
            <Card className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Strategist</TableHead>
                    <TableHead className="text-right">Assigned</TableHead>
                    <TableHead className="text-right">Sold</TableHead>
                    <TableHead className="text-right">Conv.</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading || !d
                    ? Array.from({ length: 6 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell colSpan={4}>
                            <Skeleton className="h-5 w-full" />
                          </TableCell>
                        </TableRow>
                      ))
                    : d.strategists.slice(0, 8).map((s) => (
                        <TableRow key={s.name} data-testid={`row-strategist-${s.name}`}>
                          <TableCell className="font-medium">{s.name}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtNumber(s.assigned)}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtNumber(s.sold)}</TableCell>
                          <TableCell className="text-right">
                            <Badge
                              variant={s.conversion >= 30 ? "default" : "secondary"}
                              className="tabular-nums"
                            >
                              {s.conversion}%
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                </TableBody>
              </Table>
            </Card>
          </Section>
        </div>

        {/* CONTRACTS / STATUS */}
        <Section title="Contracts & status" icon={<FileSignature className="h-4 w-4 text-primary" />}>
          <div className="grid lg:grid-cols-3 gap-4">
            <Card className="p-4">
              <span className="text-sm font-medium">Contract status</span>
              <div className="mt-3 flex flex-col gap-2.5">
                {loading || !d
                  ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)
                  : d.contracts.contractStatus.map((s, i) => {
                      const max = d.contracts.contractStatus[0]?.count || 1;
                      return (
                        <div key={s.name} className="flex flex-col gap-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="truncate">{s.name}</span>
                            <span className="tabular-nums text-muted-foreground">{s.count}</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${(s.count / max) * 100}%`,
                                background: CHART_COLORS[i % CHART_COLORS.length],
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
              </div>
            </Card>

            <Card className="p-4 lg:col-span-2 overflow-hidden">
              <span className="text-sm font-medium">Recent contracts</span>
              <div className="mt-2 -mx-4 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Deal</TableHead>
                      <TableHead>Stage</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading || !d
                      ? Array.from({ length: 5 }).map((_, i) => (
                          <TableRow key={i}>
                            <TableCell colSpan={4}>
                              <Skeleton className="h-5 w-full" />
                            </TableCell>
                          </TableRow>
                        ))
                      : d.contracts.recent.map((c, i) => (
                          <TableRow key={i} data-testid={`row-contract-${i}`}>
                            <TableCell className="font-medium max-w-[180px] truncate">
                              <a
                                href={c.url}
                                target="_blank"
                                rel="noreferrer"
                                className="hover:text-primary hover:underline"
                              >
                                {c.name}
                              </a>
                            </TableCell>
                            <TableCell className="max-w-[160px] truncate text-muted-foreground text-xs">
                              {c.stage}
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary" className="text-xs">
                                {c.contractStatus}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {c.amount ? fmtCurrency(c.amount, true) : "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                  </TableBody>
                </Table>
              </div>
            </Card>
          </div>
        </Section>

        {/* FINANCIAL */}
        <Section title="Financial performance" icon={<DollarSign className="h-4 w-4 text-primary" />}>
          <div className="grid lg:grid-cols-3 gap-4">
            <Card className="p-4 lg:col-span-2">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium">Pipeline value by month</span>
                {d && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {fmtCurrency(d.financial.totalValue, true)} total
                  </span>
                )}
              </div>
              {loading || !d ? (
                <Skeleton className="h-48 w-full" />
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={d.financial.monthly} margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis
                      dataKey="month"
                      tickFormatter={fmtMonth}
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tickFormatter={(v) => fmtCurrency(v, true)}
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      tickLine={false}
                      axisLine={false}
                      width={56}
                    />
                    <Tooltip
                      cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
                      content={(p) => (
                        <ChartTooltip
                          {...p}
                          label={p.label ? fmtMonth(p.label as string) : ""}
                          valueFmt={(v: number) => fmtCurrency(v)}
                        />
                      )}
                    />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]} fill="hsl(var(--chart-1))" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>

            <Card className="p-4">
              <span className="text-sm font-medium">Value by pipeline</span>
              <div className="mt-3 flex flex-col gap-3">
                {loading || !d
                  ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)
                  : d.financial.byPipeline
                      .slice()
                      .sort((a, b) => b.value - a.value)
                      .map((p) => (
                        <div
                          key={p.name}
                          className="flex items-center justify-between gap-3 text-sm"
                        >
                          <div className="flex flex-col">
                            <span className="font-medium truncate">{p.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {fmtNumber(p.count)} deals
                            </span>
                          </div>
                          <span className="tabular-nums font-semibold">
                            {fmtCurrency(p.value, true)}
                          </span>
                        </div>
                      ))}
              </div>
            </Card>
          </div>
        </Section>

        {/* META ADS */}
        <Section title="Meta ads · last 30 days" icon={<Facebook className="h-4 w-4 text-primary" />}>
          {meta.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : meta.data?.status === "ok" && meta.data.totals ? (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label="Spend" value={fmtCurrency(meta.data.totals.spend)} testId="meta-spend" accent />
                <Stat label="Leads" value={fmtNumber(meta.data.totals.leads)} testId="meta-leads" />
                <Stat
                  label="Cost per lead"
                  value={fmtCurrency(meta.data.totals.cpl)}
                  testId="meta-cpl"
                />
                <Stat
                  label="Clicks"
                  value={fmtNumber(meta.data.totals.clicks)}
                  sub={`${fmtNumber(meta.data.totals.impressions)} impr.`}
                  testId="meta-clicks"
                />
              </div>
              {meta.data.accounts && meta.data.accounts.length > 1 && (
                <Card className="overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Ad account</TableHead>
                        <TableHead className="text-right">Spend</TableHead>
                        <TableHead className="text-right">Leads</TableHead>
                        <TableHead className="text-right">CPL</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {meta.data.accounts.map((a) => (
                        <TableRow key={a.accountId}>
                          <TableCell className="font-medium">{a.name}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtCurrency(a.spend)}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtNumber(a.leads)}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtCurrency(a.cpl)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Card>
              )}
            </div>
          ) : (
            <Card className="p-4 border-amber-500/40 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
              <div className="text-sm">
                <div className="font-medium">Meta data unavailable</div>
                <div className="text-muted-foreground">
                  {meta.data?.message || "Could not reach the Meta API."}
                  {meta.data?.code === 190 &&
                    " Your Meta access token has expired — refresh it in the Meta credential to restore ad metrics."}
                </div>
              </div>
            </Card>
          )}
        </Section>

        {/* EMBR LEADS */}
        <Section title="EMBR leads" icon={<Layers className="h-4 w-4 text-primary" />}>
          <Card className="p-4">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-medium">
                Fixed-rate lead spend
              </span>
              <Badge variant="secondary" className="tabular-nums">
                {d ? fmtCurrency(d.embr.cpl) : "$154"} / lead
              </Badge>
            </div>
            {loading || !d ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-24 rounded-lg" />
                ))}
              </div>
            ) : d.embr.ok === false ? (
              <div className="flex items-start gap-3 rounded-md border border-amber-500/40 p-3">
                <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                <div className="text-sm">
                  <div className="font-medium">EMBR data unavailable</div>
                  <div className="text-muted-foreground">
                    The HubSpot token needs the{" "}
                    <span className="font-mono text-xs">crm.objects.contacts.read</span>{" "}
                    scope to read EMBR leads.
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat
                  label="Spend · 7d"
                  value={fmtCurrency(d.embr.last7.spend)}
                  sub={`${fmtNumber(d.embr.last7.leads)} leads`}
                  testId="embr-7"
                  accent
                />
                <Stat
                  label="Spend · 30d"
                  value={fmtCurrency(d.embr.last30.spend)}
                  sub={`${fmtNumber(d.embr.last30.leads)} leads`}
                  testId="embr-30"
                />
                <Stat
                  label="Spend · 90d"
                  value={fmtCurrency(d.embr.last90.spend)}
                  sub={`${fmtNumber(d.embr.last90.leads)} leads`}
                  testId="embr-90"
                />
                <Stat
                  label="Total to date"
                  value={fmtCurrency(d.embr.total.spend)}
                  sub={`${fmtNumber(d.embr.total.leads)} leads`}
                  testId="embr-total"
                />
              </div>
            )}
          </Card>
        </Section>

        <footer className="text-center text-xs text-muted-foreground pt-2 pb-4">
          Live data from HubSpot &amp; Meta · cached up to 5 min · Inner Circle Group
        </footer>
      </main>
    </div>
  );
}
