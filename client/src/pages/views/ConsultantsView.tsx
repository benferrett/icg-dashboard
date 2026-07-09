import { Dashboard } from "@/lib/api";
import { fmtNumber } from "@/lib/format";
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
import { Users, Filter } from "lucide-react";

// Consultant performance = the bookings a consultant made and what share showed
// up. We surface (1) a KPI strip of period totals, (2) the full performance
// table with show-up %, and (3) the lead-contact funnel per consultant.
export function ConsultantsView({
  d,
  loading,
  periodLabel,
}: {
  d?: Dashboard;
  loading: boolean;
  periodLabel: string;
}) {
  const win = d?.salesFunnel?.ok ? d.salesFunnel.window : undefined;
  const totalBooked = d?.consultants.reduce((s, c) => s + c.dsBooked, 0) ?? 0;
  const totalSat = d?.consultants.reduce((s, c) => s + c.dsSat, 0) ?? 0;
  const totalSold = d?.consultants.reduce((s, c) => s + c.sold, 0) ?? 0;
  const showUp = totalBooked ? Math.round((totalSat / totalBooked) * 100) : null;
  const convToMembership = totalSat
    ? Math.round((totalSold / totalSat) * 100)
    : null;

  return (
    <div className="flex flex-col gap-8">
      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {loading || !d ? (
          Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))
        ) : (
          <>
            <Stat
              label={`DS booked · ${periodLabel.toLowerCase()}`}
              value={fmtNumber(totalBooked)}
              sub="bookings made"
              testId="consultant-total-booked"
              accent
            />
            <Stat
              label={`DS sat · ${periodLabel.toLowerCase()}`}
              value={fmtNumber(totalSat)}
              sub="sessions held"
              testId="consultant-total-sat"
            />
            <Stat
              label="DS sat rate"
              value={showUp == null ? "—" : `${showUp}%`}
              sub="sat / booked"
              testId="consultant-showup"
              accent
            />
            <Stat
              label={`Memberships sold · ${periodLabel.toLowerCase()}`}
              value={fmtNumber(totalSold)}
              sub="from their bookings"
              testId="consultant-total-sold"
            />
            <Stat
              label="Conversion to membership"
              value={convToMembership == null ? "—" : `${convToMembership}%`}
              sub="sold / DS sat"
              testId="consultant-conversion"
              accent
            />
          </>
        )}
      </div>

      {/* Performance table */}
      <Section
        title={`Consultant performance · ${periodLabel.toLowerCase()}`}
        icon={<Users className="h-4 w-4 text-primary" />}
      >
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Consultant</TableHead>
                <TableHead className="text-right">Leads</TableHead>
                <TableHead className="text-right">DS booked</TableHead>
                <TableHead className="text-right">DS sat</TableHead>
                <TableHead className="text-right">DS sat %</TableHead>
                <TableHead className="text-right">Sold</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading || !d
                ? Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={6}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                : d.consultants.map((c) => (
                    <TableRow key={c.name} data-testid={`row-consultant-${c.name}`}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtNumber(c.deals)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtNumber(c.dsBooked)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtNumber(c.dsSat)}
                      </TableCell>
                      <TableCell className="text-right">
                        {c.showUp == null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <Badge
                            variant={c.showUp >= 70 ? "default" : "secondary"}
                            className="tabular-nums"
                          >
                            {c.showUp}%
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtNumber(c.sold)}
                      </TableCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
        </Card>
      </Section>

      {/* Lead contact funnel per consultant */}
      <Section
        title={`Lead contact funnel · ${periodLabel.toLowerCase()}`}
        icon={<Filter className="h-4 w-4 text-primary" />}
      >
        <Card className="overflow-hidden">
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
              {loading || !win ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={6}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : win.consultants.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center text-muted-foreground text-sm py-6"
                  >
                    No lead-contact activity in this period.
                  </TableCell>
                </TableRow>
              ) : (
                win.consultants.map((c) => (
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
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      </Section>
    </div>
  );
}
