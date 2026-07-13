import { Dashboard, MetaData, FunnelWindow } from "@/lib/api";
import { fmtCurrency, fmtNumber } from "@/lib/format";
import { Stat } from "@/components/dashboard/Stat";
import { Section } from "@/components/dashboard/Section";
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
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Filter } from "lucide-react";

export function OverviewView({
  d,
  meta,
  loading,
  periodLabel,
}: {
  d?: Dashboard;
  meta?: MetaData;
  loading: boolean;
  periodLabel: string;
}) {
  return (
    <div className="flex flex-col gap-8">
      {/* KPI ROW */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {loading || !d ? (
          Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))
        ) : (
          (() => {
            const metaOk = meta?.status === "ok" && !!meta.totals;
            const metaLeads = metaOk ? meta!.totals!.leads : 0;
            const embrLeads = d.embr?.period?.leads ?? 0;
            const totalLeads = metaLeads + embrLeads;
            const win = d.salesFunnel?.ok ? d.salesFunnel.window : undefined;
            return (
              <>
                <Stat
                  label={`Total leads · ${periodLabel.toLowerCase()}`}
                  value={fmtNumber(totalLeads)}
                  sub={`Meta ${metaOk ? fmtNumber(metaLeads) : "—"} · EMBR ${fmtNumber(embrLeads)}`}
                  testId="stat-total-leads"
                  accent
                />
                <Stat
                  label={`DS booked · ${periodLabel.toLowerCase()}`}
                  value={fmtNumber(win ? win.dsBooked : 0)}
                  testId="stat-ds-booked"
                />
                <Stat
                  label={`DS sat · ${periodLabel.toLowerCase()}`}
                  value={fmtNumber(win ? win.dsSat : 0)}
                  testId="stat-ds-sat"
                />
                <Stat
                  label={`Memberships sold · ${periodLabel.toLowerCase()}`}
                  value={fmtNumber(win ? win.membershipsSold : 0)}
                  sub={
                    win
                      ? Object.entries(win.membershipTiers)
                          .filter(([, n]) => n > 0)
                          .map(([t, n]) => `${n}${t[0]}`)
                          .join(" · ") || "none yet"
                      : "—"
                  }
                  testId="stat-memberships"
                />
                <Stat
                  label={`Membership conversion · ${periodLabel.toLowerCase()}`}
                  value={
                    win && win.dsSat > 0
                      ? `${Math.round((win.membershipsSold / win.dsSat) * 100)}%`
                      : "—"
                  }
                  sub={
                    win
                      ? `${fmtNumber(win.membershipsSold)} sold ÷ ${fmtNumber(win.dsSat)} sat`
                      : "—"
                  }
                  testId="stat-membership-conversion"
                  accent
                />
                <Stat
                  label={`EOI · ${periodLabel.toLowerCase()}`}
                  value={fmtNumber(
                    d.contracts.funnel.find((s) => s.key === "eoi")?.count ?? 0,
                  )}
                  sub={fmtCurrency(
                    d.contracts.funnel.find((s) => s.key === "eoi")?.value ?? 0,
                    true,
                  )}
                  testId="stat-eoi-sales"
                  accent
                />
                <Stat
                  label={`UC sales · ${periodLabel.toLowerCase()}`}
                  value={fmtNumber(
                    d.contracts.funnel.find((s) => s.key === "uc")?.count ?? 0,
                  )}
                  sub={fmtCurrency(
                    d.contracts.funnel.find((s) => s.key === "uc")?.value ?? 0,
                    true,
                  )}
                  testId="stat-uc-sales"
                  accent
                />
              </>
            );
          })()
        )}
      </div>

      {/* SALES FUNNEL SNAPSHOT */}
      <Section title="Sales funnel" icon={<Filter className="h-4 w-4 text-primary" />}>
        {loading || !d ? (
          <Skeleton className="h-64 w-full" />
        ) : d.salesFunnel?.ok === false ? (
          <Card className="p-4 border-amber-500/40 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
            <div className="text-sm">
              <div className="font-medium">Sales funnel unavailable</div>
              <div className="text-muted-foreground">
                {d.salesFunnel?.error || "Could not load funnel data."}
              </div>
            </div>
          </Card>
        ) : (
          (() => {
            const win: FunnelWindow | undefined = d.salesFunnel?.window;
            if (!win) return null;
            return (
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
                  <Stat
                    label="New leads"
                    value={fmtNumber(win.totals.leads)}
                    sub={win.label}
                    testId="funnel-leads"
                    accent
                  />
                  <Stat
                    label="Contact rate"
                    value={`${win.totals.contactRate}%`}
                    sub={`${fmtNumber(win.totals.contacted)} contacted`}
                    testId="funnel-contact-rate"
                  />
                  <Stat
                    label="Connected >30s"
                    value={`${win.totals.connectRate}%`}
                    sub={`${fmtNumber(win.totals.connected)} spoke`}
                    testId="funnel-connect-rate"
                  />
                  <Stat
                    label="DS booked"
                    value={fmtNumber(win.dsBooked)}
                    sub={`${fmtNumber(win.dsStarted)} started`}
                    testId="funnel-ds-booked"
                  />
                  <Stat
                    label="DS sat"
                    value={fmtNumber(win.dsSat)}
                    sub="held sessions"
                    testId="funnel-ds-sat"
                  />
                  <Stat
                    label="Memberships sold"
                    value={fmtNumber(win.membershipsSold)}
                    sub={
                      Object.entries(win.membershipTiers)
                        .filter(([, n]) => n > 0)
                        .map(([t, n]) => `${n}${t[0]}`)
                        .join(" · ") || "none yet"
                    }
                    testId="funnel-sold"
                  />
                  <Stat
                    label="Membership conversion"
                    value={
                      win.dsSat > 0
                        ? `${Math.round((win.membershipsSold / win.dsSat) * 100)}%`
                        : "—"
                    }
                    sub="sold ÷ DS sat"
                    testId="funnel-membership-conversion"
                  />
                </div>

                <Card className="overflow-hidden">
                  <div className="px-4 pt-4 pb-2 text-sm font-medium">
                    Lead contact by consultant · {win.label.toLowerCase()}
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Consultant</TableHead>
                        <TableHead className="text-right">Leads</TableHead>
                        <TableHead className="text-right">Contacted</TableHead>
                        <TableHead className="text-right">Contact %</TableHead>
                        <TableHead className="text-right">Spoke &gt;30s</TableHead>
                        <TableHead className="text-right">Connect %</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {win.consultants.map((c) => (
                        <TableRow key={c.name} data-testid={`row-funnel-${c.name}`}>
                          <TableCell className="font-medium">{c.name}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmtNumber(c.leads)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmtNumber(c.contacted)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge
                              variant={c.contactRate >= 80 ? "default" : "secondary"}
                              className="tabular-nums"
                            >
                              {c.contactRate}%
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmtNumber(c.connected)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge
                              variant={c.connectRate >= 50 ? "default" : "secondary"}
                              className="tabular-nums"
                            >
                              {c.connectRate}%
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Card>
              </div>
            );
          })()
        )}
      </Section>
    </div>
  );
}
