import { useState } from "react";
import type { ConsultantScorecard, ScorecardLead, ScorecardRAG, ScorecardRow } from "@/lib/api";
import { fmtDate, fmtNumber, fmtPct } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CircleHelp, Clock3, ListChecks, MessageSquareText, PhoneCall } from "lucide-react";

type DrilldownKind =
  | "zeroTouch"
  | "underWorked0"
  | "underWorked1"
  | "underWorked2"
  | "underWorked3"
  | "slowTouch"
  | "missedDoubleTaps";

interface DrilldownState {
  consultant: string;
  title: string;
  description: string;
  leads: ScorecardLead[];
}

const RAG_LABEL: Record<ScorecardRAG, string> = {
  green: "On target",
  amber: "Needs attention",
  red: "Coaching priority",
  neutral: "No activity",
};

function ragClass(rag: ScorecardRAG | undefined): string {
  return `scorecard-rag-${rag || "neutral"}`;
}

function rate(value: number | null): string {
  return value == null ? "—" : fmtPct(value);
}

function minutes(value: number | null): string {
  if (value == null) return "—";
  if (value < 60) return `${Math.round(value)}m`;
  const hours = Math.floor(value / 60);
  const mins = Math.round(value % 60);
  return `${hours}h ${mins}m`;
}

function MetricHead({ label, detail }: { label: string; detail: string }) {
  return (
    <TableHead className="h-11 px-3 text-right whitespace-nowrap">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            aria-label={`${label}: ${detail}`}
          >
            {label}
            <CircleHelp className="h-3.5 w-3.5 shrink-0" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-64 leading-relaxed">{detail}</TooltipContent>
      </Tooltip>
    </TableHead>
  );
}

function RAGValue({
  children,
  rag,
  className = "",
  hero = false,
}: {
  children: React.ReactNode;
  rag?: ScorecardRAG;
  className?: string;
  hero?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={`inline-flex min-w-12 justify-center rounded font-semibold tabular-nums ${
            hero ? "px-2.5 py-1 text-sm" : "px-1.5 py-0.5 text-xs"
          } ${ragClass(
            rag,
          )} ${className}`}
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{RAG_LABEL[rag || "neutral"]}</TooltipContent>
    </Tooltip>
  );
}

function DrilldownButton({
  row,
  kind,
  onOpen,
}: {
  row: ScorecardRow;
  kind: DrilldownKind;
  onOpen: (state: DrilldownState) => void;
}) {
  const content: Record<
    DrilldownKind,
    { label: string; description: string; leads: ScorecardLead[]; rag?: ScorecardRAG }
  > = {
    zeroTouch: {
      label: "Zero-touch",
      description:
        "Eligible paid leads with no outbound call and no SMS. Manual userId records and Aircall inbound source 36503 are excluded.",
      leads: row.drilldowns.zeroTouch,
      rag: row.rag.zeroTouch,
    },
    underWorked0: {
      label: "1–4 dials · 0 SMS",
      description: "Eligible paid leads with 1–4 dials, no conversation, and no SMS.",
      leads: row.drilldowns.underWorked.zero,
    },
    underWorked1: {
      label: "1–4 dials · 1 SMS",
      description: "Eligible paid leads with 1–4 dials, no conversation, and one SMS.",
      leads: row.drilldowns.underWorked.one,
    },
    underWorked2: {
      label: "1–4 dials · 2 SMS",
      description: "Eligible paid leads with 1–4 dials, no conversation, and two SMS.",
      leads: row.drilldowns.underWorked.two,
    },
    underWorked3: {
      label: "1–4 dials · 3+ SMS",
      description: "Eligible paid leads with 1–4 dials, no conversation, and three or more SMS.",
      leads: row.drilldowns.underWorked.threePlus,
    },
    slowTouch: {
      label: "Slow first touch",
      description: "Eligible paid leads whose first outbound call was more than 15 minutes after creation.",
      leads: row.drilldowns.slowTouch,
      rag: row.rag.firstTouch,
    },
    missedDoubleTaps: {
      label: "Missed double-taps",
      description:
        "Unanswered outbound calls in the selected period with no later outbound call on the same contact within two minutes.",
      leads: row.drilldowns.missedDoubleTaps,
      rag: row.rag.doubleTapRate,
    },
  };
  const item = content[kind];
  return (
    <Button
      variant="ghost"
      size="sm"
      className={`h-7 min-w-8 px-2 text-xs tabular-nums hover:bg-muted ${item.rag ? ragClass(item.rag) : ""}`}
      onClick={() =>
        onOpen({
          consultant: row.name,
          title: item.label,
          description: item.description,
          leads: item.leads,
        })
      }
      aria-label={`View ${item.label} leads for ${row.name}`}
    >
      {fmtNumber(item.leads.length)}
    </Button>
  );
}

