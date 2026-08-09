import { useQuery } from "@tanstack/react-query";
import { apiGet, Report2026, Report2026Row } from "@/lib/api";
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
import { TrendingUp, BarChart3, Table2, CalendarRange } from "lucide-react";
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

// The count metrics that get a chart line + coloured table column. Rates
// (sit rate, AM→EOI %) are shown as their own columns/cards, not chart lines.
const METRIC_META: { key: keyof Report2026Row; label: string; color: string }[] = [
  { key: "dsBooked", label: "DS Booked", color: "hsl(38 92% 50%)" },
  { key: "dsScheduled", label: "DS Scheduled", color: "hsl(48 96% 53%)" },
  { key: "dsSat", label: "DS Sat", color: "hsl(160 84% 39%)" },
  { key: "members", label: "Members", color: "hsl(280 65% 60%)" },
  { key: "eois", label: "EOIs", color: "hsl(0 72% 55%)" },
  { key: "uc", label: "UC", color: "hsl(190 90% 42%)" },
  { key: "amSat", label: "Acq. Meetings", color: "hsl(217 91% 60%)" },
];

const pct = (v: number | null) => (v == null ? "\u2014" : `${v}%`);

// 2026 Reporting: month-by-month (Jan–Dec 2026) on a calendar-month basis.
// Sit rate = DS Sat ÷ DS Scheduled (same "what we actually saw" basis as
// Overview). Also shows Acquisition Meetings sat and the % of those clients
// who bought at least one EOI. This view owns its own data (no period picker).
export function Report2026View({ token }: { token: string }) {
  const q = useQuery<Report2026>({
    queryKey: ["/api/report-2026", 2026],
    queryFn: () => apiGet<Report2026>(`/api/report-2026?year=2026`, token),
  });

  const data = q.data;
  const rows = data?.rows ?? [];
  const t = data?.totals;

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarRange className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold" data-testid="report2026-title">
            2026 Reporting
          </h2>
          <span className="text-xs text-muted-foreground">
            Month by month · Jan–Dec 2026
          </span>
        </div>
        <span className="text-xs text-muted-foreground">
          {data ? `updated ${timeAgo(data.generatedAt)}` : "loading\u2026"}
        </span>
      </div>

      {q.isLoading || !data ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <>
          {/* Full-year totals */}
          <Section
            title="2026 totals"
            icon={<TrendingUp className="h-4 w-4 text-primary" />}
          >
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-3">
              <Stat label="DS Booked" value={fmtNumber(t?.dsBooked ?? 0)} testId="r26-total-dsBooked" />
              <Stat label="DS Sat" value={fmtNumber(t?.dsSat ?? 0)} sub={`of ${fmtNumber(t?.dsScheduled ?? 0)} scheduled`} testId="r26-total-dsSat" />
              <Stat label="Sit rate" value={pct(t?.sitRate ?? null)} sub="sat / scheduled" testId="r26-total-sitRate" />
              <Stat label="Members" value={fmtNumber(t?.members ?? 0)} testId="r26-total-members" />
              <Stat label="EOIs" value={fmtNumber(t?.eois ?? 0)} testId="r26-total-eois" />
              <Stat label="UC" value={fmtNumber(t?.uc ?? 0)} testId="r26-total-uc" />
              <Stat label="Acq. Meetings sat" value={fmtNumber(t?.amSat ?? 0)} testId="r26-total-amSat" />
              <Stat label="Acq. → bought EOI" value={pct(t?.amEoiPct ?? null)} sub={`${fmtNumber(t?.amSatWithEoi ?? 0)} of ${fmtNumber(t?.amSat ?? 0)}`} testId="r26-total-amEoiPct" />
            </div>
          </Section>

          {/* Trend chart */}
          <Section title="Monthly trend" icon={<BarChart3 className="h-4 w-4 text-primary" />}>
            <Card className="p-4">
              <div className="h-[360px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={rows} margin={{ top: 8, right: 12, left: -8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11 }}
                      className="text-muted-foreground"
                      interval="preserveStartEnd"
                      tickFormatter={(v: string) => v.split(" ")[0].slice(0, 3)}
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      className="text-muted-foreground"
                      allowDecimals={false}
                      width={44}
                      tickFormatter={(v: number) =>
                        v >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : `${v}`
                      }
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="circle" />
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
          <Section title="Monthly breakdown" icon={<Table2 className="h-4 w-4 text-primary" />}>
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="whitespace-nowrap">Month</TableHead>
                      <TableHead className="text-right">DS Booked</TableHead>
                      <TableHead className="text-right">DS Scheduled</TableHead>
                      <TableHead className="text-right">DS Sat</TableHead>
                      <TableHead className="text-right">Sit rate</TableHead>
                      <TableHead className="text-right">Members</TableHead>
                      <TableHead className="text-right">EOIs</TableHead>
                      <TableHead className="text-right">UC</TableHead>
                      <TableHead className="text-right">Acq. Mtgs</TableHead>
                      <TableHead className="text-right">Acq. → EOI</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r, i) => (
                      <TableRow key={r.start} data-testid={`r26-row-${r.monthIdx}`}>
                        <TableCell className="font-medium whitespace-nowrap">{r.label}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtNumber(r.dsBooked)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtNumber(r.dsScheduled)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtNumber(r.dsSat)}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{pct(r.sitRate)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtNumber(r.members)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtNumber(r.eois)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtNumber(r.uc)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtNumber(r.amSat)}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">
                          {pct(r.amEoiPct)}
                          {r.amSat > 0 && (
                            <span className="ml-1 text-[10px] text-muted-foreground">
                              ({r.amSatWithEoi}/{r.amSat})
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {t && (
                      <TableRow className="border-t-2 font-semibold">
                        <TableCell className="whitespace-nowrap">Total</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtNumber(t.dsBooked)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtNumber(t.dsScheduled)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtNumber(t.dsSat)}</TableCell>
                        <TableCell className="text-right tabular-nums">{pct(t.sitRate)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtNumber(t.members)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtNumber(t.eois)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtNumber(t.uc)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtNumber(t.amSat)}</TableCell>
                        <TableCell className="text-right tabular-nums">{pct(t.amEoiPct)}</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </Card>
          </Section>

          <p className="text-xs text-muted-foreground">
            Sit rate = DS sat ÷ DS scheduled to be held that month (same basis as
            Overview). DS Booked counts sessions created that month; DS Sat and
            Acquisition Meetings count sessions held that month. Acq. → EOI is the
            share of clients who sat an acquisition meeting that month and reached
            at least one EOI.
          </p>
        </>
      )}
    </div>
  );
}
