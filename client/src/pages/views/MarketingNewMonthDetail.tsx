// Marketing NEW — single lead-month detail.
//
// Pick a lead month to list every EOI and every UC its leads produced, and to
// see what the cohort's UC CAC is now and what it will be as open EOIs go UC:
//   * UC CAC now                = spend ÷ UC deals so far
//   * If every open EOI goes UC = spend ÷ (UC + open EOIs)
//   * Expected (historic rate)  = spend ÷ (UC + open EOIs × EOI→UC rate), where
//     the rate is UC ÷ (UC + cancelled) over every resolved cohort EOI to date.

import { useMemo, useState } from "react";
import type {
  MarketingNew,
  MarketingNewMonth,
  MarketingNewPropertyDeal,
} from "@/lib/api";
import { fmtCurrency, fmtNumber, fmtPct, fmtDate } from "@/lib/format";
import { Section } from "@/components/dashboard/Section";
import { Stat } from "@/components/dashboard/Stat";
import { Card } from "@/components/ui/card";
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
import { CalendarSearch, FileSignature, BadgeCheck } from "lucide-react";
import { cn } from "@/lib/utils";

type ChannelKey = "total" | "meta" | "embr";
const money = (n: number | null | undefined) => (n == null || !isFinite(n) ? "—" : fmtCurrency(n));
const div = (a: number, b: number) => (b > 0 ? a / b : null);

function inChannel(d: MarketingNewPropertyDeal, channel: ChannelKey) {
  return channel === "total" || d.channel === (channel === "meta" ? "META" : "EMBR");
}

function StatusBadge({ s }: { s: MarketingNewPropertyDeal["status"] }) {
  const label = s === "uc" ? "UC" : s === "open" ? "Open EOI" : "Cancelled";
  return (
    <span
      className={cn(
        "inline-flex rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap",
        s === "uc" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        s === "open" && "bg-amber-500/10 text-amber-700 dark:text-amber-400",
        s === "cancelled" && "bg-destructive/10 text-destructive",
      )}
    >
      {label}
    </span>
  );
}

function DealTable({
  rows,
  mode,
}: {
  rows: MarketingNewPropertyDeal[];
  mode: "eoi" | "uc";
}) {
  if (!rows.length)
    return (
      <Card className="p-4 text-sm text-muted-foreground">
        {mode === "eoi" ? "No EOIs from this lead month yet." : "No UC sales from this lead month yet."}
      </Card>
    );
  const total = rows.reduce((s, r) => s + (r.amount || 0), 0);
  return (
    <Card className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Client</TableHead>
            <TableHead>Property deal</TableHead>
            <TableHead>Channel</TableHead>
            <TableHead>Strategist</TableHead>
            {mode === "eoi" && <TableHead>Status</TableHead>}
            <TableHead>Current stage</TableHead>
            <TableHead className="whitespace-nowrap">EOI date</TableHead>
            {mode === "eoi" && <TableHead className="text-right whitespace-nowrap">Lead → EOI</TableHead>}
            <TableHead className="whitespace-nowrap">UC date</TableHead>
            <TableHead className="text-right whitespace-nowrap">EOI → UC</TableHead>
            <TableHead className="text-right">Value</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.dealId}>
              <TableCell className="font-medium whitespace-nowrap">
                <a href={r.contactUrl} target="_blank" rel="noreferrer" className="hover:underline">
                  {r.client}
                </a>
              </TableCell>
              <TableCell className="text-xs max-w-[320px]">
                <a href={r.dealUrl} target="_blank" rel="noreferrer" className="hover:underline">
                  {r.dealName}
                </a>
              </TableCell>
              <TableCell className="text-xs">{r.channel === "META" ? "Meta" : "EMBR"}</TableCell>
              <TableCell className="text-xs whitespace-nowrap">{r.strategist || "—"}</TableCell>
              {mode === "eoi" && (
                <TableCell>
                  <StatusBadge s={r.status} />
                </TableCell>
              )}
              <TableCell className="text-xs">{r.stage}</TableCell>
              <TableCell className="tabular-nums text-xs whitespace-nowrap">{fmtDate(r.eoiDate)}</TableCell>
              {mode === "eoi" && (
                <TableCell className="text-right tabular-nums text-xs">
                  {r.daysLeadToEoi != null ? `${fmtNumber(r.daysLeadToEoi)}d` : "—"}
                </TableCell>
              )}
              <TableCell className="tabular-nums text-xs whitespace-nowrap">{fmtDate(r.ucDate)}</TableCell>
              <TableCell className="text-right tabular-nums text-xs">
                {r.daysEoiToUc != null ? `${fmtNumber(r.daysEoiToUc)}d` : "—"}
              </TableCell>
              <TableCell className="text-right tabular-nums text-xs">{money(r.amount)}</TableCell>
            </TableRow>
          ))}
          <TableRow className="border-t-2 font-semibold">
            <TableCell colSpan={mode === "eoi" ? 10 : 8}>
              {fmtNumber(rows.length)} {mode === "eoi" ? "EOIs" : "UC sales"}
            </TableCell>
            <TableCell className="text-right tabular-nums">{total > 0 ? fmtCurrency(total) : "—"}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Card>
  );
}

