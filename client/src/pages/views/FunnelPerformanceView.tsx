import { Dashboard } from "@/lib/api";
import { fmtNumber, fmtPct } from "@/lib/format";
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
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
  Tooltip,
  Cell,
} from "recharts";
import { GitCompareArrows } from "lucide-react";

// Funnel Performance = a full lead -> UC comparison of the two lead sources
// (EMBR vs Meta), so Ben can see which channel converts better at every stage.
//
// Step-to-step percentages (each stage measured against the previous one):
//   Leads (count) -> % Booked (booked/leads) -> % Sat (sat/booked)
//   -> Membership sign-up % (sold/sat) -> EOI (count) -> UC (count)
//   -> UC of EOI (uc/eoi, how many EOIs converted through to unconditional)
//
// Sources:
//   leads, booked   = d.marketing.leadBooking[channel]  (lead cohort tracked forward)
//   sat,  sold      = d.salesFunnel.window.dsBySource[SRC]
//   eoi,  uc        = d.contracts.eoiBySource / ucBySource  (client lead source)

type SrcKey = "EMBR" | "META";

interface FunnelRow {
  key: SrcKey;
  label: string;
  color: string;
  leads: number;
  booked: number;
  sat: number;
  sold: number;
  refunded: number;
  eoi: number;
  uc: number;
  pctBooked: number | null;
  pctSat: number | null;
  pctMembership: number | null;
  pctUcOfEoi: number | null;
}

const pct = (num: number, den: number): number | null =>
  den > 0 ? Math.round((num / den) * 100) : null;

const EMBR_COLOR = "hsl(262 83% 58%)"; // purple — matches EMBR elsewhere
const META_COLOR = "hsl(217 91% 60%)"; // blue — matches Meta elsewhere

