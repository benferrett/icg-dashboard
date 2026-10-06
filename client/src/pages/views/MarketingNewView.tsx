// Marketing NEW — monthly lead cohorts, leads through to UC.
//
// One row per lead month (January 2026 → current month). Every lead created in
// the month is followed forward for all time, so spend is matched to the
// outcomes its own leads produced: CPL, lead → DS booked, show rate,
// DS → member, CAC, member → EOI, UC and UC CAC.
// Definitions live in server/icg/marketing-new.ts.

import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  apiGet,
  MarketingNew,
  MarketingNewMonth,
  MarketingNewStats,
} from "@/lib/api";
import { fmtCurrency, fmtNumber, fmtPct, fmtDate } from "@/lib/format";
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
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import {
  Sparkles,
  Info,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  TrendingUp,
  Table2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MarketingNewMonthDetail } from "./MarketingNewMonthDetail";

type ChannelKey = "total" | "meta" | "embr";
const CHANNELS: { key: ChannelKey; label: string }[] = [
  { key: "total", label: "Both" },
  { key: "meta", label: "Meta" },
  { key: "embr", label: "EMBR" },
];

const money = (n: number | null) => (n == null ? "—" : fmtCurrency(n));
const pct = (n: number | null) => (n == null ? "—" : fmtPct(n * 100, 1));

function shortMonth(label: string) {
  // "August 2026" -> "Aug 26"
  const [m, y] = label.split(" ");
  return `${m.slice(0, 3)} ${y?.slice(2) ?? ""}`;
}

function KpiStrip({ s, label }: { s: MarketingNewStats; label: string }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      <Stat label="Spend" value={fmtCurrency(s.spend)} sub={label} testId="new-spend" />
      <Stat label="Leads" value={fmtNumber(s.leads)} sub={`CPL ${money(s.cpl)}`} testId="new-leads" />
      <Stat
        label="Lead → DS booked"
        value={pct(s.leadToBooked)}
        sub={`${fmtNumber(s.booked)} booked`}
        testId="new-lead-ds"
      />
      <Stat
        label="DS show rate"
        value={pct(s.showRate)}
        sub={`${fmtNumber(s.sat)} sat of ${fmtNumber(s.scheduled)} held`}
        testId="new-show"
      />
      <Stat
        label="DS → Member"
        value={pct(s.dsToMember)}
        sub={`${fmtNumber(s.members)} members`}
        testId="new-ds-member"
      />
      <Stat label="CAC (member)" value={money(s.cac)} sub="spend ÷ members" accent testId="new-cac" />
      <Stat
        label="Member → EOI"
        value={pct(s.memberToEoi)}
        sub={`${fmtNumber(s.eoiClients)} clients · ${fmtNumber(s.eoiDeals)} EOIs`}
        testId="new-member-eoi"
      />
      <Stat label="UC" value={fmtNumber(s.uc)} sub="unconditional sales" testId="new-uc" />
      <Stat label="UC CAC" value={money(s.ucCac)} sub="spend ÷ UC" accent testId="new-uc-cac" />
      <Stat
        label="Cost / DS booked"
        value={s.booked > 0 ? fmtCurrency(s.spend / s.booked) : "—"}
        sub="spend ÷ DS booked"
        testId="new-cpb"
      />
    </div>
  );
}

