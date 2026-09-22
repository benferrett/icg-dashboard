/**
 * Membership Payment Follow-Up — the chase worklist.
 *
 * Shows every member we've sent a balance email to, split into three sections:
 *
 *   1. Ready to chase   — sent 7+ days ago and no payment matched in Xero.
 *   2. Awaiting payment — sent recently, still within the chase window.
 *   3. Paid             — matching Xero payment landed since the send.
 *
 * The "paid" signal comes from Xero via a server-side reconciliation. The page
 * shows a Xero-connection panel at the top when Xero has not been set up, or
 * when reconciliation was skipped for a request — the whole point is that
 * "still owing" is TRUSTWORTHY, so we make it obvious when it isn't.
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Eye,
  Link as LinkIcon,
  Loader2,
  Mail,
  Plus,
  RefreshCcw,
  Send,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { membershipApi, apiGet } from "@/lib/membership-api";

const GOLD = "#A8966B";

type FollowupStatus = "paid" | "ready-to-chase" | "awaiting";

interface FollowupMatch {
  paymentId: string;
  source: "payment" | "bank_transaction";
  date: string;
  amount: number;
  reference: string;
  reasons: string[];
}

interface FollowupCandidate {
  dealId: string;
  clientNames: string;
  recipientEmail: string;
  ccEmails: string[];
  tier: string;
  balance: number;
  sentAt: number;
  daysSinceSend: number;
  status: FollowupStatus;
  match: FollowupMatch | null;
  manualPaidAt: number | null;
  manualPaidBy: string | null;
  lastFollowupAt: number | null;
}

interface FollowupResponse {
  candidates: FollowupCandidate[];
  reconciledWithXero: boolean;
  xeroConnected: boolean;
  chaseAfterDays: number;
  generatedAt: string;
}

interface XeroStatus {
  connected: boolean;
  tenantName: string | null;
  connectedAt: number | null;
}

interface PreviewResponse {
  to: string;
  cc: string[];
  subject: string;
  html: string;
  from: string;
  replyTo: string;
  paymentReference: string;
}

function formatAud(amount: number): string {
  return `$${amount.toLocaleString("en-AU")}`;
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatDateIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

export default function MembershipFollowupView({ token }: { token: string }) {
  const apiRequest = membershipApi(token);
  const { toast } = useToast();
  const [previewFor, setPreviewFor] = useState<FollowupCandidate | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [confirmResend, setConfirmResend] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const emptyAddForm = {
    dealId: "",
    clientNames: "",
    recipientEmail: "",
    ccEmails: "",
    tier: "Standard",
    balance: "6000",
    originalSentAtIso: new Date().toISOString().slice(0, 10),
  };
  const [addForm, setAddForm] = useState(emptyAddForm);

  const { data, isLoading, isFetching, error, refetch } = useQuery<FollowupResponse>({
    queryKey: ["/api/membership-payment-followup/candidates"],
    queryFn: () => apiGet("/api/membership-payment-followup/candidates", token),
  });

  const xeroStatus = useQuery<XeroStatus>({
    queryKey: ["/api/membership-xero/status"],
    queryFn: () => apiGet("/api/membership-xero/status", token),
  });

  const markPaidMutation = useMutation({
    mutationFn: async (dealId: string) => {
      const res = await apiRequest("POST", "/api/membership-payment-followup/mark-paid", { dealId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/membership-payment-followup/candidates"] });
      toast({ title: "Marked as paid" });
    },
    onError: (err) => {
      toast({ title: "Could not mark paid", description: (err as Error).message, variant: "destructive" });
    },
  });

  const addMissingMutation = useMutation({
    mutationFn: async (form: typeof emptyAddForm) => {
      const ccList = form.ccEmails
        .split(/[,;\s]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const balance = Number(form.balance);
      if (!Number.isFinite(balance) || balance <= 0) throw new Error("Balance must be a positive number");
      const res = await apiRequest("POST", "/api/membership-payment-followup/manual-add", {
        dealId: form.dealId,
        clientNames: form.clientNames,
        recipientEmail: form.recipientEmail,
        ccEmails: ccList,
        tier: form.tier,
        balance,
        originalSentAtIso: form.originalSentAtIso,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/membership-payment-followup/candidates"] });
      toast({ title: "Client added to follow-up list" });
      setAddOpen(false);
      setAddForm(emptyAddForm);
    },
    onError: (err) => {
      toast({ title: "Could not add client", description: (err as Error).message, variant: "destructive" });
    },
  });

  const undoPaidMutation = useMutation({
    mutationFn: async (dealId: string) => {
      const res = await apiRequest("POST", "/api/membership-payment-followup/undo-paid", { dealId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/membership-payment-followup/candidates"] });
      toast({ title: "Reverted to unpaid" });
    },
    onError: (err) => {
      toast({ title: "Could not undo", description: (err as Error).message, variant: "destructive" });
    },
  });

  const sendMutation = useMutation({
    mutationFn: async (candidate: FollowupCandidate) => {
      const res = await apiRequest("POST", "/api/membership-payment-followup/send", {
        dealId: candidate.dealId,
        to: candidate.recipientEmail,
        cc: candidate.ccEmails,
        // firstNames isn't in the follow-up snapshot, so use the first token
        // of clientNames — same rule the balance email uses at fallback time.
        firstNames: candidate.clientNames.split(/\s+/)[0] || "there",
        clientNames: candidate.clientNames,
        tier: candidate.tier,
        balance: candidate.balance,
        originalSentAt: candidate.sentAt,
        strategistName: (candidate.ccEmails[0] ?? "your strategist").split("@")[0],
      });
      return res.json();
    },
    onSuccess: (_body, candidate) => {
      toast({
        title: "Follow-up sent",
        description: `${candidate.clientNames} — ${candidate.recipientEmail}`,
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/membership-payment-followup/candidates"],
      });
      setPreviewFor(null);
      setPreview(null);
      setConfirmResend(null);
    },
    onError: (err) => {
      toast({
        title: "Send failed",
        description: (err as Error).message,
        variant: "destructive",
      });
    },
  });

  async function openPreview(candidate: FollowupCandidate) {
    setPreviewFor(candidate);
    setPreview(null);
    setPreviewLoading(true);
    try {
      const res = await apiRequest("POST", "/api/membership-payment-followup/preview", {
        dealId: candidate.dealId,
        to: candidate.recipientEmail,
        cc: candidate.ccEmails,
        firstNames: candidate.clientNames.split(/\s+/)[0] || "there",
        clientNames: candidate.clientNames,
        tier: candidate.tier,
        balance: candidate.balance,
        originalSentAt: candidate.sentAt,
        strategistName: (candidate.ccEmails[0] ?? "your strategist").split("@")[0],
      });
      const body = (await res.json()) as PreviewResponse;
      setPreview(body);
    } catch (err) {
      toast({
        title: "Could not build preview",
        description: (err as Error).message,
        variant: "destructive",
      });
      setPreviewFor(null);
    } finally {
      setPreviewLoading(false);
    }
  }

  const candidates = data?.candidates ?? [];
  const readyToChase = candidates.filter((c) => c.status === "ready-to-chase");
  const awaiting = candidates.filter((c) => c.status === "awaiting");
  const paid = candidates.filter((c) => c.status === "paid");

  const showXeroBanner =
    !xeroStatus.isLoading &&
    (!xeroStatus.data?.connected ||
      (data && !data.reconciledWithXero));

  return (
    <div className="py-4 w-full max-w-4xl space-y-6">
      <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <Mail className="size-6" style={{ color: GOLD }} />
            Membership Payment Follow-Up
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Every member sent a balance email, matched against Xero payments. Chase reminders open
            for review {data ? `after ${data.chaseAfterDays} days` : "after a week"} without a
            matching payment. Nothing sends until you press Send.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAddOpen(true)}
            data-testid="button-add-missing-client"
          >
            <Plus className="size-3.5 mr-1.5" />
            Add missing client
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-refresh-followup"
          >
            {isFetching ? (
              <Loader2 className="size-3.5 mr-1.5 animate-spin" />
            ) : (
              <RefreshCcw className="size-3.5 mr-1.5" />
            )}
            Refresh
          </Button>
        </div>
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add missing client</DialogTitle>
            <DialogDescription>
              Add a client whose original balance email went out through another channel (HubSpot
              workflow, direct email, or before this tool existed). They'll appear on the chase
              list based on the original send date you enter.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="add-client-names">Client name(s)</Label>
              <Input
                id="add-client-names"
                data-testid="input-add-client-names"
                value={addForm.clientNames}
                onChange={(e) => setAddForm({ ...addForm, clientNames: e.target.value })}
                placeholder="Abdul Mansur"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="add-email">Recipient email</Label>
              <Input
                id="add-email"
                type="email"
                data-testid="input-add-email"
                value={addForm.recipientEmail}
                onChange={(e) => setAddForm({ ...addForm, recipientEmail: e.target.value })}
                placeholder="client@example.com"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="add-cc">CC emails (optional, comma-separated)</Label>
              <Input
                id="add-cc"
                data-testid="input-add-cc"
                value={addForm.ccEmails}
                onChange={(e) => setAddForm({ ...addForm, ccEmails: e.target.value })}
                placeholder="strategist@innercirclegroup.com.au"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="add-tier">Tier</Label>
                <Input
                  id="add-tier"
                  data-testid="input-add-tier"
                  value={addForm.tier}
                  onChange={(e) => setAddForm({ ...addForm, tier: e.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="add-balance">Balance (AUD)</Label>
                <Input
                  id="add-balance"
                  type="number"
                  step="0.01"
                  data-testid="input-add-balance"
                  value={addForm.balance}
                  onChange={(e) => setAddForm({ ...addForm, balance: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="add-sent">Original send date</Label>
                <Input
                  id="add-sent"
                  type="date"
                  data-testid="input-add-sent"
                  value={addForm.originalSentAtIso}
                  onChange={(e) => setAddForm({ ...addForm, originalSentAtIso: e.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="add-deal">HubSpot deal ID (optional)</Label>
                <Input
                  id="add-deal"
                  data-testid="input-add-deal"
                  value={addForm.dealId}
                  onChange={(e) => setAddForm({ ...addForm, dealId: e.target.value })}
                  placeholder="e.g. 269765670369"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const form = { ...addForm };
                if (!form.dealId.trim()) {
                  // Synthesise a stable-ish deal ID from surname+date so undo/mark-paid still work.
                  const slug = form.clientNames.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
                  form.dealId = `manual-${slug}-${form.originalSentAtIso}`;
                }
                if (!form.clientNames.trim()) {
                  toast({ title: "Client name is required", variant: "destructive" });
                  return;
                }
                if (!form.recipientEmail.trim()) {
                  toast({ title: "Recipient email is required", variant: "destructive" });
                  return;
                }
                addMissingMutation.mutate(form);
              }}
              disabled={addMissingMutation.isPending}
              data-testid="button-add-missing-submit"
            >
              {addMissingMutation.isPending ? (
                <Loader2 className="size-3.5 mr-1.5 animate-spin" />
              ) : (
                <Plus className="size-3.5 mr-1.5" />
              )}
              Add to list
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {showXeroBanner && (
        <Card className="border-amber-500/40 bg-amber-50/40 dark:bg-amber-500/10">
          <CardContent className="pt-6 space-y-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="size-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="flex-1 space-y-2">
                {!xeroStatus.data?.connected ? (
                  <>
                    <p className="text-sm font-medium">Xero is not connected.</p>
                    <p className="text-sm text-muted-foreground">
                      Until Xero is connected, every send appears as awaiting — the tool cannot
                      tell who has paid. An admin only needs to connect it once.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium">
                      Xero reconciliation was skipped for this refresh.
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Rows may show as awaiting even if the client has paid. Retry, and if it
                      keeps happening the Xero connection likely needs to be re-authorised.
                    </p>
                  </>
                )}
                <div className="flex gap-2 pt-1">
                  <Button size="sm" asChild data-testid="button-connect-xero">
                    <a href="https://propertytool.innercirclegroup.com.au/api/xero/login" target="_blank" rel="noopener noreferrer">
                      <LinkIcon className="size-3.5 mr-1.5" />
                      {xeroStatus.data?.connected ? "Reconnect Xero" : "Connect Xero"}
                    </a>
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading && (
        <div className="space-y-3" data-testid="loading-followup">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="pt-6">
            <p className="text-sm text-destructive" data-testid="text-followup-error">
              Could not load follow-ups: {(error as Error).message.replace(/^\d+:\s*/, "")}
            </p>
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && candidates.length === 0 && (
        <Card>
          <CardContent className="pt-6 text-center">
            <Users className="size-8 mx-auto mb-2 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground" data-testid="text-no-followups">
              No balance emails have been sent yet, so there's nothing to chase.
            </p>
          </CardContent>
        </Card>
      )}

      {readyToChase.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Ready to chase ({readyToChase.length})
          </h2>
          {readyToChase.map((c) => (
            <FollowupCard
              key={c.dealId}
              candidate={c}
              onPreview={() => openPreview(c)}
              onMarkPaid={() => markPaidMutation.mutate(c.dealId)}
              busy={previewLoading && previewFor?.dealId === c.dealId}
            />
          ))}
        </section>
      )}

      {awaiting.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Awaiting payment ({awaiting.length})
          </h2>
          {awaiting.map((c) => (
            <FollowupCard
              key={c.dealId}
              candidate={c}
              onMarkPaid={() => markPaidMutation.mutate(c.dealId)}
            />
          ))}
        </section>
      )}

      {paid.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Paid ({paid.length})
          </h2>
          {paid.map((c) => (
            <FollowupCard
              key={c.dealId}
              candidate={c}
              onUndoPaid={() => undoPaidMutation.mutate(c.dealId)}
            />
          ))}
        </section>
      )}

      {data && (
        <p className="text-[11px] text-muted-foreground pt-2" data-testid="text-followup-summary">
          {data.candidates.length} balance email{data.candidates.length === 1 ? "" : "s"} tracked
          {data.reconciledWithXero ? " · reconciled with Xero" : " · Xero not reconciled"} · as at{" "}
          {new Date(data.generatedAt).toLocaleTimeString("en-AU")}
        </p>
      )}

      <Dialog
        open={previewFor !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPreviewFor(null);
            setPreview(null);
            setConfirmResend(null);
          }
        }}
      >
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col" data-testid="dialog-followup-preview">
          <DialogHeader>
            <DialogTitle>{previewFor?.clientNames}</DialogTitle>
            <DialogDescription>
              This is the follow-up exactly as {previewFor?.recipientEmail || "the member"} will
              receive it. Read it before sending.
            </DialogDescription>
          </DialogHeader>

          {previewLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-5 animate-spin" style={{ color: GOLD }} />
            </div>
          )}

          {preview && (
            <div className="flex-1 min-h-0 flex flex-col gap-3">
              <div className="text-xs space-y-1 rounded-md border p-3 bg-muted/30">
                <p>
                  <span className="text-muted-foreground">From </span>
                  {preview.from}
                </p>
                <p><span className="text-muted-foreground">Reply-To </span>{preview.replyTo}</p>
                <p>
                  <span className="text-muted-foreground">To </span>
                  <strong data-testid="text-followup-preview-to">{preview.to}</strong>
                </p>
                <p>
                  <span className="text-muted-foreground">CC </span>
                  {preview.cc.length > 0 ? preview.cc.join(", ") : "—"}
                </p>
                <p>
                  <span className="text-muted-foreground">Subject </span>
                  {preview.subject}
                </p>
              </div>

              <div className="flex-1 min-h-0 overflow-auto rounded-md border">
                <iframe
                  title="Follow-up preview"
                  srcDoc={preview.html}
                  sandbox=""
                  className="w-full h-[520px] bg-white"
                />
              </div>
            </div>
          )}

          <DialogFooter className="pt-3">
            {previewFor?.lastFollowupAt && !confirmResend && (
              <p className="text-xs text-amber-600 mr-auto self-center">
                A follow-up went out {formatDate(previewFor.lastFollowupAt)}. Click Send again to
                re-send.
              </p>
            )}
            <Button
              variant="outline"
              onClick={() => {
                setPreviewFor(null);
                setPreview(null);
                setConfirmResend(null);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => previewFor && sendMutation.mutate(previewFor)}
              disabled={!preview || sendMutation.isPending}
              data-testid="button-send-followup"
            >
              {sendMutation.isPending ? (
                <Loader2 className="size-3.5 mr-1.5 animate-spin" />
              ) : (
                <Send className="size-3.5 mr-1.5" />
              )}
              Send follow-up
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FollowupCard({
  candidate,
  onPreview,
  onMarkPaid,
  onUndoPaid,
  busy,
}: {
  candidate: FollowupCandidate;
  onPreview?: () => void;
  onMarkPaid?: () => void;
  onUndoPaid?: () => void;
  busy?: boolean;
}) {
  const c = candidate;
  const isPaid = c.status === "paid";
  const isReady = c.status === "ready-to-chase";
  const isManualPaid = c.manualPaidAt !== null;

  return (
    <Card data-testid={`card-followup-${c.dealId}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base flex items-center gap-2 flex-wrap">
              <span data-testid={`text-followup-client-${c.dealId}`}>{c.clientNames}</span>
              {isPaid && (
                <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-green-600/15 text-green-700 dark:text-green-400 flex items-center gap-1">
                  <CheckCircle2 className="size-3" />
                  Paid
                </span>
              )}
              {isReady && (
                <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-400 flex items-center gap-1">
                  <Clock className="size-3" />
                  Chase due
                </span>
              )}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">{c.recipientEmail}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-lg font-semibold tabular-nums">{formatAud(c.balance)}</p>
            <p className="text-xs text-muted-foreground">{c.tier}</p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 pt-0">
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-xs">
          <div>
            <dt className="text-muted-foreground">Balance email sent</dt>
            <dd>
              {formatDate(c.sentAt)} <span className="text-muted-foreground">· {c.daysSinceSend} days ago</span>
            </dd>
          </div>
          {c.lastFollowupAt && (
            <div>
              <dt className="text-muted-foreground">Last follow-up</dt>
              <dd>{formatDate(c.lastFollowupAt)}</dd>
            </div>
          )}
          {c.match && (
            <div className="col-span-2 sm:col-span-3">
              <dt className="text-muted-foreground">Payment matched</dt>
              <dd className="text-green-700 dark:text-green-400">
                {formatAud(c.match.amount)} on {formatDateIso(c.match.date)}
                {c.match.reference ? ` · ref "${c.match.reference}"` : ""} · {c.match.reasons.join(", ")}
              </dd>
            </div>
          )}
        </dl>

        {isManualPaid && (
          <p className="text-[11px] text-muted-foreground">
            Manually marked as paid{c.manualPaidBy ? ` by ${c.manualPaidBy}` : ""}
            {c.manualPaidAt ? ` on ${formatDate(c.manualPaidAt)}` : ""}.
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          {!isPaid && onMarkPaid && (
            <Button
              size="sm"
              variant="outline"
              className="border-green-600/40 text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-950"
              onClick={onMarkPaid}
              data-testid={`button-mark-paid-${c.dealId}`}
            >
              <CheckCircle2 className="size-3.5 mr-1.5" />
              Mark as paid
            </Button>
          )}
          {isPaid && isManualPaid && onUndoPaid && (
            <Button
              size="sm"
              variant="outline"
              onClick={onUndoPaid}
              data-testid={`button-undo-paid-${c.dealId}`}
            >
              Undo paid
            </Button>
          )}
          {onPreview && !isPaid && (
            <Button size="sm" onClick={onPreview} disabled={busy} data-testid={`button-preview-followup-${c.dealId}`}>
              {busy ? (
                <Loader2 className="size-3.5 mr-1.5 animate-spin" />
              ) : (
                <Eye className="size-3.5 mr-1.5" />
              )}
              Preview follow-up
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