export function FunnelPerformanceView({
  d,
  loading,
  periodLabel,
}: {
  d?: Dashboard;
  loading: boolean;
  periodLabel: string;
}) {
  const period = periodLabel.toLowerCase();

  const build = (key: SrcKey): FunnelRow => {
    const lb =
      key === "EMBR" ? d?.marketing.leadBooking.embr : d?.marketing.leadBooking.meta;
    const bs = d?.salesFunnel?.window?.dsBySource?.[key];
    const leads = lb?.leads ?? 0;
    // Prefer the cohort booked count from leadBooking (of leads created this
    // period, how many booked). Fall back to the DS funnel booked if missing.
    const booked = lb?.booked ?? bs?.booked ?? 0;
    const sat = bs?.sat ?? 0;
    const sold = bs?.sold ?? 0;
    const refunded = bs?.refunded ?? 0;
    const eoi = d?.contracts.eoiBySource?.[key] ?? 0;
    const uc = d?.contracts.ucBySource?.[key] ?? 0;
    return {
      key,
      label: key === "EMBR" ? "EMBR" : "Meta",
      color: key === "EMBR" ? EMBR_COLOR : META_COLOR,
      leads,
      booked,
      sat,
      sold,
      refunded,
      eoi,
      uc,
      pctBooked: pct(booked, leads),
      pctSat: pct(sat, booked),
      pctMembership: pct(sold, sat),
      pctUcOfEoi: pct(uc, eoi),
    };
  };

  const embr = build("EMBR");
  const meta = build("META");
  const rows = [embr, meta];

  // "Both" column = simple totals / blended rates.
  const both = {
    leads: embr.leads + meta.leads,
    booked: embr.booked + meta.booked,
    sat: embr.sat + meta.sat,
    sold: embr.sold + meta.sold,
    refunded: embr.refunded + meta.refunded,
    eoi: embr.eoi + meta.eoi,
    uc: embr.uc + meta.uc,
  };
  // Authoritative GROSS totals (include untagged / direct / referral clients),
  // sourced from the contract funnel + eoiRefunds rather than the EMBR/META
  // source split (which only covers tagged clients). EOI is reported GROSS: it
  // includes deals later cancelled/refunded. Refunds are a SEPARATE line.
  const eoiFunnel =
    d?.contracts?.funnel?.find((f: any) => f.key === "eoi")?.count ?? both.eoi;
  const ucFunnel =
    d?.contracts?.funnel?.find((f: any) => f.key === "uc")?.count ?? both.uc;
  const eoiGross = eoiFunnel;
  const eoiRefunds = d?.contracts?.eoiRefunds ?? 0;
  const eoiRefundsBySrc = d?.contracts?.eoiRefundsBySource ?? { EMBR: 0, META: 0 };

  const bothRates = {
    pctBooked: pct(both.booked, both.leads),
    pctSat: pct(both.sat, both.booked),
    pctMembership: pct(both.sold, both.sat),
    pctUcOfEoi: pct(both.uc, both.eoi),
  };

  // Winner helper: which source has the higher value (null-safe). Returns the
  // winning SrcKey or null on a tie / no data.
  const winner = (a: number | null, b: number | null): SrcKey | null => {
    if (a == null && b == null) return null;
    if ((a ?? -1) === (b ?? -1)) return null;
    return (a ?? -1) > (b ?? -1) ? "EMBR" : "META";
  };
  const memberWinner = winner(embr.pctMembership, meta.pctMembership);
  const memberWinnerRow = memberWinner === "EMBR" ? embr : memberWinner === "META" ? meta : null;

  // Chart data: one group per conversion step, EMBR vs Meta bars.
  const chartData = [
    { step: "% Booked", EMBR: embr.pctBooked ?? 0, Meta: meta.pctBooked ?? 0 },
    { step: "% Sat", EMBR: embr.pctSat ?? 0, Meta: meta.pctSat ?? 0 },
    {
      step: "Membership %",
      EMBR: embr.pctMembership ?? 0,
      Meta: meta.pctMembership ?? 0,
    },
    {
      step: "UC of EOI %",
      EMBR: embr.pctUcOfEoi ?? 0,
      Meta: meta.pctUcOfEoi ?? 0,
    },
  ];

  // Cumulative retention: what % of each source's ORIGINAL leads survive to each
  // stage. Shows the full drop-off curve per channel (100% at Leads, decreasing).
  // `pctOfLeads` is null-safe when a source has zero leads.
  const pctOfLeads = (n: number, leads: number): number | null =>
    leads > 0 ? Math.round((n / leads) * 1000) / 10 : null;
  const retentionData = [
    { stage: "Leads", EMBR: embr.leads > 0 ? 100 : 0, Meta: meta.leads > 0 ? 100 : 0 },
    {
      stage: "Booked",
      EMBR: pctOfLeads(embr.booked, embr.leads) ?? 0,
      Meta: pctOfLeads(meta.booked, meta.leads) ?? 0,
    },
    {
      stage: "Sat",
      EMBR: pctOfLeads(embr.sat, embr.leads) ?? 0,
      Meta: pctOfLeads(meta.sat, meta.leads) ?? 0,
    },
    {
      stage: "Member",
      EMBR: pctOfLeads(embr.sold, embr.leads) ?? 0,
      Meta: pctOfLeads(meta.sold, meta.leads) ?? 0,
    },
    {
      stage: "EOI",
      EMBR: pctOfLeads(embr.eoi, embr.leads) ?? 0,
      Meta: pctOfLeads(meta.eoi, meta.leads) ?? 0,
    },
    {
      stage: "UC",
      EMBR: pctOfLeads(embr.uc, embr.leads) ?? 0,
      Meta: pctOfLeads(meta.uc, meta.leads) ?? 0,
    },
  ];

  const val = (v: number | null) =>
    v == null ? <span className="text-muted-foreground">—</span> : fmtPct(v);

  // Per-row winner badge cell (for the two source columns).
  const cell = (
    row: FunnelRow,
    field: "pctBooked" | "pctSat" | "pctMembership" | "pctUcOfEoi",
  ) => {
    const other = row.key === "EMBR" ? meta : embr;
    const isWin = winner(row[field], other[field]) === row.key;
    return (
      <TableCell className="text-right tabular-nums">
        {row[field] == null ? (
          <span className="text-muted-foreground">—</span>
        ) : isWin ? (
          <Badge className="tabular-nums">{fmtPct(row[field]!)}</Badge>
        ) : (
          fmtPct(row[field]!)
        )}
      </TableCell>
    );
  };

  return (
    <div className="flex flex-col gap-8">
      {/* Headline: which channel converts better */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {loading || !d ? (
          Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))
        ) : (
          <>
            <Stat
              label={`Best converter · ${period}`}
              value={
                memberWinnerRow
                  ? `${memberWinnerRow.label} ${fmtPct(memberWinnerRow.pctMembership!)}`
                  : "Tie"
              }
              sub="highest membership sign-up %"
              testId="funnel-winner"
              accent
            />
            <Stat
              label={`Members · ${period}`}
              value={`${fmtNumber(
                d?.salesFunnel?.window?.membershipsTotal ?? both.sold + both.refunded,
              )}`}
              sub={`${fmtNumber(
                d?.salesFunnel?.window?.membershipsSold ?? both.sold,
              )} sold + ${fmtNumber(
                d?.salesFunnel?.window?.membershipsRefunded ?? both.refunded,
              )} refunded`}
              testId="funnel-total-members"
            />
            <Stat
              label={`Refunded · ${period}`}
              value={`${fmtNumber(
                d?.salesFunnel?.window?.membershipsRefunded ?? both.refunded,
              )}`}
              sub={`net ${fmtNumber(
                (d?.salesFunnel?.window?.membershipsSold ?? both.sold) -
                  (d?.salesFunnel?.window?.membershipsRefunded ?? both.refunded),
              )} members`}
              testId="funnel-total-refunds"
            />
            <Stat
              label={`EOI · ${period}`}
              value={`${fmtNumber(eoiGross)}`}
              sub={`gross (incl. refunded) · Meta ${fmtNumber(
                meta.eoi,
              )} · EMBR ${fmtNumber(embr.eoi)}`}
              testId="funnel-total-eoi"
            />
            <Stat
              label={`EOI Refunds · ${period}`}
              value={`${fmtNumber(eoiRefunds)}`}
              sub={`net ${fmtNumber(
                eoiGross - eoiRefunds,
              )} EOIs · Meta ${fmtNumber(
                eoiRefundsBySrc.META ?? 0,
              )} · EMBR ${fmtNumber(eoiRefundsBySrc.EMBR ?? 0)}`}
              testId="funnel-total-eoi-refunds"
            />
            <Stat
              label={`UC · ${period}`}
              value={`${fmtNumber(ucFunnel)}`}
              sub={`Meta ${fmtNumber(meta.uc)} · EMBR ${fmtNumber(embr.uc)}`}
              testId="funnel-total-uc"
              accent
            />
          </>
        )}
      </div>

      {/* Full funnel comparison table */}
      <Section
        title={`Lead → UC funnel by source · ${period}`}
        icon={<GitCompareArrows className="h-4 w-4 text-primary" />}
      >
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Stage</TableHead>
                  <TableHead className="text-right">EMBR</TableHead>
                  <TableHead className="text-right">Meta</TableHead>
                  <TableHead className="text-right">Both</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading || !d ? (
                  Array.from({ length: 11 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={4}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <>
                    <TableRow>
                      <TableCell className="font-medium">Leads</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtNumber(embr.leads)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtNumber(meta.leads)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {fmtNumber(both.leads)}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium">
                        DS Booked
                        <span className="block text-xs text-muted-foreground">
                          sessions booked
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtNumber(embr.booked)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtNumber(meta.booked)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {fmtNumber(both.booked)}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium">
                        % Booked
                        <span className="block text-xs text-muted-foreground">
                          booked ÷ leads
                        </span>
                      </TableCell>
                      {cell(embr, "pctBooked")}
                      {cell(meta, "pctBooked")}
                      <TableCell className="text-right tabular-nums font-medium">
                        {val(bothRates.pctBooked)}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium">
                        Sat
                        <span className="block text-xs text-muted-foreground">
                          sessions attended
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtNumber(embr.sat)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtNumber(meta.sat)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {fmtNumber(both.sat)}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium">
                        % Sat
                        <span className="block text-xs text-muted-foreground">
                          sat ÷ booked
                        </span>
                      </TableCell>
                      {cell(embr, "pctSat")}
                      {cell(meta, "pctSat")}
                      <TableCell className="text-right tabular-nums font-medium">
                        {val(bothRates.pctSat)}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium">
                        Membership sign-up %
                        <span className="block text-xs text-muted-foreground">
                          sold ÷ sat
                        </span>
                      </TableCell>
                      {cell(embr, "pctMembership")}
                      {cell(meta, "pctMembership")}
                      <TableCell className="text-right tabular-nums font-medium">
                        {val(bothRates.pctMembership)}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium">
                        Members (total)
                        <span className="block text-xs text-muted-foreground">
                          memberships signed
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtNumber(embr.sold)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtNumber(meta.sold)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {fmtNumber(both.sold)}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium">
                        Refunded members
                        <span className="block text-xs text-muted-foreground">
                          cancelled / refunded
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {embr.refunded > 0 ? (
                          <span className="text-destructive">
                            {fmtNumber(embr.refunded)}
                          </span>
                        ) : (
                          fmtNumber(embr.refunded)
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {meta.refunded > 0 ? (
                          <span className="text-destructive">
                            {fmtNumber(meta.refunded)}
                          </span>
                        ) : (
                          fmtNumber(meta.refunded)
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {both.refunded > 0 ? (
                          <span className="text-destructive">
                            {fmtNumber(both.refunded)}
                          </span>
                        ) : (
                          fmtNumber(both.refunded)
                        )}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium">
                        EOIs
                        <span className="block text-xs text-muted-foreground">
                          expressions of interest
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtNumber(embr.eoi)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtNumber(meta.eoi)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {fmtNumber(both.eoi)}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium">
                        UC
                        <span className="block text-xs text-muted-foreground">
                          unconditional
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtNumber(embr.uc)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtNumber(meta.uc)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {fmtNumber(both.uc)}
                      </TableCell>
                    </TableRow>
                    <TableRow className="border-t-2">
                      <TableCell className="font-medium">
                        UC of EOI %
                        <span className="block text-xs text-muted-foreground">
                          uc ÷ eoi
                        </span>
                      </TableCell>
                      {cell(embr, "pctUcOfEoi")}
                      {cell(meta, "pctUcOfEoi")}
                      <TableCell className="text-right tabular-nums font-medium">
                        {val(bothRates.pctUcOfEoi)}
                      </TableCell>
                    </TableRow>
                  </>
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
        <p className="text-xs text-muted-foreground mt-3">
          Percentages are step-to-step (each stage measured against the one
          above it). Leads and booked come from the lead cohort created this
          period (tracked forward); sat and memberships from the DS funnel; EOI
          and UC are attributed to the client's original lead source. A
          highlighted percentage is the higher-converting channel at that stage.
        </p>
      </Section>

      {/* Conversion comparison chart */}
      <Section title={`Conversion by stage · ${period}`}>
        <Card className="p-4">
          {loading || !d ? (
            <Skeleton className="h-72 w-full" />
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  margin={{ top: 8, right: 12, left: 0, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                  <XAxis
                    dataKey="step"
                    tick={{ fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => `${v}%`}
                    width={40}
                  />
                  <Tooltip
                    formatter={(v: number) => `${v}%`}
                    contentStyle={{
                      borderRadius: 8,
                      border: "1px solid hsl(var(--border))",
                      background: "hsl(var(--popover))",
                      fontSize: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="EMBR" fill={EMBR_COLOR} radius={[4, 4, 0, 0]}>
                    {chartData.map((_, i) => (
                      <Cell key={i} fill={EMBR_COLOR} />
                    ))}
                  </Bar>
                  <Bar dataKey="Meta" fill={META_COLOR} radius={[4, 4, 0, 0]}>
                    {chartData.map((_, i) => (
                      <Cell key={i} fill={META_COLOR} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </Section>

      {/* Cumulative retention curve: % of each source's leads reaching each stage */}
      <Section title={`Lead retention by source · ${period}`}>
        <Card className="p-4">
          {loading || !d ? (
            <Skeleton className="h-72 w-full" />
          ) : (
            <div className="h-72" data-testid="chart-retention">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={retentionData}
                  margin={{ top: 8, right: 16, left: 0, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                  <XAxis
                    dataKey="stage"
                    tick={{ fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => `${v}%`}
                    width={44}
                  />
                  <Tooltip
                    formatter={(v: number) => `${v}% of leads`}
                    contentStyle={{
                      borderRadius: 8,
                      border: "1px solid hsl(var(--border))",
                      background: "hsl(var(--popover))",
                      fontSize: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line
                    type="monotone"
                    dataKey="EMBR"
                    stroke={EMBR_COLOR}
                    strokeWidth={2.5}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="Meta"
                    stroke={META_COLOR}
                    strokeWidth={2.5}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
        <p className="text-xs text-muted-foreground mt-3">
          Each line shows the share of that source's original leads still
          present at each stage — a cumulative view of how far EMBR vs Meta
          leads travel down the funnel. Both start at 100% (Leads) and decline
          through Booked, Sat, Member, EOI and UC.
        </p>
      </Section>
    </div>
  );
}
