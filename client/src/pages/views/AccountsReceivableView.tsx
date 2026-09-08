import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { fmtCurrency, fmtNumber } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat } from "@/components/dashboard/Stat";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowUpDown,
  Send,
  Mail,
  CheckCircle2,
  RotateCcw,
  Loader2,
} from "lucide-react";

// --- Types (mirror server/icg/ar.ts) --------------------------------------
type ArBucket =
  | "overdue"
  | "within_terms"
  | "cash_received_pending"
  | "earned_not_invoiced";

interface OpenInvoice {
  invoice_id: string;
  tenant_id: string;
  tenant_name: string;
  state: "VIC" | "QLD" | "WA";
  invoice_number: string;
  contact_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
  reference: string | null;
  date_iso: string | null;
  due_date_iso: string | null;
  amount_due: number;
  total: number;
  days_overdue: number;
  is_overdue: boolean;
  bucket: ArBucket;
  override?: {
    marked_paid_at_iso: string;
    marked_by: string | null;
    note: string | null;
  };
}

interface HeadlineTotals {
  total: number;
  buckets: Record<ArBucket, { count: number; amount: number }>;
}

interface AgedBucket {
  count: number;
  amount: number;
}
interface AgedRow {
  "0-30": AgedBucket;
  "31-60": AgedBucket;
  "61-90": AgedBucket;
  "90+": AgedBucket;
  total: AgedBucket;
}

interface ArPayload {
  invoices: OpenInvoice[];
  cleared: OpenInvoice[];
  totals: HeadlineTotals;
  aged_debtors: Record<string, AgedRow>;
  generated_at: string;
  cached?: boolean;
  cacheAgeSec?: number;
  updating?: boolean;
}

// --- Small helpers --------------------------------------------------------
function fmtAudFull(n: number): string {
  return "$" + n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDateShort(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "2-digit" });
}

