import { Dashboard, ContractDeal } from "@/lib/api";
import { fmtNumber, fmtCurrency, fmtDate } from "@/lib/format";
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
import { Target, FileSignature } from "lucide-react";

// Strategist performance = memberships sold + the property deals they carry.
// We reuse contracts.deals (each has an owner = strategist) to build per-
// strategist EOI/UC lists so this view is a genuine breakdown of each
// strategist's contract pipeline, not just the summary counts.
export function StrategistsView({
  d,
  loading,
  periodLabel,
}: {
  d?: Dashboard;
  loading: boolean;
  periodLabel: string;
}) {
  // Group every contract deal in the period by its handling strategist.
  const byStrategist: Record<string, ContractDeal[]> = {};
  if (d) {
    for (const deal of d.contracts.deals) {
      const key = deal.owner || "Unattributed";
      (byStrategist[key] ||= []).push(deal);
    }
  }
  // Order strategists by the team table (sold desc), then any extras.
  const ordered = d
    ? [
        ...d.strategists.map((s) => s.name),
        ...Object.keys(byStrategist).filter(
          (n) => !d.strategists.some((s) => s.name === n),
        ),
      ]
    : [];

  const totalSold = d?.strategists.reduce((s, x) => s + x.sold, 0) ?? 0;
  const totalAssigned = d?.strategists.reduce((s, x) => s + x.assigned, 0) ?? 0;
  const conv = totalAssigned
    ? Math.round((totalSold / totalAssigned) * 100)
    : 0;

  return (
    <div className="flex flex-col gap-8">
      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {loading || !d ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))
        ) : (
          <>
            <Stat
              label={`Deals assigned · ${periodLabel.toLowerCase()}`}
              value={fmtNumber(totalAssigned)}
              testId="strategist-total-assigned"
            />
            <Stat
              label={`Memberships sold · ${periodLabel.toLowerCase()}`}
              value={fmtNumber(totalSold)}
              testId="strategist-total-sold"
              accent
            />
            <Stat
              label="Team conversion"
              value={`${conv}%`}
              sub="sold ÷ assigned"
              testId="strategist-conv"
            />
            <Stat
              label={`UC settled · ${periodLabel.toLowerCase()}`}
              value={fmtNumber(
                d.contracts.deals.filter((x) => !!x.ucDate).length,
              )}
              sub="properties unconditional"
              testId="strategist-uc"
              accent
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Strategist</TableHead>
                <TableHead className="text-right">Assigned</TableHead>
                <TableHead className="text-right">Membership sold</TableHead>
                <TableHead className="text-right">Conv.</TableHead>
                <TableHead className="text-right">EOI deals</TableHead>
                <TableHead className="text-right">UC deals</TableHead>
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
                : d.strategists.map((s) => {
                    const deals = byStrategist[s.name] || [];
                    const eoi = deals.filter((x) => !!x.eoiDate).length;
                    const uc = deals.filter((x) => !!x.ucDate).length;
                    return (
                      <TableRow
                        key={s.name}
                        data-testid={`row-strategist-${s.name}`}
                      >
                        <TableCell className="font-medium">{s.name}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtNumber(s.assigned)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtNumber(s.sold)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge
                            variant={s.conversion >= 30 ? "default" : "secondary"}
                            className="tabular-nums"
                          >
                            {s.conversion}%
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtNumber(eoi)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtNumber(uc)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
            </TableBody>
          </Table>
        </Card>
      </Section>

      {/* Per-strategist deal breakdown */}
      <Section
        title={`Property deals by strategist · ${periodLabel.toLowerCase()}`}
        icon={<FileSignature className="h-4 w-4 text-primary" />}
      >
        {loading || !d ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <div className="flex flex-col gap-4">
            {ordered
              .filter((name) => (byStrategist[name] || []).length > 0)
              .map((name) => {
                const deals = byStrategist[name];
                const value = deals.reduce((s, r) => s + (r.amount || 0), 0);
                return (
                  <Card key={name} className="p-4 overflow-hidden">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium">{name}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {deals.length} deal{deals.length === 1 ? "" : "s"} ·{" "}
                        {fmtCurrency(value, true)}
                      </span>
                    </div>
                    <div className="overflow-x-auto">
                      <Table className="text-xs">
                        <TableHeader>
                          <TableRow>
                            <TableHead className="px-2">Deal</TableHead>
                            <TableHead className="px-2">Where it's at</TableHead>
                            <TableHead className="px-2 whitespace-nowrap">
                              EOI date
                            </TableHead>
                            <TableHead className="px-2 whitespace-nowrap">
                              UC date
                            </TableHead>
                            <TableHead className="px-2 text-right">Value</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {deals.map((r, i) => (
                            <TableRow
                              key={i}
                              data-testid={`row-strat-deal-${name}-${i}`}
                            >
                              <TableCell className="px-2 font-medium max-w-[190px] truncate">
                                <a
                                  href={r.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="hover:text-primary hover:underline"
                                  title={r.name}
                                >
                                  {r.name}
                                </a>
                              </TableCell>
                              <TableCell
                                className="px-2 max-w-[160px] truncate text-muted-foreground"
                                title={r.stage}
                              >
                                {r.stage}
                              </TableCell>
                              <TableCell className="px-2 tabular-nums whitespace-nowrap text-muted-foreground">
                                {r.eoiDate ? fmtDate(r.eoiDate) : "—"}
                              </TableCell>
                              <TableCell className="px-2 tabular-nums whitespace-nowrap text-muted-foreground">
                                {r.ucDate ? fmtDate(r.ucDate) : "—"}
                              </TableCell>
                              <TableCell className="px-2 text-right tabular-nums whitespace-nowrap">
                                {r.amount ? fmtCurrency(r.amount, true) : "—"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </Card>
                );
              })}
            {ordered.filter((n) => (byStrategist[n] || []).length > 0).length ===
              0 && (
              <Card className="p-6 text-center text-sm text-muted-foreground">
                No property deals in this period.
              </Card>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}
