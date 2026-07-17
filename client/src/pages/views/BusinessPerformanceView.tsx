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
  LineChart,
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
  { key: "sats", label: "Sats", color: "hsl(160 84% 39%)" },
  { key: "members", label: "Members", color: "hsl(280 65% 60%)" },
  { key: "eois", label: "EOIs", color: "hsl(0 72% 55%)" },
  { key: "uc", label: "UC", color: "hsl(190 90% 42%)" },
];

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
          Last 12 {unit}s{" "}
          {data ? `· updated ${timeAgo(data.generatedAt)}` : "· loading…"}
        </span>
      </div>

      {q.isLoading || !data ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <>
          {/* 12-unit totals */}
          <Section
            title={`Last 12 ${unit}s · totals`}
            icon={<TrendingUp className="h-4 w-4 text-primary" />}
          >
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
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
                  <LineChart
                    data={rows}
                    margin={{ top: 8, right: 12, left: -8, bottom: 4 }}
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
                    <YAxis
                      tick={{ fontSize: 11 }}
                      className="text-muted-foreground"
                      allowDecimals={false}
                      width={36}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend
                      wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                      iconType="circle"
                    />
                    {METRIC_META.map((m) => (
                      <Line
                        key={m.key}
                        type="monotone"
                        dataKey={m.key}
                        name={m.label}
                        stroke={m.color}
                        strokeWidth={2}
                        dot={{ r: 2 }}
                        activeDot={{ r: 4 }}
                      />
                    ))}
                  </LineChart>
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
