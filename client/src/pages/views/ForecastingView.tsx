import { useQuery } from "@tanstack/react-query";
import { apiGet, Forecast } from "@/lib/api";
import { timeAgo } from "@/lib/format";
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
import { CalendarClock, CalendarDays, Users, Home } from "lucide-react";

// Format a UTC ISO instant as the Melbourne local day + time (e.g. "Mon 11 Aug, 2:30pm").
function melDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(+d)) return "\u2014";
  return d.toLocaleString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Australia/Melbourne",
  });
}

// A single forecast tile: the rest-of-month figure (headline) plus the
// full-month total (already-held + still-to-come) as context.
function ForecastCard({
  title,
  icon,
  rest,
  full,
  accent,
  testId,
}: {
  title: string;
  icon: React.ReactNode;
  rest: number;
  full: number;
  accent: string;
  testId: string;
}) {
  const held = Math.max(0, full - rest);
  return (
    <Card className="p-5 flex flex-col gap-3" data-testid={testId}>
      <div className="flex items-center gap-2">
        <span
          className="inline-flex h-8 w-8 items-center justify-center rounded-md"
          style={{ background: `${accent}1a`, color: accent }}
        >
          {icon}
        </span>
        <span className="text-sm font-semibold">{title}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span
          className="text-4xl font-semibold tabular-nums leading-none"
          style={{ color: accent }}
          data-testid={`${testId}-rest`}
        >
          {rest}
        </span>
        <span className="text-sm text-muted-foreground">still to come</span>
      </div>
      <div className="flex items-center gap-4 text-xs text-muted-foreground border-t pt-3">
        <span>
          Full month total:{" "}
          <span className="font-semibold text-foreground tabular-nums" data-testid={`${testId}-full`}>
            {full}
          </span>
        </span>
        <span>
          Already held:{" "}
          <span className="font-semibold text-foreground tabular-nums">{held}</span>
        </span>
      </div>
    </Card>
  );
}

// Forecasting: how many Discovery Sessions and Acquisition Meetings are booked
// for the remainder of the current month, plus the full-month total. Owns its
// own current-month data (no global period picker).
export function ForecastingView({ token }: { token: string }) {
  const q = useQuery<Forecast>({
    queryKey: ["/api/forecast"],
    queryFn: () => apiGet<Forecast>(`/api/forecast`, token),
  });

  const data = q.data;
  const upcoming = data?.upcoming ?? [];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold" data-testid="forecast-title">
            Forecasting
          </h2>
          {data && (
            <span className="text-xs text-muted-foreground">
              {data.monthLabel} · booked pipeline
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          {data ? `updated ${timeAgo(data.generatedAt)}` : "loading\u2026"}
        </span>
      </div>

      {q.isLoading || !data ? (
        <Skeleton className="h-72 w-full" />
      ) : (
        <>
          <Section
            title={`Booked for the rest of ${data.monthLabel}`}
            icon={<CalendarDays className="h-4 w-4 text-primary" />}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <ForecastCard
                title="Discovery Sessions"
                icon={<Users className="h-4 w-4" />}
                rest={data.ds.restOfMonth}
                full={data.ds.fullMonth}
                accent="hsl(160 84% 39%)"
                testId="forecast-ds"
              />
              <ForecastCard
                title="Acquisition Meetings"
                icon={<Home className="h-4 w-4" />}
                rest={data.am.restOfMonth}
                full={data.am.fullMonth}
                accent="hsl(217 91% 60%)"
                testId="forecast-am"
              />
            </div>
          </Section>

          <Section
            title={`Upcoming this month (${upcoming.length})`}
            icon={<CalendarClock className="h-4 w-4 text-primary" />}
          >
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="whitespace-nowrap">When (AEST)</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Client</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {upcoming.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                          No more sessions booked for the rest of the month.
                        </TableCell>
                      </TableRow>
                    ) : (
                      upcoming.map((u, i) => (
                        <TableRow key={`${u.kind}-${u.date}-${i}`} data-testid={`forecast-row-${i}`}>
                          <TableCell className="whitespace-nowrap tabular-nums">
                            {melDateTime(u.date)}
                          </TableCell>
                          <TableCell>
                            <span
                              className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                              style={
                                u.kind === "DS"
                                  ? { background: "hsl(160 84% 39% / 0.12)", color: "hsl(160 84% 32%)" }
                                  : { background: "hsl(217 91% 60% / 0.12)", color: "hsl(217 91% 50%)" }
                              }
                            >
                              {u.kind === "DS" ? "Discovery" : "Acquisition"}
                            </span>
                          </TableCell>
                          <TableCell className="font-medium">{u.client}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </Card>
          </Section>

          <p className="text-xs text-muted-foreground">
            Counts unique booked meetings scheduled to be held this month, by
            scheduled start time (AEST). "Still to come" is from now to month end;
            "full month total" adds sessions already held earlier this month.
          </p>
        </>
      )}
    </div>
  );
}
