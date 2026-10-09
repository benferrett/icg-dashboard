import { useQuery } from "@tanstack/react-query";
import {
  apiGet,
  ConsultantTeamPerformance,
  TeamPerfMetrics,
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
import { Users, BarChart3, Timer, Table2 } from "lucide-react";
import { useMemo, useState } from "react";
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
  ReferenceLine,
} from "recharts";

// Consultant Team Performance: week-by-week trend for the booking-consultant
// team (or one consultant), mirroring Business Performance. Every week uses
// the same sources as picking that week on the Consultants tab.

type CountKey = "leads" | "dials" | "over3mCalls" | "bookings";

const COLORS = {
  leads: "hsl(217 91% 60%)",
  dials: "hsl(262 70% 58%)",
  over3mCalls: "hsl(160 84% 39%)",
  bookings: "hsl(38 92% 50%)",
  speed: "hsl(0 72% 55%)",
  within5: "hsl(190 90% 42%)",
};

// Bars share the left axis; Dials (an order of magnitude bigger) is a line on
// its own right-hand axis so the bars stay readable.
const BAR_METRICS: { key: CountKey; label: string; color: string }[] = [
  { key: "leads", label: "Leads", color: COLORS.leads },
  { key: "over3mCalls", label: "3m+ calls", color: COLORS.over3mCalls },
  { key: "bookings", label: "Bookings", color: COLORS.bookings },
];

const SPEED_TARGET_MINS = 5;

const fmtAxis = (v: number) =>
  v >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : `${v}`;

