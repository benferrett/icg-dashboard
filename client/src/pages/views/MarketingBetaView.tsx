// Marketing BETA — lead-cohort CAC.
//
// Companion tab to the existing Marketing view. The existing tab reports
// CAC as (spend in period) ÷ (members closed in period), which mixes
// cohorts because most members convert weeks after their lead is generated.
//
// This tab picks a LEAD MONTH and follows every lead created in that month
// FORWARD for all time (via HubSpot contact→deal associations), reporting
// how many became a paid member and what each cohort actually cost.
//
// Spend basis (per Ben): Meta = invoiced Meta spend in the lead month,
// EMBR = $154 per EMBR lead. All Melbourne-local calendar month boundaries.

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet, MarketingBeta, MarketingBetaChannelStats } from "@/lib/api";
import { fmtCurrency, fmtNumber, fmtPct, fmtDateShort } from "@/lib/format";
import { Section } from "@/components/dashboard/Section";
import { Stat } from "@/components/dashboard/Stat";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import {
  FlaskConical,
  DollarSign,
  Users,
  AlertTriangle,
  TrendingUp,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ChartTooltip } from "./shared";

// Melbourne-local "now" for the default month + the month-list.
const MEL_OFFSET_MS = 10 * 60 * 60 * 1000;
function melNow() {
  return new Date(Date.now() + MEL_OFFSET_MS);
}

// Build the last 18 months as {value, label} options, newest first. Aug 2026
// is our practical cohort ceiling because the current month is still open,
// but we still allow picking the current month so Ben can see it in-flight.
function buildMonthOptions(count = 18): { value: string; label: string }[] {
  const now = melNow();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const out: { value: string; label: string }[] = [];
  for (let i = 0; i < count; i++) {
    const dy = new Date(Date.UTC(y, m - i, 1));
    const yy = dy.getUTCFullYear();
    const mm = dy.getUTCMonth();
    out.push({
      value: `${yy}-${String(mm + 1).padStart(2, "0")}`,
      label: `${MONTHS[mm]} ${yy}`,
    });
  }
  return out;
}

// A cohort is "young" (still maturing) when the month-end is within the last
// ~60 days. Below that, most conversions haven't happened yet; the UI shows
// a soft warning instead of treating the CAC number as final.
function isCohortImmature(endIso: string): number {
  const endMs = Date.parse(endIso);
  if (isNaN(endMs)) return 0;
  const daysSince = Math.max(0, Math.round((Date.now() - endMs) / 86400000));
  if (daysSince >= 90) return 0;
  return 90 - daysSince;
}