function Outcomes({ m, channel }: { m: MarketingNewMonth; channel: ChannelKey }) {
  const rows = m.outcomes.filter(
    (o) => channel === "total" || o.channel === (channel === "meta" ? "META" : "EMBR"),
  );
  if (!rows.length)
    return (
      <div className="px-4 py-3 text-xs text-muted-foreground">
        No members, EOIs or UC sales from this cohort yet.
      </div>
    );
  const typeLabel = { member: "Member", eoi: "EOI", uc: "UC" } as const;
  return (
    <div className="px-4 py-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Milestone</TableHead>
            <TableHead>Client</TableHead>
            <TableHead>Channel</TableHead>
            <TableHead>Deal</TableHead>
            <TableHead>Date</TableHead>
            <TableHead className="text-right">Days from lead</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((o, i) => (
            <TableRow key={`${o.type}-${o.dealUrl}-${i}`}>
              <TableCell>
                <span
                  className={cn(
                    "inline-flex rounded px-1.5 py-0.5 text-xs font-medium",
                    o.type === "member" && "bg-primary/10 text-primary",
                    o.type === "eoi" && "bg-amber-500/10 text-amber-700 dark:text-amber-400",
                    o.type === "uc" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                  )}
                >
                  {typeLabel[o.type]}
                </span>
                {o.refunded && (
                  <span className="ml-1.5 text-xs text-destructive">
                    {o.type === "eoi" ? "cancelled" : "refunded"}
                  </span>
                )}
              </TableCell>
              <TableCell className="font-medium">
                <a href={o.contactUrl} target="_blank" rel="noreferrer" className="hover:underline">
                  {o.client}
                </a>
              </TableCell>
              <TableCell className="text-xs">{o.channel === "META" ? "Meta" : "EMBR"}</TableCell>
              <TableCell className="text-xs">
                <a href={o.dealUrl} target="_blank" rel="noreferrer" className="hover:underline">
                  {o.dealName}
                </a>
              </TableCell>
              <TableCell className="tabular-nums text-xs">{fmtDate(o.date)}</TableCell>
              <TableCell className="text-right tabular-nums text-xs">
                {o.daysFromLead != null ? fmtNumber(o.daysFromLead) : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

const COLS: { key: string; label: string; render: (s: MarketingNewStats) => string; accent?: boolean }[] = [
  { key: "spend", label: "Spend", render: (s) => fmtCurrency(s.spend) },
  { key: "leads", label: "Leads", render: (s) => fmtNumber(s.leads) },
  { key: "cpl", label: "CPL", render: (s) => money(s.cpl) },
  { key: "booked", label: "DS booked", render: (s) => fmtNumber(s.booked) },
  { key: "l2b", label: "Lead → DS", render: (s) => pct(s.leadToBooked) },
  { key: "sat", label: "DS sat", render: (s) => fmtNumber(s.sat) },
  { key: "show", label: "Show rate", render: (s) => pct(s.showRate) },
  { key: "members", label: "Members", render: (s) => fmtNumber(s.members) },
  { key: "d2m", label: "DS → Member", render: (s) => pct(s.dsToMember) },
  { key: "cac", label: "CAC", render: (s) => money(s.cac), accent: true },
  { key: "eoi", label: "EOI", render: (s) => fmtNumber(s.eoiDeals) },
  { key: "m2e", label: "Member → EOI", render: (s) => pct(s.memberToEoi) },
  { key: "uc", label: "UC", render: (s) => fmtNumber(s.uc) },
  { key: "uccac", label: "UC CAC", render: (s) => money(s.ucCac), accent: true },
];

export function MarketingNewView({ token }: { token: string }) {
  const [channel, setChannel] = useState<ChannelKey>("total");
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const q = useQuery<MarketingNew>({
    queryKey: ["/api/marketing-new"],
    queryFn: () => apiGet<MarketingNew>("/api/marketing-new", token),
    refetchInterval: (r) => ((r.state.data as any)?.updating ? 5000 : false),
  });
  const d = q.data;
  const channelLabel = CHANNELS.find((c) => c.key === channel)!.label;

  const chartData = useMemo(
    () =>
      d?.ok
        ? d.months
            .slice()
            .reverse()
            .map((m) => ({
              month: shortMonth(m.label),
              CPL: m[channel].cpl ?? null,
              CAC: m[channel].cac ?? null,
              "UC CAC": m[channel].ucCac ?? null,
            }))
        : [],
    [d, channel],
  );
  const spendErrors = d?.ok ? d.months.filter((m) => m.metaSpendStatus === "error") : [];

  return (
    <div className="flex flex-col gap-6">
      <Section
        title="Marketing NEW — Monthly Lead Cohorts"
        icon={<Sparkles className="h-4 w-4 text-primary" />}
        action={
          <div className="flex items-center gap-1 rounded-md border p-0.5" data-testid="new-channel-toggle">
            {CHANNELS.map((c) => (
              <Button
                key={c.key}
                size="sm"
                variant={channel === c.key ? "default" : "ghost"}
                className="h-7 px-3"
                onClick={() => setChannel(c.key)}
              >
                {c.label}
              </Button>
            ))}
          </div>
        }
      >
        <Card className="p-4 border-primary/30 flex items-start gap-3 bg-primary/5">
          <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <div className="text-sm text-muted-foreground">
            Each row is a lead month. Every Meta and EMBR lead created that month is
            followed forward for all time, so the month's spend is matched to the
            bookings, members, EOIs and UC sales those exact leads produced. Meta spend
            is the invoiced month total; EMBR spend is $154 per EMBR lead. Show rate is
            DS sat ÷ DS held. Members are gross (a later refund still counts as the
            original sale). Click a month to see the named clients behind it.
          </div>
        </Card>
        {spendErrors.length > 0 && (
          <Card className="p-3 border-amber-500/40 flex items-center gap-3">
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
            <div className="text-sm">
              <span className="font-medium">Meta spend unavailable</span> for{" "}
              {spendErrors.map((m) => m.label).join(", ")}. Those months' Meta CPL and CAC
              are understated until spend loads.
            </div>
          </Card>
        )}
      </Section>

      <Section
        title={`January 2026 to date — ${channelLabel}`}
        icon={<TrendingUp className="h-4 w-4 text-primary" />}
      >
        {q.isLoading || !d?.ok ? (
          q.isError ? (
            <Card className="p-3 border-destructive/40 text-sm">
              Couldn't build the cohort table: {(q.error as any)?.message}
            </Card>
          ) : (
            <Skeleton className="h-48 w-full" />
          )
        ) : (
          <KpiStrip s={d.totals[channel]} label="all cohorts" />
        )}
      </Section>

      <Section
        title="Cohorts by lead month"
        icon={<Table2 className="h-4 w-4 text-primary" />}
        action={
          d?.ok ? (
            <span className="text-xs text-muted-foreground">
              {d.updating ? "Updating… · " : ""}Built {fmtDate(d.computedAt || d.generatedAt)}
            </span>
          ) : null
        }
      >
        {q.isLoading || !d?.ok ? (
          <Skeleton className="h-96 w-full" />
        ) : (
          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 bg-background">Lead month</TableHead>
                  {COLS.map((c) => (
                    <TableHead key={c.key} className="text-right whitespace-nowrap">
                      {c.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.months.map((m) => {
                  const s = m[channel];
                  const isOpen = !!open[m.month];
                  return (
                    <Fragment key={m.month}>
                      <TableRow
                        className="cursor-pointer"
                        onClick={() => setOpen((o) => ({ ...o, [m.month]: !o[m.month] }))}
                        data-testid={`new-row-${m.month}`}
                      >
                        <TableCell className="sticky left-0 bg-background font-medium whitespace-nowrap">
                          <span className="inline-flex items-center gap-1">
                            {isOpen ? (
                              <ChevronDown className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5" />
                            )}
                            {m.label}
                          </span>
                          {m.maturingDaysLeft > 0 && (
                            <span
                              className="ml-2 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase text-amber-700 dark:text-amber-400"
                              title={`Less than 90 days since month end — about ${m.maturingDaysLeft} more days before this cohort is mature`}
                            >
                              Maturing
                            </span>
                          )}
                        </TableCell>
                        {COLS.map((c) => (
                          <TableCell
                            key={c.key}
                            className={cn(
                              "text-right tabular-nums whitespace-nowrap",
                              c.accent && "font-semibold text-primary",
                            )}
                          >
                            {c.render(s)}
                          </TableCell>
                        ))}
                      </TableRow>
                      {isOpen && (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={COLS.length + 1} className="p-0 bg-muted/30">
                            <Outcomes m={m} channel={channel} />
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
                <TableRow className="border-t-2 font-semibold">
                  <TableCell className="sticky left-0 bg-background">Total</TableCell>
                  {COLS.map((c) => (
                    <TableCell
                      key={c.key}
                      className={cn(
                        "text-right tabular-nums whitespace-nowrap",
                        c.accent && "text-primary",
                      )}
                    >
                      {c.render(d.totals[channel])}
                    </TableCell>
                  ))}
                </TableRow>
              </TableBody>
            </Table>
          </Card>
        )}
      </Section>

      {d?.ok && (
        <MarketingNewMonthDetail data={d} channel={channel} channelLabel={channelLabel} />
      )}

      <Section
        title={`CPL, CAC and UC CAC by lead month — ${channelLabel}`}
        icon={<TrendingUp className="h-4 w-4 text-primary" />}
      >
        {q.isLoading || !d?.ok ? (
          <Skeleton className="h-72 w-full" />
        ) : (
          <Card className="p-4">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis
                    yAxisId="cac"
                    tick={{ fontSize: 12 }}
                    tickFormatter={(v) => fmtCurrency(v, true)}
                  />
                  <YAxis
                    yAxisId="cpl"
                    orientation="right"
                    tick={{ fontSize: 12 }}
                    tickFormatter={(v) => fmtCurrency(v, true)}
                  />
                  <Tooltip formatter={(v: any) => (v == null ? "—" : fmtCurrency(Number(v)))} />
                  <Legend />
                  <Bar yAxisId="cac" dataKey="CAC" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="cac" dataKey="UC CAC" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} />
                  <Line
                    yAxisId="cpl"
                    type="monotone"
                    dataKey="CPL"
                    stroke="hsl(var(--chart-3))"
                    strokeWidth={2}
                    dot
                    connectNulls
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="text-xs text-muted-foreground mt-2">
              CAC and UC CAC on the left axis; CPL on the right. Recent months are still
              maturing, so their CAC and UC CAC will fall as leads keep converting.
            </div>
          </Card>
        )}
      </Section>

      <div className="text-xs text-muted-foreground pt-2">
        Cohort logic: leads are HubSpot contacts created in the Melbourne calendar month
        with an EMBR or Meta (Paid Social) source. DS booked = any Discovery Session
        meeting or DS stage on the lead's deals; show rate uses held sessions only; sat
        uses evidence-first attendance. EOI counts every property deal that reached the
        EOI milestone (including later cancellations); Member → EOI = clients with an
        EOI ÷ members. UC counts deals that reached Unconditional or settlement. Each
        deal is credited once, to the earliest cohort lead it is linked to. Test records
        and referral memberships are excluded.
      </div>
    </div>
  );
}
