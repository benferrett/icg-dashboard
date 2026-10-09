import { useQuery } from "@tanstack/react-query";
import {
  apiGet,
  BusinessPerformance,
  BizGranularity,
  BizPerfRow,
} from "@/lib/api";
import { fmtNumber, timeAgo } from "@/lib/format";
import { Section } from "@/components/dashboard/Section";
import { Stat } from "@/components/dashboard/Stat";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TrendingUp, BarChart3, Table2 } from "lucide-react";
import { useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { ChartTooltip } from "./shared";

// Six-metric colour map, kept stable across the chart + table so a metric's
// colour is consistent everywhere on the page.
const METRIC_META: { key: keyof BizPerfRow; label: string; color: string }[] = [
  { key: "leads", label: "Leads", color: "hsl(217 91% 60%)" },
  { key: "bookings", label: "Bookings", color: "hsl(38 92% 50%)" },
  { key: "scheduled", label: "Scheduled DS", color: "hsl(48 96% 53%)" },
  { key: "sats", label: "Sats", color: "hsl(160 84% 39%)" },
  { key: "members", label: "Members", color: "hsl(280 65% 60%)" },
  { key: "eois", label: "Gross EOIs", color: "hsl(0 72% 55%)" },
  { key: "eoiRefunds", label: "EOI refunds", color: "hsl(25 85% 45%)" },
  { key: "uc", label: "UC", color: "hsl(190 90% 42%)" },
];

// Trend chart split: Leads is drawn as a line on its own right-hand axis;
// every other metric is a bar on the left-hand axis.
const LEADS_META = METRIC_META.find((m) => m.key === "leads")!;
const BAR_METRICS = METRIC_META.filter((m) => m.key !== "leads");
const fmtAxis = (v: number) =>
  v >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : `${v}`;

// Business Performance: a week-by-week OR month-by-month trend across the six
// headline metrics over the trailing 12 units. This view owns its OWN data
// (independent of the global period selector) — it always spans the last 12
// weeks/months.
export function BusinessPerformanceView({ token }: { token: string }) {
  const [granularity, setGranularity] = useState<BizGranularity>("week");

  const q = useQuery<BusinessPerformance>({
    queryKey: ["/api/business-performance", granularity],
    queryFn: () =>
      apiGet<BusinessPerformance>(
        `/api/business-performance?granularity=${granularity}`,
        token,
      ),
  });

  const data = q.data;
  const rows = data?.rows ?? [];
  const unit = granularity === "week" ? "week" : "month";
  // Week view is a trailing 12-week window; month view is anchored to Jan 2026
  // and grows each month, so describe the range from the actual bucket count.
  const rangeLabel =
    granularity === "month"
      ? `Since Jan 2026 · ${rows.length} month${rows.length === 1 ? "" : "s"}`
      : `Last ${rows.length || 12} weeks`;

  return (
    <div className="flex flex-col gap-8">
      {/* Header: granularity toggle + freshness */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-md border p-0.5" data-testid="biz-granularity">
          {(["week", "month"] as BizGranularity[]).map((g) => (
            <button
              key={g}
              data-testid={`biz-gran-${g}`}
              onClick={() => setGranularity(g)}
              className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                granularity === g
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {g === "week" ? "Week by week" : "Month by month"}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          {rangeLabel}{" "}
          {data ? `· updated ${timeAgo(data.generatedAt)}` : "· loading…"}
        </span>
      </div>
      <p className="-mt-5 text-xs text-muted-foreground" data-testid="biz-eoi-reporting-note">
        Gross EOIs stay in the period of their EOI Paid Date (stage-entry date if
        unavailable), even after cancellation. Refunds are counted separately by
        cancellation date, not deducted from gross EOIs.
      </p>

      {q.isError ? (
        <Card className="p-4 border-destructive/40" role="alert">
          <p className="text-sm">Business performance could not be loaded. No incomplete EOI totals are shown.</p>
          <button className="mt-3 text-sm underline" data-testid="biz-retry" onClick={() => q.refetch()}>
            Retry
          </button>
        </Card>
      ) : q.isLoading || !data ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <>
          {/* 12-unit totals */}
          <Section
            title={`${rangeLabel.replace(/ · updated.*/, "")} · totals`}
            icon={<TrendingUp className="h-4 w-4 text-primary" />}
          >
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
              {METRIC_META.map((m) => (
                <Stat
                  key={m.key}
                  label={m.label}
                  value={fmtNumber(data.totals[m.key] ?? 0)}
                  sub={`per ${unit} avg ${(
                    (data.totals[m.key] ?? 0) / Math.max(1, rows.length)
                  ).toFixed(1)}`}
                  testId={`biz-total-${m.key}`}
                />
              ))}
            </div>
          </Section>

          {/* Trend chart */}
          <Section
            title="Trend"
            icon={<BarChart3 className="h-4 w-4 text-primary" />}
          >
            <Card className="p-4">
              <div className="h-[360px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={rows}
                    barCategoryGap="18%"
                    barGap={1}
                    margin={{ top: 8, right: 4, left: -8, bottom: 4 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      className="stroke-border"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11 }}
                      className="text-muted-foreground"
                      interval="preserveStartEnd"
                    />
                    {/* Left axis: everything except Leads (bars). */}
                    <YAxis
                      yAxisId="left"
                      tick={{ fontSize: 11 }}
                      className="text-muted-foreground"
                      allowDecimals={false}
                      width={44}
                      tickFormatter={fmtAxis}
                    />
                    {/* Right axis: Leads only (line). Leads run an order of
                        magnitude higher than the rest, so they get their own
                        scale to stop the other bars collapsing to slivers. */}
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      tick={{ fontSize: 11, fill: LEADS_META.color }}
                      stroke={LEADS_META.color}
                      allowDecimals={false}
                      width={44}
                      tickFormatter={fmtAxis}
                      label={{
                        value: "Leads",
                        angle: 90,
                        position: "insideRight",
                        offset: 8,
                        style: { fontSize: 11, fill: LEADS_META.color },
                      }}
                    />
                    <Tooltip
                      content={<ChartTooltip />}
                      cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                      iconType="square"
                    />
                    {BAR_METRICS.map((m) => (
                      <Bar
                        key={m.key}
                        yAxisId="left"
                        dataKey={m.key}
                        name={m.label}
                        fill={m.color}
                        fillOpacity={m.key === "eoiRefunds" ? 0.55 : 1}
                        radius={[2, 2, 0, 0]}
                        maxBarSize={18}
                      />
                    ))}
                    <Line
                      yAxisId="right"
                      type="linear"
                      dataKey={LEADS_META.key}
                      name={`${LEADS_META.label} (right axis)`}
                      stroke={LEADS_META.color}
                      strokeWidth={2.5}
                      dot={{ r: 3, fill: LEADS_META.color }}
                      activeDot={{ r: 5 }}
                      legendType="line"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </Section>

          {/* Full table */}
          <Section
            title={`${granularity === "week" ? "Weekly" : "Monthly"} breakdown`}
            icon={<Table2 className="h-4 w-4 text-primary" />}
          >
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="whitespace-nowrap">
                        {granularity === "week" ? "Week of" : "Month"}
                      </TableHead>
                      {METRIC_META.map((m) => (
                        <TableHead key={m.key} className="text-right">
                          <span
                            className="inline-flex items-center gap-1.5"
                            style={{ color: m.color }}
                          >
                            <span
                              className="inline-block h-2 w-2 rounded-full"
                              style={{ background: m.color }}
                            />
                            {m.label}
                          </span>
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...rows]
                      .slice()
                      .reverse()
                      .map((r, i) => (
                        <TableRow
                          key={r.start}
                          data-testid={`biz-row-${i}`}
                          className={i === 0 ? "bg-primary/5" : ""}
                        >
                          <TableCell className="font-medium whitespace-nowrap">
                            {r.label}
                            {i === 0 && (
                              <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                                current
                              </span>
                            )}
                          </TableCell>
                          {METRIC_META.map((m) => (
                            <TableCell
                              key={m.key}
                              className="text-right tabular-nums"
                            >
                              {fmtNumber(r[m.key] as number)}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    {/* Totals row */}
                    <TableRow className="border-t-2 font-semibold">
                      <TableCell className="whitespace-nowrap">Total</TableCell>
                      {METRIC_META.map((m) => (
                        <TableCell
                          key={m.key}
                          className="text-right tabular-nums"
                        >
                          {fmtNumber(data.totals[m.key] ?? 0)}
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </Card>
          </Section>
        </>
      )}
    </div>
  );
}