function ChannelStatRow({
  stats,
  color,
}: {
  stats: MarketingBetaChannelStats;
  color: "meta" | "embr" | "total";
}) {
  const ring =
    color === "meta"
      ? "border-blue-500/40"
      : color === "embr"
        ? "border-emerald-500/40"
        : "border-primary/50";
  const label =
    stats.channel === "META"
      ? "Meta"
      : stats.channel === "EMBR"
        ? "EMBR"
        : "Combined";
  return (
    <Card className={cn("p-4 flex flex-col gap-3 border", ring)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">{label}</span>
        <span className="text-xs text-muted-foreground">
          Cohort · lifetime follow-forward
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat
          label="Leads"
          value={fmtNumber(stats.leads)}
          testId={`beta-${label}-leads`}
        />
        <Stat
          label="Spend"
          value={fmtCurrency(stats.spend)}
          sub={`CPL ${fmtCurrency(stats.cpl)}`}
          testId={`beta-${label}-spend`}
        />
        <Stat
          label="DS Booked"
          value={fmtNumber(stats.booked)}
          sub={`${fmtPct(stats.bookRate * 100)} of leads`}
          testId={`beta-${label}-booked`}
        />
        <Stat
          label="DS Sat"
          value={fmtNumber(stats.sat)}
          sub={`${fmtPct(stats.sitRate * 100)} of booked`}
          testId={`beta-${label}-sat`}
        />
        <Stat
          label="Members"
          value={fmtNumber(stats.members)}
          sub={`${fmtPct(stats.conversionRate * 100)} of sat`}
          testId={`beta-${label}-members`}
        />
        <Stat
          label="Cost / Booking"
          value={
            stats.costPerBooking > 0 ? fmtCurrency(stats.costPerBooking) : "—"
          }
          testId={`beta-${label}-cpb`}
        />
        <Stat
          label="Cost / Sat"
          value={stats.costPerSat > 0 ? fmtCurrency(stats.costPerSat) : "—"}
          testId={`beta-${label}-cps`}
        />
        <Stat
          label="CAC (cohort)"
          value={stats.cac > 0 ? fmtCurrency(stats.cac) : "—"}
          sub={
            stats.members > 0
              ? `${fmtNumber(stats.members)} members · ${fmtCurrency(stats.spend)} spend`
              : "no members yet"
          }
          accent
          testId={`beta-${label}-cac`}
        />
      </div>
    </Card>
  );
}

export function MarketingBetaView({ token }: { token: string }) {
  const monthOptions = useMemo(() => buildMonthOptions(18), []);
  // Default to LAST month — the current month is still open and biases
  // conversion rates downward.
  const defaultMonth = monthOptions[1]?.value ?? monthOptions[0]?.value;
  const [month, setMonth] = useState<string>(defaultMonth);

  const q = useQuery<MarketingBeta>({
    queryKey: ["/api/marketing-beta", month],
    queryFn: () =>
      apiGet<MarketingBeta>(`/api/marketing-beta?month=${month}`, token),
    refetchInterval: (r) =>
      (r.state.data as any)?.updating ? 4000 : false,
  });

  const d = q.data;
  const loading = q.isLoading;

  const immatureDays = d?.ok ? isCohortImmature(d.cohort.end) : 0;

  const maturityData =
    d?.ok
      ? d.maturity.map((b) => ({ label: b.label, members: b.members }))
      : [];

  return (
    <div className="flex flex-col gap-6">
      {/* Header + explainer */}
      <Section
        title="Marketing BETA — Lead-Cohort CAC"
        icon={<FlaskConical className="h-4 w-4 text-primary" />}
        action={
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground uppercase tracking-wide">
              Lead month
            </span>
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger
                className="w-[180px]"
                data-testid="beta-month-select"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {monthOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      >
        <Card className="p-4 border-primary/30 flex items-start gap-3 bg-primary/5">
          <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <div className="text-sm text-muted-foreground">
            Pick a lead month. This view finds every lead created in that
            month and follows each one forward for all time, then reports
            how many became a paying member and what the cohort truly cost.
            Meta spend is the invoiced month total; EMBR spend is
            $154 × EMBR leads in the cohort.{" "}
            <span className="text-foreground font-medium">
              This is different from the existing Marketing tab,
            </span>{" "}
            which mixes spend on this month's leads with members who came
            from earlier months.
          </div>
        </Card>
        {immatureDays > 0 && (
          <Card className="mt-3 p-3 border-amber-500/40 flex items-center gap-3">
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
            <div className="text-sm">
              <span className="font-medium">Cohort still maturing.</span>{" "}
              The end of {d?.ok ? d.cohort.label : "this month"} was less
              than 90 days ago (roughly {immatureDays} more days of runway
              expected). CAC and member counts for this month will keep
              improving as leads convert.
            </div>
          </Card>
        )}
        {d && "ok" in d && d.ok && d.metaSpendStatus === "error" && (
          <Card className="mt-3 p-3 border-amber-500/40 flex items-center gap-3">
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
            <div className="text-sm">
              <span className="font-medium">Meta spend unavailable.</span>{" "}
              {d.metaSpendMessage ?? "Meta returned no spend for the month."}
              {" "}Meta CAC in this cohort is therefore based on leads only,
              not invoiced spend.
            </div>
          </Card>
        )}
        {d && "ok" in d && !d.ok && (
          <Card className="mt-3 p-3 border-destructive/40 flex items-center gap-3">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
            <div className="text-sm">
              <span className="font-medium">Couldn't build cohort.</span>{" "}
              {d.error}
            </div>
          </Card>
        )}
      </Section>

      {/* Channel stats */}
      <Section
        title="Cohort economics by channel"
        icon={<DollarSign className="h-4 w-4 text-primary" />}
      >
        {loading || !d || !d.ok ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <ChannelStatRow stats={d.total} color="total" />
            <ChannelStatRow stats={d.meta} color="meta" />
            <ChannelStatRow stats={d.embr} color="embr" />
          </div>
        )}
      </Section>

      {/* Maturity curve */}
      <Section
        title="Cohort maturity — cumulative members by days since lead"
        icon={<TrendingUp className="h-4 w-4 text-primary" />}
      >
        {loading || !d || !d.ok ? (
          <Skeleton className="h-56 w-full" />
        ) : (
          <Card className="p-4">
            <div className="text-xs text-muted-foreground mb-3">
              Members from the {d.cohort.label} cohort that had converted
              within N days of their lead being created. All-time bar is the
              full cohort to date.
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={maturityData}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 12 }}
                    stroke="currentColor"
                    className="text-muted-foreground"
                  />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    stroke="currentColor"
                    className="text-muted-foreground"
                    allowDecimals={false}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar
                    dataKey="members"
                    fill="hsl(var(--primary))"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        )}
      </Section>

      {/* Lead journey drill-down */}
      <Section
        title="Every lead in this cohort"
        icon={<Users className="h-4 w-4 text-primary" />}
        action={
          <span className="text-xs text-muted-foreground">
            {d && d.ok ? `${d.leads.length} leads` : ""}
          </span>
        }
      >
        {loading || !d || !d.ok ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <Card className="overflow-hidden">
            <div className="max-h-[500px] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead>Contact</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Booked</TableHead>
                    <TableHead>Sat</TableHead>
                    <TableHead>Member</TableHead>
                    <TableHead>Member Date</TableHead>
                    <TableHead className="text-right">Days to Member</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.leads.slice(0, 500).map((r) => (
                    <TableRow key={r.contactId}>
                      <TableCell className="font-medium">
                        {r.name || "—"}
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            "inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium",
                            r.channel === "EMBR"
                              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                              : "bg-blue-500/10 text-blue-600 dark:text-blue-400",
                          )}
                        >
                          {r.channel}
                        </span>
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {fmtDateShort(r.createdAt)}
                      </TableCell>
                      <TableCell>{r.booked ? "✓" : "—"}</TableCell>
                      <TableCell>{r.sat ? "✓" : "—"}</TableCell>
                      <TableCell>{r.member ? "✓" : "—"}</TableCell>
                      <TableCell className="tabular-nums">
                        {r.memberDate ? fmtDateShort(r.memberDate) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.daysToMember != null
                          ? fmtNumber(r.daysToMember)
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {d.leads.length > 500 && (
              <div className="p-3 text-xs text-muted-foreground border-t">
                Showing first 500 of {fmtNumber(d.leads.length)} leads.
              </div>
            )}
          </Card>
        )}
      </Section>

      <div className="text-xs text-muted-foreground pt-2">
        Cohort logic: HubSpot contacts created in the Melbourne-local
        calendar month → all associated deals → best outcome across all
        deals (member &gt; sat &gt; booked). Members counted for any
        associated deal that ever entered a paid Bronze/Silver/Gold stage.
        Referral memberships are excluded (per existing dashboard rule).
      </div>
    </div>
  );
}