// Same fetch helper as the rest of the dashboard, but with a body payload for POSTs.
async function apiPost<T>(path: string, token: string, body: unknown): Promise<T> {
  const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "x-icg-token": token, "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

// --- Bucket labels & badges ----------------------------------------------
const BUCKET_LABEL: Record<ArBucket, string> = {
  overdue: "Overdue",
  within_terms: "Within terms",
  cash_received_pending: "Cleared (pending)",
  earned_not_invoiced: "Earned, not invoiced",
};
function bucketBadge(b: ArBucket) {
  const cls: Record<ArBucket, string> = {
    overdue: "bg-red-100 text-red-700 border-red-200",
    within_terms: "bg-blue-100 text-blue-700 border-blue-200",
    cash_received_pending: "bg-emerald-100 text-emerald-700 border-emerald-200",
    earned_not_invoiced: "bg-amber-100 text-amber-700 border-amber-200",
  };
  return (
    <Badge variant="outline" className={cls[b]}>
      {BUCKET_LABEL[b]}
    </Badge>
  );
}

// --- View -----------------------------------------------------------------
type StatusFilter = "all" | "overdue" | "within_terms" | "cleared";
type SortKey =
  | "tenant"
  | "invoice_number"
  | "vendor"
  | "reference"
  | "date"
  | "due"
  | "days"
  | "amount";

const DEFAULT_CC = [
  "benferrett@innercirclegroup.com.au",
  "alinapariyar@innercirclegroup.com.au",
].join(", ");

export function AccountsReceivableView({ token }: { token: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const q = useQuery<ArPayload>({
    queryKey: ["ar-invoices"],
    queryFn: () => apiGet<ArPayload>(`/api/ar/invoices`, token),
    refetchInterval: 60_000,
  });

  const [tenantFilter, setTenantFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("amount");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Combine invoices + cleared so the UI can filter across them.
  const all = useMemo<OpenInvoice[]>(() => {
    if (!q.data) return [];
    return [...q.data.invoices, ...q.data.cleared];
  }, [q.data]);

  const filtered = useMemo(() => {
    let rows = all;
    if (tenantFilter !== "all") rows = rows.filter((r) => r.state === tenantFilter);
    if (statusFilter !== "all") {
      rows = rows.filter((r) => {
        if (statusFilter === "cleared") return r.bucket === "cash_received_pending";
        if (statusFilter === "overdue") return r.bucket === "overdue";
        if (statusFilter === "within_terms") return r.bucket === "within_terms";
        return true;
      });
    }
    const dir = sortDir === "asc" ? 1 : -1;
    const cmp = (a: OpenInvoice, b: OpenInvoice) => {
      switch (sortKey) {
        case "tenant":
          return a.state.localeCompare(b.state) * dir;
        case "invoice_number":
          return a.invoice_number.localeCompare(b.invoice_number) * dir;
        case "vendor":
          return (a.contact_name || "").localeCompare(b.contact_name || "") * dir;
        case "reference":
          return (a.reference || "").localeCompare(b.reference || "") * dir;
        case "date":
          return ((a.date_iso || "") < (b.date_iso || "") ? -1 : 1) * dir;
        case "due":
          return ((a.due_date_iso || "") < (b.due_date_iso || "") ? -1 : 1) * dir;
        case "days":
          return (a.days_overdue - b.days_overdue) * dir;
        case "amount":
          return (a.amount_due - b.amount_due) * dir;
        default:
          return 0;
      }
    };
    return [...rows].sort(cmp);
  }, [all, tenantFilter, statusFilter, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir(k === "amount" || k === "days" ? "desc" : "asc");
    }
  }

  // --- Actions -----------------------------------------------------------
  const markPaidMut = useMutation({
    mutationFn: (inv: OpenInvoice) =>
      apiPost<{ ok: true }>(`/api/ar/invoices/${inv.invoice_id}/mark-paid`, token, {
        tenant_id: inv.tenant_id,
        note: "Marked paid from dashboard",
      }),
    onSuccess: () => {
      toast({ title: "Marked as paid", description: "Invoice cleared pending Xero." });
      qc.invalidateQueries({ queryKey: ["ar-invoices"] });
    },
    onError: (e: Error) =>
      toast({ title: "Failed to mark paid", description: e.message, variant: "destructive" }),
  });

  const unmarkMut = useMutation({
    mutationFn: (inv: OpenInvoice) =>
      apiPost<{ ok: true }>(`/api/ar/invoices/${inv.invoice_id}/unmark-paid`, token, {}),
    onSuccess: () => {
      toast({ title: "Override removed", description: "Invoice is back on the follow-up list." });
      qc.invalidateQueries({ queryKey: ["ar-invoices"] });
    },
    onError: (e: Error) =>
      toast({ title: "Failed to unmark", description: e.message, variant: "destructive" }),
  });

  const weeklyMut = useMutation({
    mutationFn: () => apiPost<{ id: string; subject: string; to: string }>(`/api/ar/weekly-report/send`, token, {}),
    onSuccess: (r) =>
      toast({
        title: "Weekly summary sent",
        description: `To ${r.to} — “${r.subject}”`,
      }),
    onError: (e: Error) =>
      toast({ title: "Failed to send weekly summary", description: e.message, variant: "destructive" }),
  });

  // --- Follow-up dialog --------------------------------------------------
  const [followupOpen, setFollowupOpen] = useState(false);
  const [followupInv, setFollowupInv] = useState<OpenInvoice | null>(null);
  const [fuTo, setFuTo] = useState("");
  const [fuCc, setFuCc] = useState(DEFAULT_CC);
  const [fuSubject, setFuSubject] = useState("");
  const [fuBody, setFuBody] = useState("");

  function openFollowup(inv: OpenInvoice) {
    setFollowupInv(inv);
    setFuTo(inv.contact_email || "");
    setFuCc(DEFAULT_CC);
    // Build a minimal client-side polite reminder so the user can review before
    // sending. The server will also render a template if any field is missing,
    // but a WYSIWYG preview is friendlier for the operator.
    const propPart = inv.reference && inv.reference.trim() ? ` (${inv.reference.trim()})` : "";
    const subject = `Friendly reminder — ICG invoice ${inv.invoice_number}${propPart} — ${fmtAudFull(inv.amount_due)}`;
    const salut = (inv.contact_name || "").split(/\s+/)[0] || "there";
    const dueLabel = fmtDateShort(inv.due_date_iso);
    const opener =
      inv.is_overdue && inv.days_overdue > 0
        ? `Hi ${salut},\n\nJust a friendly follow-up on ICG invoice ${inv.invoice_number}${
            inv.reference ? ` for ${inv.reference}` : ""
          }, issued by ${inv.tenant_name} for ${fmtAudFull(inv.amount_due)}. Our records show it was due on ${dueLabel} (${inv.days_overdue} day${
            inv.days_overdue === 1 ? "" : "s"
          } ago) and is still showing as outstanding.\n\nCould you let me know when we can expect payment? If there's any query or missing paperwork, please reply to this email and I'll sort it out today.`
        : `Hi ${salut},\n\nJust a friendly heads-up on ICG invoice ${inv.invoice_number}${
            inv.reference ? ` for ${inv.reference}` : ""
          }, issued by ${inv.tenant_name} for ${fmtAudFull(inv.amount_due)}, which is due on ${dueLabel}. If there's anything you need from us to have it processed on time, please let me know.`;
    const body = `${opener}\n\nThanks so much for your help.\n\nKind regards,\nICG Accounts\nInner Circle Group\naccounts@innercirclegroup.com.au\nABN 52 690 564 786`;
    setFuSubject(subject);
    setFuBody(body);
    setFollowupOpen(true);
  }

  const sendFollowupMut = useMutation({
    mutationFn: async () => {
      if (!followupInv) throw new Error("No invoice selected");
      const html = fuBody
        .split(/\n\n+/)
        .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
        .join("\n");
      return apiPost<{ id: string; to: string; subject: string }>(
        `/api/ar/invoices/${followupInv.invoice_id}/send-followup`,
        token,
        {
          to: fuTo,
          cc: fuCc,
          subject: fuSubject,
          html,
          text: fuBody,
        },
      );
    },
    onSuccess: (r) => {
      toast({ title: "Follow-up sent", description: `To ${r.to}` });
      setFollowupOpen(false);
      qc.invalidateQueries({ queryKey: ["ar-invoices"] });
    },
    onError: (e: Error) =>
      toast({ title: "Failed to send follow-up", description: e.message, variant: "destructive" }),
  });

  // Redirect on 401 (matches the dashboard page's pattern).
  useEffect(() => {
    if ((q.error as Error | undefined)?.message === "UNAUTHORIZED") {
      // Nothing to do here — the parent DashboardPage handles the top-level
      // 401 via its own listeners. This local no-op prevents lint warnings.
    }
  }, [q.error]);

  const loading = q.isLoading;
  const totals = q.data?.totals;
  const aged = q.data?.aged_debtors || {};

  return (
    <div className="flex flex-col gap-8">
      {/* Top stat row + action button */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">
            {q.data
              ? `${fmtNumber(all.length)} invoices — ${fmtAudFull(totals?.total ?? 0)} total open`
              : "Loading Xero…"}
          </div>
          <Button
            size="sm"
            onClick={() => weeklyMut.mutate()}
            disabled={weeklyMut.isPending}
            data-testid="button-send-weekly"
          >
            {weeklyMut.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Send className="h-4 w-4 mr-1" />
            )}
            Send weekly summary now
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {loading || !totals ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-lg" />
            ))
          ) : (
            <>
              <Stat
                label="Total overdue"
                value={fmtCurrency(totals.buckets.overdue.amount)}
                sub={`${fmtNumber(totals.buckets.overdue.count)} invoices`}
                accent
                testId="stat-ar-overdue"
              />
              <Stat
                label="Within terms"
                value={fmtCurrency(totals.buckets.within_terms.amount)}
                sub={`${fmtNumber(totals.buckets.within_terms.count)} invoices`}
                testId="stat-ar-within"
              />
              <Stat
                label="Cash received (pending clearing)"
                value={fmtCurrency(totals.buckets.cash_received_pending.amount)}
                sub={`${fmtNumber(totals.buckets.cash_received_pending.count)} invoices`}
                testId="stat-ar-pending"
              />
              <Stat
                label="Earned, not invoiced"
                value={fmtCurrency(totals.buckets.earned_not_invoiced.amount)}
                sub={`${fmtNumber(totals.buckets.earned_not_invoiced.count)} deals`}
                testId="stat-ar-uninvoiced"
              />
            </>
          )}
        </div>
      </div>

      {/* Aged debtors */}
      <Card className="p-4">
        <h2 className="text-base font-semibold mb-3">Aged debtors — open state-entity AR</h2>
        {loading || !q.data ? (
          <Skeleton className="h-32" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="py-2 pr-4">State</th>
                  <th className="py-2 pr-4 text-right">0–30</th>
                  <th className="py-2 pr-4 text-right">31–60</th>
                  <th className="py-2 pr-4 text-right">61–90</th>
                  <th className="py-2 pr-4 text-right">90+</th>
                  <th className="py-2 pr-4 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {(["VIC", "QLD", "WA"] as const).map((s) => {
                  const r = aged[s];
                  return (
                    <tr key={s} className="border-t">
                      <td className="py-2 pr-4 font-medium">{s}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {r ? fmtCurrency(r["0-30"].amount) : "—"}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {r ? fmtCurrency(r["31-60"].amount) : "—"}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {r ? fmtCurrency(r["61-90"].amount) : "—"}
                      </td>
                      <td
                        className={`py-2 pr-4 text-right tabular-nums ${
                          r && r["90+"].amount > 0 ? "text-red-600 font-semibold" : ""
                        }`}
                      >
                        {r ? fmtCurrency(r["90+"].amount) : "—"}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums font-semibold">
                        {r ? fmtCurrency(r.total.amount) : "—"}
                      </td>
                    </tr>
                  );
                })}
                {aged.TOTAL && (
                  <tr className="border-t bg-muted/40">
                    <td className="py-2 pr-4 font-semibold">Total</td>
                    <td className="py-2 pr-4 text-right tabular-nums font-semibold">
                      {fmtCurrency(aged.TOTAL["0-30"].amount)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums font-semibold">
                      {fmtCurrency(aged.TOTAL["31-60"].amount)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums font-semibold">
                      {fmtCurrency(aged.TOTAL["61-90"].amount)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums font-semibold text-red-600">
                      {fmtCurrency(aged.TOTAL["90+"].amount)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums font-semibold">
                      {fmtCurrency(aged.TOTAL.total.amount)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={tenantFilter} onValueChange={setTenantFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Tenant" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All tenants</SelectItem>
            <SelectItem value="VIC">VIC</SelectItem>
            <SelectItem value="QLD">QLD</SelectItem>
            <SelectItem value="WA">WA</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1">
          {(["all", "overdue", "within_terms", "cleared"] as StatusFilter[]).map((s) => (
            <Button
              key={s}
              size="sm"
              variant={statusFilter === s ? "default" : "outline"}
              onClick={() => setStatusFilter(s)}
            >
              {s === "all"
                ? "All"
                : s === "overdue"
                  ? "Overdue"
                  : s === "within_terms"
                    ? "Within terms"
                    : "Cleared"}
            </Button>
          ))}
        </div>
      </div>

      {/* Invoice table */}
      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground uppercase tracking-wide bg-muted/30">
                {([
                  { k: "tenant", label: "Tenant" },
                  { k: "invoice_number", label: "Invoice #" },
                  { k: "vendor", label: "Vendor" },
                  { k: "reference", label: "Property / Ref" },
                  { k: "date", label: "Date" },
                  { k: "due", label: "Due" },
                  { k: "days", label: "Days" },
                  { k: "amount", label: "Amount" },
                ] as { k: SortKey; label: string }[]).map((c) => (
                  <th key={c.k} className="py-2 px-3">
                    <button
                      onClick={() => toggleSort(c.k)}
                      className="inline-flex items-center gap-1 hover:text-foreground"
                    >
                      {c.label}
                      <ArrowUpDown className="h-3 w-3 opacity-50" />
                    </button>
                  </th>
                ))}
                <th className="py-2 px-3 text-right">Status</th>
                <th className="py-2 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10} className="p-6 text-center text-muted-foreground">
                    Loading invoices…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-6 text-center text-muted-foreground">
                    No invoices match the current filters.
                  </td>
                </tr>
              ) : (
                filtered.map((inv) => (
                  <tr key={inv.invoice_id} className="border-t">
                    <td className="py-2 px-3">{inv.state}</td>
                    <td className="py-2 px-3 font-mono text-xs">{inv.invoice_number}</td>
                    <td className="py-2 px-3">{inv.contact_name || "—"}</td>
                    <td className="py-2 px-3 text-muted-foreground">{inv.reference || "—"}</td>
                    <td className="py-2 px-3 tabular-nums">{fmtDateShort(inv.date_iso)}</td>
                    <td className="py-2 px-3 tabular-nums">{fmtDateShort(inv.due_date_iso)}</td>
                    <td
                      className={`py-2 px-3 tabular-nums ${
                        inv.is_overdue ? "text-red-600 font-semibold" : "text-muted-foreground"
                      }`}
                    >
                      {inv.is_overdue ? inv.days_overdue : "—"}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums font-semibold">
                      {fmtCurrency(inv.amount_due)}
                    </td>
                    <td className="py-2 px-3 text-right">{bucketBadge(inv.bucket)}</td>
                    <td className="py-2 px-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openFollowup(inv)}
                          data-testid={`button-followup-${inv.invoice_id}`}
                        >
                          <Mail className="h-3.5 w-3.5 mr-1" />
                          Follow-up
                        </Button>
                        {inv.bucket === "cash_received_pending" ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => unmarkMut.mutate(inv)}
                            disabled={unmarkMut.isPending}
                          >
                            <RotateCcw className="h-3.5 w-3.5 mr-1" />
                            Unmark
                          </Button>
                        ) : (
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                size="sm"
                                variant="ghost"
                                data-testid={`button-markpaid-${inv.invoice_id}`}
                              >
                                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                                Mark paid
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-64">
                              <div className="text-sm mb-2">
                                Mark <strong>{inv.invoice_number}</strong> as paid?
                              </div>
                              <div className="text-xs text-muted-foreground mb-3">
                                Drops it from the follow-up list until Xero confirms.
                              </div>
                              <Button
                                size="sm"
                                className="w-full"
                                onClick={() => markPaidMut.mutate(inv)}
                                disabled={markPaidMut.isPending}
                              >
                                Yes, mark paid
                              </Button>
                            </PopoverContent>
                          </Popover>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Follow-up dialog */}
      <Dialog open={followupOpen} onOpenChange={setFollowupOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Send follow-up</DialogTitle>
            <DialogDescription>
              From accounts@innercirclegroup.com.au. Review and edit before sending.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="fu-to">To</Label>
              <Input
                id="fu-to"
                value={fuTo}
                onChange={(e) => setFuTo(e.target.value)}
                placeholder="vendor@example.com"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="fu-cc">CC</Label>
              <Input id="fu-cc" value={fuCc} onChange={(e) => setFuCc(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="fu-subject">Subject</Label>
              <Input
                id="fu-subject"
                value={fuSubject}
                onChange={(e) => setFuSubject(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="fu-body">Message</Label>
              <Textarea
                id="fu-body"
                value={fuBody}
                onChange={(e) => setFuBody(e.target.value)}
                rows={14}
                className="font-mono text-xs"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFollowupOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => sendFollowupMut.mutate()}
              disabled={sendFollowupMut.isPending || !fuTo.trim()}
            >
              {sendFollowupMut.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Send className="h-4 w-4 mr-1" />
              )}
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
