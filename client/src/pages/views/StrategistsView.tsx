import { Dashboard } from "@/lib/api";
import { fmtNumber, fmtDate } from "@/lib/format";
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
import { Target, Users } from "lucide-react";

// Strategist view = discovery-session pipeline + the actual memberships each
// strategist sold in the period (no property/contract deals here).
export function StrategistsView({
  d,
  loading,
  periodLabel,
}: {
  d?: Dashboard;
  loading: boolean;
  periodLabel: string;
}) {
  const totalSold = d?.strategists.reduce((s, x) => s + x.sold, 0) ?? 0;
  const totalBooked = d?.strategists.reduce((s, x) => s + x.dsBooked, 0) ?? 0;
  const totalSat = d?.strategists.reduce((s, x) => s + x.dsSat, 0) ?? 0;
  // Team close rate on the strategist side = memberships sold ÷ DS sat.
  const satConv = totalSat ? Math.round((totalSold / totalSat) * 100) : 0;
  const totalOnSession =
    d?.strategists.reduce((s, x) => s + x.soldOnSession, 0) ?? 0;
  const totalFollowUp =
    d?.strategists.reduce((s, x) => s + x.soldFollowUp, 0) ?? 0;
  const totalEoi = d?.strategists.reduce((s, x) => s + x.eoi, 0) ?? 0;
  const totalUc = d?.strategists.reduce((s, x) => s + x.uc, 0) ?? 0;

  return (
    <div className="flex flex-col gap-8">
      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {loading || !d ? (
          Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))
        ) : (
          <>
            <Stat
              label={`DS sat · ${periodLabel.toLowerCase()}`}
              value={fmtNumber(totalSat)}
              sub={`${fmtNumber(totalBooked)} booked`}
              testId="strategist-total-sat"
            />
            <Stat
              label={`Memberships sold · ${periodLabel.toLowerCase()}`}
              value={fmtNumber(totalSold)}
              testId="strategist-total-sold"
              accent
            />
            <Stat
              label="Close rate"
              value={`${satConv}%`}
              sub="sold ÷ DS sat"
              testId="strategist-conv"
            />
            <Stat
              label={`EOI · ${periodLabel.toLowerCase()}`}
              value={fmtNumber(totalEoi)}
              sub="expressions of interest"
              testId="strategist-total-eoi"
            />
            <Stat
              label={`UC · ${periodLabel.toLowerCase()}`}
              value={fmtNumber(totalUc)}
              sub="unconditional"
              testId="strategist-total-uc"
              accent
            />
            <Stat
              label={`Sold on session · ${periodLabel.toLowerCase()}`}
              value={fmtNumber(totalOnSession)}
              sub={`${fmtNumber(totalFollowUp)} via follow-up`}
              testId="strategist-on-session"
            />
          </>
        )}
      </div>

      {/* Performance table */}
      <Section
        title={`Strategist performance · ${periodLabel.toLowerCase()}`}
        icon={<Target className="h-4 w-4 text-primary" />}
      >
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Strategist</TableHead>
                <TableHead className="text-right">DS sat</TableHead>
                <TableHead className="text-right">Memberships sold</TableHead>
                <TableHead className="text-right">Close rate</TableHead>
                <TableHead className="text-right">EOI</TableHead>
                <TableHead className="text-right">UC</TableHead>
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
                : [...d.strategists]
                    .sort((a, b) => b.sold - a.sold)
                    .map((s) => (
                    <TableRow
                      key={s.name}
                      data-testid={`row-strategist-${s.name}`}
                    >
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtNumber(s.dsSat)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtNumber(s.sold)}
                      </TableCell>
                      <TableCell className="text-right">
                        {s.satConversion === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <Badge
                            variant={
                              s.satConversion >= 25 ? "default" : "secondary"
                            }
                            className="tabular-nums"
                          >
                            {s.satConversion}%
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {s.eoi ? (
                          fmtNumber(s.eoi)
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {s.uc ? (
                          fmtNumber(s.uc)
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
              {!loading && d && d.strategists.length > 0 && (
                <TableRow className="border-t-2 font-medium">
                  <TableCell>Team total</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtNumber(totalSat)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtNumber(totalSold)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {satConv}%
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtNumber(totalEoi)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtNumber(totalUc)}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          </div>
        </Card>
      </Section>

      {/* Membership sales split: on-session vs follow-up */}
      <Section
        title={`Membership sales by strategist · ${periodLabel.toLowerCase()}`}
        icon={<Users className="h-4 w-4 text-primary" />}
      >
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Strategist</TableHead>
                <TableHead className="text-right">Total sold</TableHead>
                <TableHead className="text-right">On session</TableHead>
                <TableHead className="text-right">Via follow-up</TableHead>
                <TableHead className="text-right">On-session %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading || !d ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={5}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : d.strategists.filter((s) => s.sold > 0).length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center text-sm text-muted-foreground py-6"
                  >
                    No memberships sold in this period.
                  </TableCell>
                </TableRow>
              ) : (
                d.strategists
                  .filter((s) => s.sold > 0)
                  .map((s) => {
                    const pct = s.sold
                      ? Math.round((s.soldOnSession / s.sold) * 100)
                      : 0;
                    return (
                      <TableRow
                        key={s.name}
                        data-testid={`row-strat-split-${s.name}`}
                      >
                        <TableCell className="font-medium">{s.name}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtNumber(s.sold)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtNumber(s.soldOnSession)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtNumber(s.soldFollowUp)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="secondary" className="tabular-nums">
                            {pct}%
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })
              )}
              {!loading && d && d.strategists.filter((s) => s.sold > 0).length > 0 && (
                <TableRow className="border-t-2 font-medium">
                  <TableCell>Team total</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtNumber(totalSold)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtNumber(totalOnSession)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtNumber(totalFollowUp)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {totalSold
                      ? Math.round((totalOnSession / totalSold) * 100)
                      : 0}
                    %
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      </Section>

      {/* Per-strategist list of the actual memberships sold */}
      <Section
        title={`Memberships sold by strategist · ${periodLabel.toLowerCase()}`}
        icon={<Target className="h-4 w-4 text-primary" />}
      >
        {loading || !d ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <div className="flex flex-col gap-4">
            {d.strategists
              .filter((s) => s.memberships.length > 0)
              .map((s) => (
                <Card key={s.name} className="p-4 overflow-hidden">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">{s.name}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {s.memberships.length} member
                      {s.memberships.length === 1 ? "" : "s"} · {s.soldOnSession}{" "}
                      on session · {s.soldFollowUp} follow-up
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <Table className="text-xs">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="px-2">Member</TableHead>
                          <TableHead className="px-2">Tier</TableHead>
                          <TableHead className="px-2">Source</TableHead>
                          <TableHead className="px-2">How</TableHead>
                          <TableHead className="px-2 text-right whitespace-nowrap">
                            Paid
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {s.memberships.map((m, i) => (
                          <TableRow
                            key={i}
                            data-testid={`row-strat-member-${s.name}-${i}`}
                          >
                            <TableCell className="px-2 font-medium max-w-[240px] truncate">
                              <a
                                href={m.url}
                                target="_blank"
                                rel="noreferrer"
                                className="hover:text-primary hover:underline"
                                title={m.name}
                              >
                                {m.name}
                              </a>
                            </TableCell>
                            <TableCell className="px-2 text-muted-foreground">
                              {m.tier}
                            </TableCell>
                            <TableCell className="px-2 text-muted-foreground whitespace-nowrap">
                              {m.source || "Unknown"}
                            </TableCell>
                            <TableCell className="px-2">
                              <Badge
                                variant={m.onSession ? "default" : "secondary"}
                                className="text-[10px]"
                              >
                                {m.onSession ? "On session" : "Follow-up"}
                              </Badge>
                            </TableCell>
                            <TableCell className="px-2 text-right tabular-nums whitespace-nowrap text-muted-foreground">
                              {fmtDate(m.closedate)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </Card>
              ))}
            {d.strategists.filter((s) => s.memberships.length > 0).length ===
              0 && (
              <Card className="p-6 text-center text-sm text-muted-foreground">
                No memberships sold in this period.
              </Card>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}