function LeadDrilldown({ state, onOpenChange }: { state: DrilldownState | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={!!state} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(96vw,1100px)] p-0 gap-0">
        {state && (
          <>
            <DialogHeader className="border-b p-5 pr-12">
              <DialogTitle>{state.title} · {state.consultant}</DialogTitle>
              <DialogDescription>{state.description}</DialogDescription>
            </DialogHeader>
            <ScrollArea className="max-h-[70vh]">
              <div className="min-w-[800px]">
                <Table>
                  <TableHeader className="sticky top-0 bg-background">
                    <TableRow>
                      <TableHead>Lead</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Owner</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead className="text-right">Dials</TableHead>
                      <TableHead className="text-right">SMS</TableHead>
                      <TableHead className="text-right">First touch</TableHead>
                      <TableHead>Why listed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {state.leads.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                          No leads need action in this list.
                        </TableCell>
                      </TableRow>
                    ) : (
                      state.leads.map((lead) => (
                        <TableRow key={lead.id}>
                          <TableCell className="font-medium">{lead.name}</TableCell>
                          <TableCell className="max-w-56 truncate text-muted-foreground">{lead.email}</TableCell>
                          <TableCell className="whitespace-nowrap">{lead.owner || "—"}</TableCell>
                          <TableCell className="whitespace-nowrap tabular-nums">{fmtDate(lead.createdAt)}</TableCell>
                          <TableCell className="max-w-56 truncate text-muted-foreground">{lead.source}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtNumber(lead.dials)}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtNumber(lead.sms)}</TableCell>
                          <TableCell className="text-right tabular-nums">{minutes(lead.firstTouchMins)}</TableCell>
                          <TableCell className="max-w-80 text-muted-foreground">{lead.reason || "—"}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </ScrollArea>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function HeroCard({ row, onOpen }: { row: ScorecardRow; onOpen: (state: DrilldownState) => void }) {
  const underWorked =
    row.underWorked0Sms + row.underWorked1Sms + row.underWorked2Sms + row.underWorked3PlusSms;
  return (
    <Card className="flex min-h-[400px] flex-col gap-6 p-8" data-testid={`scorecard-hero-${row.name}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">{row.name}</h3>
          <p className="text-sm text-muted-foreground">{row.role} · weekly coaching view</p>
        </div>
        <RAGValue rag={row.rag.doubleTapRate} hero>{rate(row.doubleTapRate)} DT</RAGValue>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <div className="text-5xl font-semibold tabular-nums">{fmtNumber(row.dials)}</div>
          <div className="text-sm text-muted-foreground">dials</div>
        </div>
        <div>
          <RAGValue rag={row.rag.connectRate} hero>{rate(row.connectRate)}</RAGValue>
          <div className="mt-1 text-sm text-muted-foreground">connect</div>
        </div>
        <div>
          <RAGValue rag={row.rag.conversationRate} hero>{rate(row.conversationRate)}</RAGValue>
          <div className="mt-1 text-sm text-muted-foreground">conversation</div>
        </div>
        <div>
          <RAGValue rag={row.rag.dialsPerLead} hero>{row.dialsPerLead?.toFixed(1) ?? "—"}</RAGValue>
          <div className="mt-1 text-sm text-muted-foreground">dials/lead</div>
        </div>
        <div>
          <RAGValue rag={row.rag.smsPerLead} hero>{row.smsPerLead?.toFixed(1) ?? "—"}</RAGValue>
          <div className="mt-1 text-sm text-muted-foreground">SMS/lead</div>
        </div>
        <div>
          <RAGValue rag={row.rag.firstTouch} hero>{minutes(row.medianFirstTouchMins)}</RAGValue>
          <div className="mt-1 text-sm text-muted-foreground">median first touch</div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 border-t pt-3">
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => {
          const lead = row.drilldowns.zeroTouch;
          onOpen({
            consultant: row.name,
            title: "Zero-touch",
            description: "Eligible paid leads with no outbound call and no SMS.",
            leads: lead,
          });
        }}>
          {row.zeroTouch} zero
        </Button>
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => {
          const lead = [
            ...row.drilldowns.underWorked.zero,
            ...row.drilldowns.underWorked.one,
            ...row.drilldowns.underWorked.two,
            ...row.drilldowns.underWorked.threePlus,
          ];
          onOpen({
            consultant: row.name,
            title: "Under-worked leads",
            description: "Eligible paid leads with 1–4 dials and no conversation, grouped by SMS coverage in the table.",
            leads: lead,
          });
        }}>
          {underWorked} under
        </Button>
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => {
          const lead = row.drilldowns.missedDoubleTaps;
          onOpen({
            consultant: row.name,
            title: "Missed double-taps",
            description: "Unanswered calls that were not redialled within two minutes.",
            leads: lead,
          });
        }}>
          {row.missedDoubleTaps} missed
        </Button>
      </div>
    </Card>
  );
}

export function ConsultantScorecardView({ scorecard }: { scorecard?: ConsultantScorecard }) {
  const [drilldown, setDrilldown] = useState<DrilldownState | null>(null);
  if (!scorecard?.ok) return null;

  return (
    <>
      <section className="flex flex-col gap-4" aria-labelledby="excellent-scorecard-heading">
        <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-primary" />
              <h2 id="excellent-scorecard-heading" className="text-base font-semibold">
                Excellent Consultant Scorecard
              </h2>
            </div>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Leading indicators for the weekly booker review: speed, persistent follow-up, and coverage before a lead goes cold.
            </p>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex w-fit cursor-help items-center gap-1 text-xs text-muted-foreground">
                <CircleHelp className="h-3.5 w-3.5" />
                How this scorecard is calculated
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm leading-relaxed">
              {scorecard.sourceNote} Green meets target, amber is recoverable, and red should be a concrete coaching commitment this week.
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="grid w-full grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {scorecard.rows.map((row) => (
            <HeroCard key={row.name} row={row} onOpen={setDrilldown} />
          ))}
        </div>

        <Card className="overflow-hidden">
          <div className="border-b bg-muted/30 px-4 py-3">
            <div className="flex items-center gap-2">
              <PhoneCall className="h-4 w-4 text-primary" />
              <h3 className="font-medium">Outreach discipline by consultant</h3>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Booker targets: connect ≥85%, conversation ≥90%, double-tap ≥80%, dials/lead ≥8, SMS/lead ≥3.
            </p>
          </div>
          <Table className="min-w-[2010px]">
            <TableHeader>
              <TableRow>
                <TableHead className="h-11 min-w-44 px-4">Consultant</TableHead>
                <MetricHead label="Owned" detail="Contacts created in the selected period that currently belong to the consultant." />
                <MetricHead label="Worked" detail="Distinct owned leads with an outbound call or SMS logged by this consultant in the selected period." />
                <MetricHead label="Dials" detail="Outbound calls logged by the consultant against their owned leads in the selected period." />
                <MetricHead label="Conn." detail="Outbound dials classified as connected. Unanswered, busy, voicemail, and wrong-number calls are not connected." />
                <MetricHead label="Conn %" detail="Connected outbound dials divided by all outbound dials. Target: ≥85%." />
                <MetricHead label="Spoke" detail="Distinct worked leads with at least one connected outbound call." />
                <MetricHead label="Conv %" detail="Leads spoken to divided by leads worked. Target: ≥90%." />
                <MetricHead label="Unans." detail="Unanswered outbound calls: no answer, busy, voicemail, wrong number, or another non-connected outcome." />
                <MetricHead label="DT" detail="Unanswered calls followed by any later outbound call on the same contact within two minutes." />
                <MetricHead label="DT %" detail="Double-tapped unanswered calls divided by all unanswered calls. Target: ≥80%." />
                <MetricHead label="Dials/lead" detail="Outbound dials divided by leads worked. Target: ≥8." />
                <MetricHead label="SMS" detail="Outbound SMS communications logged by the consultant on owned leads in the selected period." />
                <MetricHead label="SMS/lead" detail="Outbound SMS divided by leads worked. Target: ≥3." />
                <MetricHead label="1st touch" detail="Median time from lead creation to the first outbound call, across owned leads with at least one call." />
                <MetricHead label="Zero" detail="Eligible paid leads with no outbound calls and no SMS. Click to review." />
                <MetricHead label="0 SMS" detail="Eligible paid leads with 1–4 dials, no conversation, and 0 SMS. Click to review." />
                <MetricHead label="1 SMS" detail="Eligible paid leads with 1–4 dials, no conversation, and 1 SMS. Click to review." />
                <MetricHead label="2 SMS" detail="Eligible paid leads with 1–4 dials, no conversation, and 2 SMS. Click to review." />
                <MetricHead label="3+ SMS" detail="Eligible paid leads with 1–4 dials, no conversation, and 3 or more SMS. Click to review." />
                <MetricHead label="Slow" detail="Eligible paid leads whose first outbound call was more than 15 minutes after creation. Click to review." />
                <MetricHead label="Missed DT" detail="Unanswered calls in the selected period not redialled within two minutes. Click to review." />
              </TableRow>
            </TableHeader>
            <TableBody>
              {scorecard.rows.map((row) => (
                <TableRow key={row.name} data-testid={`scorecard-row-${row.name}`}>
                  <TableCell className="px-4">
                    <div className="font-medium">{row.name}</div>
                    <div className="text-xs text-muted-foreground">{row.role}</div>
                  </TableCell>
                  <TableCell className="px-3 text-right tabular-nums">{fmtNumber(row.ownedLeads)}</TableCell>
                  <TableCell className="px-3 text-right tabular-nums">{fmtNumber(row.workedLeads)}</TableCell>
                  <TableCell className="px-3 text-right tabular-nums">{fmtNumber(row.dials)}</TableCell>
                  <TableCell className="px-3 text-right tabular-nums">{fmtNumber(row.connected)}</TableCell>
                  <TableCell className="px-3 text-right"><RAGValue rag={row.rag.connectRate}>{rate(row.connectRate)}</RAGValue></TableCell>
                  <TableCell className="px-3 text-right tabular-nums">{fmtNumber(row.spokeLeads)}</TableCell>
                  <TableCell className="px-3 text-right"><RAGValue rag={row.rag.conversationRate}>{rate(row.conversationRate)}</RAGValue></TableCell>
                  <TableCell className="px-3 text-right tabular-nums">{fmtNumber(row.unanswered)}</TableCell>
                  <TableCell className="px-3 text-right tabular-nums">{fmtNumber(row.doubleTaps)}</TableCell>
                  <TableCell className="px-3 text-right"><RAGValue rag={row.rag.doubleTapRate}>{rate(row.doubleTapRate)}</RAGValue></TableCell>
                  <TableCell className="px-3 text-right"><RAGValue rag={row.rag.dialsPerLead}>{row.dialsPerLead?.toFixed(1) ?? "—"}</RAGValue></TableCell>
                  <TableCell className="px-3 text-right tabular-nums">{fmtNumber(row.sms)}</TableCell>
                  <TableCell className="px-3 text-right"><RAGValue rag={row.rag.smsPerLead}>{row.smsPerLead?.toFixed(1) ?? "—"}</RAGValue></TableCell>
                  <TableCell className="px-3 text-right"><RAGValue rag={row.rag.firstTouch}>{minutes(row.medianFirstTouchMins)}</RAGValue></TableCell>
                  <TableCell className="px-2 text-right"><DrilldownButton row={row} kind="zeroTouch" onOpen={setDrilldown} /></TableCell>
                  <TableCell className="px-2 text-right"><DrilldownButton row={row} kind="underWorked0" onOpen={setDrilldown} /></TableCell>
                  <TableCell className="px-2 text-right"><DrilldownButton row={row} kind="underWorked1" onOpen={setDrilldown} /></TableCell>
                  <TableCell className="px-2 text-right"><DrilldownButton row={row} kind="underWorked2" onOpen={setDrilldown} /></TableCell>
                  <TableCell className="px-2 text-right"><DrilldownButton row={row} kind="underWorked3" onOpen={setDrilldown} /></TableCell>
                  <TableCell className="px-2 text-right"><DrilldownButton row={row} kind="slowTouch" onOpen={setDrilldown} /></TableCell>
                  <TableCell className="px-2 text-right"><DrilldownButton row={row} kind="missedDoubleTaps" onOpen={setDrilldown} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        <div className="grid gap-3 md:grid-cols-3">
          <Card className="p-4">
            <div className="flex items-center gap-2 text-sm font-medium"><PhoneCall className="h-4 w-4 text-primary" />Double-tap standard</div>
            <p className="mt-2 text-sm text-muted-foreground">After every unanswered outbound call, make a second outbound call to that contact within two minutes.</p>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-sm font-medium"><MessageSquareText className="h-4 w-4 text-primary" />SMS coverage</div>
            <p className="mt-2 text-sm text-muted-foreground">No paid lead should sit at 0 SMS. Use the 0/1/2/3+ SMS action lists to decide the next follow-up.</p>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-sm font-medium"><Clock3 className="h-4 w-4 text-primary" />Weekly coaching question</div>
            <p className="mt-2 text-sm text-muted-foreground">Choose one measurable commitment: lift double-tap %, increase SMS/lead, or bring first-touch time down.</p>
          </Card>
        </div>
      </section>
      <LeadDrilldown state={drilldown} onOpenChange={(open) => !open && setDrilldown(null)} />
    </>
  );
}