export function MarketingNewMonthDetail({
  data,
  channel,
  channelLabel,
}: {
  data: MarketingNew;
  channel: ChannelKey;
  channelLabel: string;
}) {
  // Default to the most recent full month (the current month is still open).
  const [month, setMonth] = useState<string>(
    data.months[1]?.month ?? data.months[0]?.month ?? "",
  );
  const m: MarketingNewMonth | undefined = data.months.find((x) => x.month === month);

  // Historic EOI → UC rate over every RESOLVED cohort EOI (UC or cancelled),
  // for the selected channel. Open EOIs are excluded until they resolve.
  const historic = useMemo(() => {
    let uc = 0, cancelled = 0;
    for (const mm of data.months)
      for (const d of mm.propertyDeals || []) {
        if (!d.eoiDate || !inChannel(d, channel)) continue;
        if (d.status === "uc") uc++;
        else if (d.status === "cancelled") cancelled++;
      }
    return { uc, cancelled, rate: div(uc, uc + cancelled) };
  }, [data, channel]);

  if (!m) return null;
  const s = m[channel];
  const deals = (m.propertyDeals || []).filter((d) => inChannel(d, channel));
  const eois = deals.filter((d) => d.eoiDate);
  const ucs = deals.filter((d) => d.status === "uc");
  const open = eois.filter((d) => d.status === "open").length;
  const cancelled = eois.filter((d) => d.status === "cancelled").length;
  const ucNow = ucs.length;
  const allOpenUc = ucNow + open;
  const expectedUc = historic.rate != null ? ucNow + open * historic.rate : null;

  return (
    <Section
      title={`Lead month detail — ${channelLabel}`}
      icon={<CalendarSearch className="h-4 w-4 text-primary" />}
      action={
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground uppercase tracking-wide">Lead month</span>
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="w-[180px]" data-testid="new-month-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {data.months.map((o) => (
                <SelectItem key={o.month} value={o.month}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      }
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Spend" value={fmtCurrency(s.spend)} sub={`${fmtNumber(s.leads)} leads`} />
        <Stat
          label="Members · CAC"
          value={money(s.cac)}
          sub={`${fmtNumber(s.members)} members`}
        />
        <Stat
          label="EOIs"
          value={fmtNumber(eois.length)}
          sub={`${fmtNumber(open)} open · ${fmtNumber(eois.length - open - cancelled)} UC · ${fmtNumber(cancelled)} cancelled`}
        />
        <Stat label="EOI CAC" value={money(div(s.spend, eois.length))} sub="spend ÷ EOIs" />
        <Stat
          label="UC CAC now"
          value={money(div(s.spend, ucNow))}
          sub={`${fmtNumber(ucNow)} UC so far`}
          accent
        />
        <Stat
          label="If every open EOI goes UC"
          value={money(div(s.spend, allOpenUc))}
          sub={`${fmtNumber(allOpenUc)} UC (${fmtNumber(ucNow)} + ${fmtNumber(open)} open)`}
          accent
        />
        <Stat
          label="Expected UC CAC"
          value={money(expectedUc != null ? div(s.spend, expectedUc) : null)}
          sub={
            historic.rate != null
              ? `${expectedUc!.toFixed(1)} UC at ${fmtPct(historic.rate * 100)} historic EOI → UC`
              : "no resolved EOIs yet"
          }
          accent
        />
        <Stat
          label="Historic EOI → UC"
          value={historic.rate != null ? fmtPct(historic.rate * 100) : "—"}
          sub={`${fmtNumber(historic.uc)} UC ÷ ${fmtNumber(historic.uc + historic.cancelled)} resolved EOIs`}
        />
      </div>
      <div className="text-xs text-muted-foreground">
        EOI → UC rate uses every cohort EOI since January 2026 that has resolved (gone UC or
        been cancelled) for the selected channel. Open EOIs are left out until they resolve.
        {m.maturingDaysLeft > 0 && " This month is still maturing, so more EOIs may still come in."}
      </div>

      <h3 className="flex items-center gap-2 text-sm font-semibold mt-2">
        <FileSignature className="h-4 w-4 text-primary" />
        All EOIs from {m.label} leads
      </h3>
      <DealTable rows={eois} mode="eoi" />

      <h3 className="flex items-center gap-2 text-sm font-semibold mt-2">
        <BadgeCheck className="h-4 w-4 text-primary" />
        All UC sales from {m.label} leads
      </h3>
      <DealTable rows={ucs} mode="uc" />
    </Section>
  );
}
