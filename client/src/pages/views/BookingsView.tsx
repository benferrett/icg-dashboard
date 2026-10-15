import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { fmtNumber } from "@/lib/format";
import { attendanceLabels, type AttendanceStatus } from "@shared/attendance";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat } from "@/components/dashboard/Stat";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, XCircle, CalendarClock, HelpCircle, ExternalLink } from "lucide-react";

export interface BookingRow {
  meetingId: string;
  contactId?: string;
  dealId?: string;
  client: string;
  bookedAt: string;
  sessionAt: string;
  strategist: string | null;
  booker: string;
  status: AttendanceStatus;
  statusReason: string;
  evidenceUrl?: string;
  source: string;
  adName: string | null;
  campaignName: string | null;
  adId: string | null;
  leadCreatedAt: string | null;
  dials: number;
  connectedDials: number;
  counted: boolean;
  excludedReason?: "rebook" | "source";
  hubspotUrl?: string;
}

interface BookingsPayload {
  rows: BookingRow[];
  totals: {
    counted: number;
    all: number;
    sat: number;
    notSat: number;
    upcoming: number;
    awaiting: number;
    avgDials: number | null;
  };
  adLookup: "ok" | "unavailable";
  updating?: boolean;
}

const TZ = "Australia/Melbourne";

const SHORT_LABEL: Record<AttendanceStatus, string> = {
  sat: "Sat",
  no_show_or_reschedule: "No-show",
  cancelled: "Cancelled",
  rescheduled: "Rescheduled",
  awaiting_confirmation: "Awaiting",
  upcoming: "Upcoming",
};

function fmtShortDateTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(+d)) return "—";
  return d.toLocaleString("en-AU", { timeZone: TZ, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

function fmtDateTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(+d)) return "—";
  return d.toLocaleString("en-AU", {
    timeZone: TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtDay(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(+d)) return "—";
  return d.toLocaleDateString("en-AU", { timeZone: TZ, day: "numeric", month: "short", year: "2-digit" });
}

function SatMark({ row }: { row: BookingRow }) {
  const s = row.status;
  const label = attendanceLabels[s] || s;
  const short = SHORT_LABEL[s] || label;
  let icon;
  if (s === "sat") icon = <CheckCircle2 className="h-5 w-5 text-emerald-500" aria-label="Sat" />;
  else if (s === "no_show_or_reschedule" || s === "cancelled" || s === "rescheduled")
    icon = <XCircle className="h-5 w-5 text-red-500" aria-label={label} />;
  else if (s === "upcoming") icon = <CalendarClock className="h-5 w-5 text-sky-600" aria-label={label} />;
  else icon = <HelpCircle className="h-5 w-5 text-amber-600" aria-label={label} />;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap" title={`${label}: ${row.statusReason}`} data-testid={`sat-${row.meetingId}`}>
      {icon}
      <span className="text-xs text-muted-foreground">
        {row.evidenceUrl ? (
          <a href={row.evidenceUrl} target="_blank" rel="noreferrer" className="hover:underline">
            {short} · reviewed
          </a>
        ) : (
          short
        )}
      </span>
    </span>
  );
}

type StatusFilter = "all" | "sat" | "not_sat" | "upcoming" | "awaiting";

export function BookingsView({
  token,
  rangeQS,
  rangeKey,
}: {
  token: string;
  rangeQS: string;
  rangeKey: string;
}) {
  const q = useQuery<BookingsPayload>({
    queryKey: ["/api/bookings", rangeKey],
    queryFn: () => apiGet<BookingsPayload>(`/api/bookings?${rangeQS}`, token),
    refetchInterval: (query) => ((query.state.data as BookingsPayload | undefined)?.updating ? 4000 : false),
  });

  const [booker, setBooker] = useState("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState("");

  const rows = q.data?.rows ?? [];
  const bookers = useMemo(
    () => Array.from(new Set(rows.map((r) => r.booker))).sort((a, b) => a.localeCompare(b)),
    [rows],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (!showAll && !r.counted) return false;
      if (booker !== "all" && r.booker !== booker) return false;
      if (status === "sat" && r.status !== "sat") return false;
      if (status === "not_sat" && !["no_show_or_reschedule", "cancelled", "rescheduled"].includes(r.status)) return false;
      if (status === "upcoming" && r.status !== "upcoming") return false;
      if (status === "awaiting" && r.status !== "awaiting_confirmation") return false;
      if (term) {
        const hay = `${r.client} ${r.adName || ""} ${r.campaignName || ""} ${r.booker} ${r.strategist || ""}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [rows, showAll, booker, status, search]);

  const filteredDials = filtered.map((r) => r.dials);
  const avgFiltered = filteredDials.length
    ? filteredDials.reduce((s, d) => s + d, 0) / filteredDials.length
    : null;

  if (q.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }
  if (q.error) {
    return (
      <Card className="p-4 text-sm border-destructive/40">
        Couldn’t load bookings: {(q.error as Error).message}
      </Card>
    );
  }

  const t = q.data!.totals;
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label="DS booked" value={fmtNumber(t.counted)} sub="unique, EMBR + Meta" accent testId="stat-bookings-booked" />
        <Stat label="Sat" value={fmtNumber(t.sat)} sub="of those booked" testId="stat-bookings-sat" />
        <Stat label="Not attended" value={fmtNumber(t.notSat)} sub="no-show / cancelled" testId="stat-bookings-notsat" />
        <Stat
          label="Upcoming / awaiting"
          value={fmtNumber(t.upcoming + t.awaiting)}
          sub={`${t.upcoming} upcoming · ${t.awaiting} awaiting`}
          testId="stat-bookings-pending"
        />
        <Stat
          label="Avg dials to book"
          value={t.avgDials == null ? "—" : t.avgDials.toFixed(1)}
          sub="outbound calls before booking"
          testId="stat-bookings-dials"
        />
      </div>

      <Card className="p-3 flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search client, ad, booker…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 w-full sm:w-60"
          data-testid="input-bookings-search"
        />
        <Select value={booker} onValueChange={setBooker}>
          <SelectTrigger className="h-9 w-[180px]" data-testid="select-bookings-booker">
            <SelectValue placeholder="Booked by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All bookers</SelectItem>
            {bookers.map((b) => (
              <SelectItem key={b} value={b}>
                {b}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
          <SelectTrigger className="h-9 w-[170px]" data-testid="select-bookings-status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="sat">Sat</SelectItem>
            <SelectItem value="not_sat">Not attended</SelectItem>
            <SelectItem value="upcoming">Upcoming</SelectItem>
            <SelectItem value="awaiting">Awaiting confirmation</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={showAll} onCheckedChange={setShowAll} data-testid="switch-bookings-all" />
          Include rebooks &amp; other sources ({fmtNumber(t.all - t.counted)})
        </label>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {fmtNumber(filtered.length)} shown
          {avgFiltered != null && ` · ${avgFiltered.toFixed(1)} avg dials`}
        </span>
      </Card>

      {q.data!.adLookup === "unavailable" && (
        <Card className="p-3 text-xs border-amber-500/40 text-amber-700 dark:text-amber-400">
          Meta ad names couldn’t be loaded (token issue) — showing tracking labels instead.
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left font-medium px-3 py-2">Client</th>
                <th className="text-left font-medium px-3 py-2 whitespace-nowrap">Booked for</th>
                <th className="text-left font-medium px-3 py-2">Sat</th>
                <th className="text-left font-medium px-3 py-2 whitespace-nowrap">Booked by</th>
                <th className="text-left font-medium px-3 py-2">Ad / source</th>
                <th className="text-left font-medium px-3 py-2 whitespace-nowrap">Lead created</th>
                <th className="text-right font-medium px-3 py-2 whitespace-nowrap">Dials to book</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">
                    No bookings match this period and filter.
                  </td>
                </tr>
              )}
              {filtered.map((r) => (
                <tr
                  key={r.meetingId}
                  className={`border-t align-top ${r.counted ? "" : "opacity-60"}`}
                  data-testid={`row-booking-${r.meetingId}`}
                >
                  <td className="px-3 py-2 min-w-[170px]">
                    <div className="flex items-center gap-1 font-medium whitespace-nowrap">
                      {r.hubspotUrl ? (
                        <a href={r.hubspotUrl} target="_blank" rel="noreferrer" className="hover:underline inline-flex items-center gap-1">
                          {r.client}
                          <ExternalLink className="h-3 w-3 text-muted-foreground" />
                        </a>
                      ) : (
                        r.client
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground whitespace-nowrap">
                      {r.strategist ? `with ${r.strategist}` : ""}
                      {!r.counted && (
                        <span className="ml-1 rounded bg-muted px-1.5 py-0.5">
                          {r.excludedReason === "rebook" ? "Rebook" : "Not EMBR/Meta"}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums">{fmtDateTime(r.sessionAt)}</td>
                  <td className="px-3 py-2">
                    <SatMark row={r} />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.booker === "Unattributed" ? (
                      <span className="text-muted-foreground">Unattributed</span>
                    ) : (
                      r.booker
                    )}
                    <div className="text-xs text-muted-foreground tabular-nums">on {fmtShortDateTime(r.bookedAt)}</div>
                  </td>
                  <td className="px-3 py-2 min-w-[180px] max-w-[260px]">
                    <div className="truncate" title={r.adName || undefined}>
                      {r.adName || <span className="text-muted-foreground">{r.source}</span>}
                    </div>
                    <div className="text-xs text-muted-foreground truncate" title={r.campaignName || undefined}>
                      {r.adName ? (r.campaignName ? `${r.source} · ${r.campaignName}` : r.source) : ""}
                    </div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums">{fmtDay(r.leadCreatedAt)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <span className="font-medium">{r.dials}</span>
                    {r.dials > 0 && (
                      <div className="text-xs text-muted-foreground">{r.connectedDials} connected</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-xs text-muted-foreground">
        Bookings are Discovery Sessions created in the selected period. “DS booked” matches the Overview figure: EMBR and Meta leads only, a rebook for the same
        client counts once. Sat uses the deal stage or reviewed strategist notes; a session with no CRM update shows as awaiting confirmation, not a no-show.
        Dials to book = outbound calls to the lead logged before the booking was made. Ad = the lead’s first-touch Meta ad.
      </p>
    </div>
  );
}