export function fmtMins(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v < 60) return `${Number.isInteger(v) ? v : v.toFixed(1)} min`;
  const h = Math.floor(v / 60);
  const m = Math.round(v % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

const fmtPct = (v: number | null | undefined) => (v == null ? "—" : `${v}%`);

function NamedTooltip({ active, payload, label, fmt }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="font-medium mb-1">Week of {label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2 tabular-nums">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}</span>
          <span className="ml-auto font-medium">{fmt ? fmt(p.dataKey, p.value) : fmtNumber(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function ConsultantTeamPerformanceView({ token }: { token: string }) {
  const [who, setWho] = useState<string>("team");

  const q = useQuery<ConsultantTeamPerformance>({
    queryKey: ["/api/consultant-team-performance"],
    queryFn: () =>
      apiGet<ConsultantTeamPerformance>("/api/consultant-team-performance", token),
  });

  const data = q.data;
  const pick = (m: { team: TeamPerfMetrics; byConsultant: Record<string, TeamPerfMetrics> }) =>
    who === "team" ? m.team : m.byConsultant[who];

  const rows = useMemo(
    () =>
      (data?.rows ?? []).map((r) => {
        const m = pick(r) || ({} as TeamPerfMetrics);
        return { label: r.label, start: r.start, ...m };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, who],
  );
  const totals = data ? pick(data.totals) : null;
  const weeks = rows.length || 12;
  const avg = (n: number) => (n / Math.max(1, weeks)).toFixed(1);
  const whoLabel = who === "team" ? "Whole team" : who;

  return (
    <div className="flex flex-col gap-8">
      {/* Header: consultant filter + freshness */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex flex-wrap rounded-md border p-0.5" data-testid="teamperf-who">
          {["team", ...(data?.consultants ?? [])].map((n) => (
            <button
              key={n}
              data-testid={`teamperf-who-${n}`}
              onClick={() => setWho(n)}
              className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                who === n
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {n === "team" ? "Whole team" : n.split(" ")[0]}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          Last {weeks} weeks · {whoLabel}{" "}
          {data ? `· updated ${timeAgo(data.generatedAt)}` : "· loading…"}
        </span>
      </div>
      <p className="-mt-5 text-xs text-muted-foreground" data-testid="teamperf-note">
        Booking team: {(data?.consultants ?? []).join(", ") || "loading…"}. Leads and
        bookings match the Consultants tab for the same week. Dials are outbound
        calls made that week; 3m+ calls are connected calls of 3 minutes or more.
        Speed to lead is the median time from a lead being created to its first
        outbound call.
      </p>

      {q.isError ? (
        <Card className="p-4 border-destructive/40" role="alert">
          <p className="text-sm">Consultant team performance could not be loaded.</p>
          <button className="mt-3 text-sm underline" data-testid="teamperf-retry" onClick={() => q.refetch()}>
            Retry
          </button>
        </Card>
      ) : q.isLoading || !data || !totals ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <>
          {/* Totals */}
          <Section
            title={`Last ${weeks} weeks · totals`}
            icon={<Users className="h-4 w-4 text-primary" />}
          >
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              <Stat label="Leads" value={fmtNumber(totals.leads)} sub={`per week avg ${avg(totals.leads)}`} testId="teamperf-total-leads" />
              <Stat label="Dials" value={fmtNumber(totals.dials)} sub={`per week avg ${avg(totals.dials)}`} testId="teamperf-total-dials" />
              <Stat label="3m+ calls" value={fmtNumber(totals.over3mCalls)} sub={`per week avg ${avg(totals.over3mCalls)}`} testId="teamperf-total-over3m" />
              <Stat label="Bookings" value={fmtNumber(totals.bookings)} sub={`per week avg ${avg(totals.bookings)}`} testId="teamperf-total-bookings" />
              <Stat label="Speed to lead" value={fmtMins(totals.speedToLeadMins)} sub={`median · ${fmtNumber(totals.leadsTimed)} leads`} testId="teamperf-total-speed" />
              <Stat label="Called ≤ 5 min" value={fmtPct(totals.within5Pct)} sub="of leads with a first call" testId="teamperf-total-within5" />
            </div>
          </Section>

          {/* Activity trend */}
          <Section title="Activity trend" icon={<BarChart3 className="h-4 w-4 text-primary" />}>
            <Card className="p-4">
              <div className="h-[340px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={rows} barCategoryGap="22%" barGap={2} margin={{ top: 8, right: 4, left: -8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} className="text-muted-foreground" interval="preserveStartEnd" />
                    <YAxis yAxisId="left" tick={{ fontSize: 11 }} className="text-muted-foreground" allowDecimals={false} width={44} tickFormatter={fmtAxis} />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      tick={{ fontSize: 11, fill: COLORS.dials }}
                      stroke={COLORS.dials}
                      allowDecimals={false}
                      width={48}
                      tickFormatter={fmtAxis}
                      label={{ value: "Dials", angle: 90, position: "insideRight", offset: 8, style: { fontSize: 11, fill: COLORS.dials } }}
                    />
                    <Tooltip content={<NamedTooltip />} cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }} />
                    <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="square" />
                    {BAR_METRICS.map((m) => (
                      <Bar key={m.key} yAxisId="left" dataKey={m.key} name={m.label} fill={m.color} radius={[2, 2, 0, 0]} maxBarSize={22} />
                    ))}
                    <Line
                      yAxisId="right"
                      type="linear"
                      dataKey="dials"
                      name="Dials (right axis)"
                      stroke={COLORS.dials}
                      strokeWidth={2.5}
                      dot={{ r: 3, fill: COLORS.dials }}
                      activeDot={{ r: 5 }}
                      legendType="line"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </Section>

          {/* Speed to lead trend */}
          <Section title="Speed to lead" icon={<Timer className="h-4 w-4 text-primary" />}>
            <Card className="p-4">
              <div className="h-[260px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={rows} barCategoryGap="35%" margin={{ top: 8, right: 4, left: -8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} className="text-muted-foreground" interval="preserveStartEnd" />
                    <YAxis
                      yAxisId="left"
                      tick={{ fontSize: 11, fill: COLORS.speed }}
                      stroke={COLORS.speed}
                      width={44}
                      tickFormatter={(v: number) => `${v}m`}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      domain={[0, 100]}
                      tick={{ fontSize: 11, fill: COLORS.within5 }}
                      stroke={COLORS.within5}
                      width={48}
                      tickFormatter={(v: number) => `${v}%`}
                      label={{ value: "≤ 5 min", angle: 90, position: "insideRight", offset: 8, style: { fontSize: 11, fill: COLORS.within5 } }}
                    />
                    <Tooltip
                      content={
                        <NamedTooltip fmt={(k: string, v: number | null) => (k === "within5Pct" ? fmtPct(v) : fmtMins(v))} />
                      }
                      cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="square" />
                    <ReferenceLine
                      yAxisId="left"
                      y={SPEED_TARGET_MINS}
                      stroke={COLORS.speed}
                      strokeDasharray="4 4"
                      strokeOpacity={0.6}
                      label={{ value: "5 min target", position: "insideBottomRight", fontSize: 10, fill: COLORS.speed }}
                    />
                    <Bar yAxisId="left" dataKey="speedToLeadMins" name="Median speed to lead" fill={COLORS.speed} fillOpacity={0.85} radius={[2, 2, 0, 0]} maxBarSize={26} />
                    <Line
                      yAxisId="right"
                      type="linear"
                      dataKey="within5Pct"
                      name="Called within 5 min (right axis)"
                      stroke={COLORS.within5}
                      strokeWidth={2.5}
                      dot={{ r: 3, fill: COLORS.within5 }}
                      activeDot={{ r: 5 }}
                      legendType="line"
                      connectNulls
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Lower bars are better. Leads that haven't had a call yet aren't included until their first dial.</p>
            </Card>
          </Section>

          {/* Weekly breakdown */}
          <Section title={`Weekly breakdown · ${whoLabel}`} icon={<Table2 className="h-4 w-4 text-primary" />}>
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="whitespace-nowrap">Week of</TableHead>
                      <TableHead className="text-right">Leads</TableHead>
                      <TableHead className="text-right">Dials</TableHead>
                      <TableHead className="text-right">3m+ calls</TableHead>
                      <TableHead className="text-right">Bookings</TableHead>
                      <TableHead className="text-right whitespace-nowrap">Speed to lead</TableHead>
                      <TableHead className="text-right whitespace-nowrap">Called ≤ 5 min</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...rows].reverse().map((r, i) => (
                      <TableRow key={r.start} data-testid={`teamperf-row-${i}`} className={i === 0 ? "bg-primary/5" : ""}>
                        <TableCell className="font-medium whitespace-nowrap">
                          {r.label}
                          {i === 0 && (
                            <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">current</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmtNumber(r.leads)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtNumber(r.dials)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtNumber(r.over3mCalls)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtNumber(r.bookings)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtMins(r.speedToLeadMins)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtPct(r.within5Pct)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="border-t-2 font-semibold">
                      <TableCell>Total</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNumber(totals.leads)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNumber(totals.dials)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNumber(totals.over3mCalls)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNumber(totals.bookings)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtMins(totals.speedToLeadMins)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtPct(totals.within5Pct)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </Card>
          </Section>

          {/* Consultant comparison over the window */}
          {who === "team" && (
            <Section title={`By consultant · last ${weeks} weeks`} icon={<Users className="h-4 w-4 text-primary" />}>
              <Card className="overflow-hidden">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Consultant</TableHead>
                        <TableHead className="text-right">Leads</TableHead>
                        <TableHead className="text-right">Dials</TableHead>
                        <TableHead className="text-right">3m+ calls</TableHead>
                        <TableHead className="text-right">Bookings</TableHead>
                        <TableHead className="text-right whitespace-nowrap">Speed to lead</TableHead>
                        <TableHead className="text-right whitespace-nowrap">Called ≤ 5 min</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.consultants.map((n) => {
                        const m = data.totals.byConsultant[n];
                        return (
                          <TableRow key={n} data-testid={`teamperf-consultant-${n}`} className="cursor-pointer hover:bg-muted/50" onClick={() => setWho(n)}>
                            <TableCell className="font-medium whitespace-nowrap">{n}</TableCell>
                            <TableCell className="text-right tabular-nums">{fmtNumber(m.leads)}</TableCell>
                            <TableCell className="text-right tabular-nums">{fmtNumber(m.dials)}</TableCell>
                            <TableCell className="text-right tabular-nums">{fmtNumber(m.over3mCalls)}</TableCell>
                            <TableCell className="text-right tabular-nums">{fmtNumber(m.bookings)}</TableCell>
                            <TableCell className="text-right tabular-nums">{fmtMins(m.speedToLeadMins)}</TableCell>
                            <TableCell className="text-right tabular-nums">{fmtPct(m.within5Pct)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </Card>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
