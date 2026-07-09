import { Dashboard, MetaData } from "@/lib/api";
import {
  fmtCurrency,
  fmtNumber,
  fmtMonth,
  fmtDateShort,
} from "@/lib/format";
import { Section } from "@/components/dashboard/Section";
import { Stat } from "@/components/dashboard/Stat";
import { Card } from "@/components/ui/card";
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
} from "recharts";
import { Megaphone, Facebook, Layers, DollarSign, AlertTriangle } from "lucide-react";
import { CHART_COLORS, ChartTooltip } from "./shared";

export function MarketingView({
  d,
  meta,
  metaLoading,
  loading,
  periodLabel,
}: {
  d?: Dashboard;
  meta?: MetaData;
  metaLoading: boolean;
  loading: boolean;
  periodLabel: string;
}) {
  return (
    <div className="flex flex-col gap-8">
      {/* LEADS */}
      <Section title="Lead generation" icon={<Megaphone className="h-4 w-4 text-primary" />}>
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
                <AreaChart
                  data={d.marketing.trend}
                  margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                >
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
                      <ChartTooltip
                        {...p}
                        label={p.label ? fmtDateShort(p.label as string) : ""}
                        valueFmt={(v: number) => `${v} leads`}
                      />
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
            <span className="text-sm font-medium">
              Lead sources · {periodLabel.toLowerCase()}
            </span>
            <div className="mt-3 flex flex-col gap-2.5">
              {loading || !d
                ? Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-6 w-full" />
                  ))
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

      {/* META ADS */}
      <Section
        title={`Meta ads · ${periodLabel.toLowerCase()}`}
        icon={<Facebook className="h-4 w-4 text-primary" />}
      >
        {metaLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : meta?.status === "ok" && meta.totals ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Spend" value={fmtCurrency(meta.totals.spend)} testId="meta-spend" accent />
              <Stat label="Leads" value={fmtNumber(meta.totals.leads)} testId="meta-leads" />
              <Stat label="Cost per lead" value={fmtCurrency(meta.totals.cpl)} testId="meta-cpl" />
              <Stat
                label="Clicks"
                value={fmtNumber(meta.totals.clicks)}
                sub={`${fmtNumber(meta.totals.impressions)} impr.`}
                testId="meta-clicks"
              />
            </div>
            {meta.accounts && meta.accounts.length > 1 && (
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
                    {meta.accounts.map((a) => (
                      <TableRow key={a.accountId}>
                        <TableCell className="font-medium">{a.name}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtCurrency(a.spend)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtNumber(a.leads)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtCurrency(a.cpl)}
                        </TableCell>
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
                {meta?.message || "Could not reach the Meta API."}
                {meta?.code === 190 &&
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
            <span className="text-sm font-medium">Fixed-rate lead spend</span>
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

      {/* FINANCIAL */}
      <Section
        title="Financial performance"
        icon={<DollarSign className="h-4 w-4 text-primary" />}
      >
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
                <BarChart
                  data={d.financial.monthly}
                  margin={{ top: 4, right: 8, left: 4, bottom: 0 }}
                >
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
                ? Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))
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
    </div>
  );
}
