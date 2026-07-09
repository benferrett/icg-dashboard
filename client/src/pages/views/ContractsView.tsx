import { Dashboard } from "@/lib/api";
import { fmtNumber, fmtCurrency, fmtDate } from "@/lib/format";
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
import { FileSignature, Layers } from "lucide-react";
import { CHART_COLORS } from "./shared";

// Full breakdown of the contract + settlement pipeline: the 5-step funnel,
// a per-strategist matrix, the pipeline-value split (which surfaces the
// settlement pipelines), and the full EOI / UC deal listings.
export function ContractsView({
  d,
  loading,
  periodLabel,
}: {
  d?: Dashboard;
  loading: boolean;
  periodLabel: string;
}) {
  if (loading || !d) {
    return <Skeleton className="h-96 w-full" />;
  }

  const c = d.contracts;
  const maxStep = Math.max(1, ...c.funnel.map((f) => f.count));
  const eoiDeals = c.deals.filter((x) => !!x.eoiDate);
  const ucDeals = c.deals.filter((x) => !!x.ucDate);

  // Settlement pipelines carry the UC/settled deals. Surface them from the
  // financial pipeline-value split so the contract view shows the full journey
  // through settlement, not just the membership/contract pipeline.
  const settlementPipes = d.financial.byPipeline.filter((p) =>
    /settlement|construction|land/i.test(p.name),
  );
  const contractPipes = d.financial.byPipeline.filter(
    (p) => !/settlement|construction|land/i.test(p.name),
  );

  const DealList = ({
    title,
    rows,
    testId,
    dateLabel,
    dateField,
  }: {
    title: string;
    rows: typeof c.deals;
    testId: string;
    dateLabel: string;
    dateField: "eoiDate" | "ucDate";
  }) => (
    <Card className="p-4 overflow-hidden">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {rows.length} deal{rows.length === 1 ? "" : "s"} ·{" "}
          {fmtCurrency(
            rows.reduce((s, r) => s + (r.amount || 0), 0),
            true,
          )}
        </span>
      </div>
      <div className="mt-2 overflow-x-auto">
        <Table className="text-xs">
          <TableHeader>
            <TableRow>
              <TableHead className="px-2">Deal</TableHead>
              <TableHead className="px-2">Where it's at</TableHead>
              <TableHead className="px-2">Strategist</TableHead>
              <TableHead className="px-2 whitespace-nowrap">{dateLabel}</TableHead>
              <TableHead className="px-2 text-right">Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center text-muted-foreground text-sm py-6"
                >
                  None in this period.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r, i) => (
                <TableRow key={i} data-testid={`row-${testId}-${i}`}>
                  <TableCell className="px-2 font-medium max-w-[170px] truncate">
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
                    className="px-2 max-w-[150px] truncate text-muted-foreground"
                    title={r.stage}
                  >
                    {r.stage}
                  </TableCell>
                  <TableCell className="px-2 whitespace-nowrap">{r.owner}</TableCell>
                  <TableCell className="px-2 tabular-nums whitespace-nowrap text-muted-foreground">
                    {fmtDate((r[dateField] as string) || r.date)}
                  </TableCell>
                  <TableCell className="px-2 text-right tabular-nums whitespace-nowrap">
                    {r.amount ? fmtCurrency(r.amount, true) : "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </Card>
  );

  return (
    <div className="flex flex-col gap-8">
      <Section
        title={`Contract funnel · ${periodLabel.toLowerCase()}`}
        icon={<FileSignature className="h-4 w-4 text-primary" />}
      >
        <div className="flex flex-col gap-4">
          {/* Funnel step KPI strip */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {c.funnel.map((f) => (
              <Stat
                key={f.key}
                label={f.label}
                value={fmtNumber(f.count)}
                sub={f.value ? fmtCurrency(f.value, true) : "—"}
                testId={`contract-step-${f.key}`}
                accent={f.key === "uc"}
              />
            ))}
          </div>

          {/* Visual funnel bars */}
          <Card className="p-4">
            <span className="text-sm font-medium">
              Contract funnel · deals entered this period
            </span>
            <div className="mt-3 flex flex-col gap-2.5">
              {c.funnel.map((f, i) => (
                <div key={f.key} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="truncate">{f.label}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {fmtNumber(f.count)}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${(f.count / maxStep) * 100}%`,
                        background: CHART_COLORS[i % CHART_COLORS.length],
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* By strategist matrix */}
          <Card className="overflow-hidden">
            <div className="px-4 pt-4 pb-2 text-sm font-medium">
              By strategist · {periodLabel.toLowerCase()}
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Strategist</TableHead>
                    {c.steps.map((s) => (
                      <TableHead key={s.key} className="text-right">
                        {s.label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {c.byStrategist.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={c.steps.length + 1}
                        className="text-center text-muted-foreground text-sm py-6"
                      >
                        No contract activity in this period.
                      </TableCell>
                    </TableRow>
                  ) : (
                    c.byStrategist.map((row) => (
                      <TableRow
                        key={row.name}
                        data-testid={`row-contract-strat-${row.name}`}
                      >
                        <TableCell className="font-medium">{row.name}</TableCell>
                        {c.steps.map((s) => (
                          <TableCell key={s.key} className="text-right tabular-nums">
                            {fmtNumber(Number(row[s.key] || 0))}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </div>
      </Section>

      {/* Pipeline value split (contract vs settlement) */}
      <Section
        title="Pipeline value"
        icon={<Layers className="h-4 w-4 text-primary" />}
      >
        <div className="grid lg:grid-cols-2 gap-4">
          <Card className="p-4">
            <span className="text-sm font-medium">Contract pipelines</span>
            <div className="mt-3 flex flex-col gap-3">
              {contractPipes.length === 0 ? (
                <span className="text-sm text-muted-foreground">No deals.</span>
              ) : (
                contractPipes
                  .slice()
                  .sort((a, b) => b.value - a.value)
                  .map((p) => (
                    <div
                      key={p.name}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <div className="flex flex-col">
                        <span className="font-medium truncate">{p.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {fmtNumber(p.count)} deals
                        </span>
                      </div>
                      <span className="tabular-nums font-semibold">
                        {fmtCurrency(p.value, true)}
                      </span>
                    </div>
                  ))
              )}
            </div>
          </Card>
          <Card className="p-4">
            <span className="text-sm font-medium">Settlement pipelines</span>
            <div className="mt-3 flex flex-col gap-3">
              {settlementPipes.length === 0 ? (
                <span className="text-sm text-muted-foreground">
                  No settlement deals.
                </span>
              ) : (
                settlementPipes
                  .slice()
                  .sort((a, b) => b.value - a.value)
                  .map((p) => (
                    <div
                      key={p.name}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <div className="flex flex-col">
                        <span className="font-medium truncate">{p.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {fmtNumber(p.count)} deals
                        </span>
                      </div>
                      <span className="tabular-nums font-semibold">
                        {fmtCurrency(p.value, true)}
                      </span>
                    </div>
                  ))
              )}
            </div>
          </Card>
        </div>
      </Section>

      {/* Full deal listings */}
      <Section
        title={`All deals · ${periodLabel.toLowerCase()}`}
        icon={<FileSignature className="h-4 w-4 text-primary" />}
      >
        <div className="grid lg:grid-cols-2 gap-4">
          <DealList
            title={`All EOI · ${periodLabel.toLowerCase()}`}
            rows={eoiDeals}
            testId="eoi"
            dateLabel="EOI date"
            dateField="eoiDate"
          />
          <DealList
            title={`All UC · ${periodLabel.toLowerCase()}`}
            rows={ucDeals}
            testId="uc"
            dateLabel="UC date"
            dateField="ucDate"
          />
        </div>
      </Section>
    </div>
  );
}
