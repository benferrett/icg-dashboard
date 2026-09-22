/**
 * Membership Balance Due — the approval worklist.
 *
 * Lists every member whose property has gone unconditional and whose
 * membership balance is therefore payable. Nothing sends without a human
 * reading the actual email first: the Send button is only reachable from
 * inside the preview dialog, and it names the recipient explicitly.
 *
 * The page is deliberately unhelpful about clients it cannot price or address
 * correctly. A blocked row shows why it is blocked and offers no Send button,
 * because the failure mode here is a wrong number in a payment demand.
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Eye,
  Loader2,
  Mail,
  RefreshCcw,
  Send,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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

interface AlreadySent {
  sentAt: number;
  sentBy: string;
  recipientEmail: string;
  balance: number;
}

interface Candidate {
  dealId: string;
  clientNames: string;
  firstNames: string;
  recipientEmail: string;
  ccEmails: string[];
  tier: string;
  balance: number | null;
  joiningFeePaid: number;
  propertyDescription: string;
  unconditionalDate: string;
  daysSinceUnconditional: number;
  strategistName: string;
  strategistEmail: string | null;
  leadSource: "EMBR" | "Meta" | "Other";
  warnings: string[];
  blockers: string[];
  sendable: boolean;
  alreadySent: AlreadySent | null;
}

interface CandidatesResponse {
  scanned: number;
  failed: number;
  generatedAt: string;
  candidates: Candidate[];
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

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * The balance is payable from the day the property goes unconditional, so the
 * only useful status is how long this member has been waiting for the invoice.
 * Anything beyond a fortnight is flagged, because by then they may have paid.
 */
function agingLabel(daysSince: number): { text: string; late: boolean } {
  if (daysSince <= 0) return { text: "Unconditional today", late: false };
  const text = `${daysSince} day${daysSince === 1 ? "" : "s"} ago`;
  return { text, late: daysSince > 14 };
}

function LeadSourceBadge({ source }: { source: Candidate["leadSource"] }) {
  return (
    <span
      className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border"
      style={{ borderColor: `${GOLD}66`, color: GOLD }}
      data-testid={`badge-lead-source-${source}`}
    >
      {source}
    </span>
  );
}

export default function MembershipBalanceView({ token }: { token: string }) {
  const apiRequest = membershipApi(token);
  const { toast } = useToast();
  const [previewFor, setPreviewFor] = useState<Candidate | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [confirmResend, setConfirmResend] = useState<string | null>(null);

  const { data, isLoading, isFetching, error, refetch } = useQuery<CandidatesResponse>({
    queryKey: ["/api/membership-balance-email/candidates"],
    queryFn: () => apiGet("/api/membership-balance-email/candidates", token),
  });

  const sendMutation = useMutation({
    mutationFn: async (vars: { candidate: Candidate; force: boolean }) => {
      const c = vars.candidate;
      const res = await apiRequest("POST", "/api/membership-balance-email/send", {
        dealId: c.dealId,
        to: c.recipientEmail,
        cc: c.ccEmails,
        firstNames: c.firstNames,
        clientNames: c.clientNames,
        tier: c.tier,
        balance: c.balance,
        joiningFeePaid: c.joiningFeePaid,
        unconditionalDate: c.unconditionalDate,
        propertyDescription: c.propertyDescription,
        strategistName: c.strategistName,
        strategistEmail: c.strategistEmail ?? undefined,
        force: vars.force,
      });
      return (await res.json()) as { success: boolean; messageId?: string };
    },
    onSuccess: (_result, vars) => {
      toast({
        title: "Balance email sent",
        description: `${vars.candidate.clientNames} — ${vars.candidate.recipientEmail}`,
      });
      setPreviewFor(null);
      setPreview(null);
      setConfirmResend(null);
      queryClient.invalidateQueries({ queryKey: ["/api/membership-balance-email/candidates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/membership-payment-followup/candidates"] });
    },
    onError: (err: Error) => {
      // The 409 duplicate guard arrives here; its message already explains
      // when the earlier email went and who approved it.
      toast({
        title: "Not sent",
        description: err.message.replace(/^\d+:\s*/, ""),
        variant: "destructive",
      });
    },
  });

  async function openPreview(candidate: Candidate) {
    setPreviewFor(candidate);
    setPreview(null);
    setPreviewLoading(true);
    try {
      const res = await apiRequest("POST", "/api/membership-balance-email/preview", {
        to: candidate.recipientEmail,
        cc: candidate.ccEmails,
        firstNames: candidate.firstNames,
        clientNames: candidate.clientNames,
        tier: candidate.tier,
        balance: candidate.balance,
        joiningFeePaid: candidate.joiningFeePaid,
        unconditionalDate: candidate.unconditionalDate,
        propertyDescription: candidate.propertyDescription,
        strategistName: candidate.strategistName,
        strategistEmail: candidate.strategistEmail ?? undefined,
      });
      setPreview((await res.json()) as PreviewResponse);
    } catch (err) {
      toast({
        title: "Could not build the preview",
        description: (err as Error).message.replace(/^\d+:\s*/, ""),
        variant: "destructive",
      });
      setPreviewFor(null);
    } finally {
      setPreviewLoading(false);
    }
  }

  const candidates = data?.candidates ?? [];
  const actionable = candidates.filter((c) => c.sendable && !c.alreadySent);
  const sent = candidates.filter((c) => c.alreadySent);
  const blocked = candidates.filter((c) => !c.sendable && !c.alreadySent);

  return (
    <div className="py-4 w-full max-w-4xl space-y-6">
      {/* ===== Header ===== */}
      <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <Mail className="size-6" style={{ color: GOLD }} />
            Membership Balance Due
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Members whose property has gone unconditional. The balance is payable from that day,
            so the invoice goes out the same day. Nothing sends until you read the email and press
            Send.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          data-testid="button-refresh-candidates"
        >
          {isFetching ? (
            <Loader2 className="size-3.5 mr-1.5 animate-spin" />
          ) : (
            <RefreshCcw className="size-3.5 mr-1.5" />
          )}
          Refresh
        </Button>
      </div>

      {/* ===== Loading / error / empty ===== */}
      {isLoading && (
        <div className="space-y-3" data-testid="loading-candidates">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      )}

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="pt-6">
            <p className="text-sm text-destructive" data-testid="text-candidates-error">
              Could not load balances: {(error as Error).message.replace(/^\d+:\s*/, "")}
            </p>
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && candidates.length === 0 && (
        <Card>
          <CardContent className="pt-6 text-center">
            <Users className="size-8 mx-auto mb-2 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground" data-testid="text-no-candidates">
              No properties have gone unconditional yet, so no membership balances are due.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ===== Ready to send ===== */}
      {actionable.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Awaiting approval ({actionable.length})
          </h2>
          {actionable.map((c) => (
            <CandidateCard
              key={c.dealId}
              candidate={c}
              onPreview={() => openPreview(c)}
              busy={previewLoading && previewFor?.dealId === c.dealId}
            />
          ))}
        </section>
      )}

      {/* ===== Blocked ===== */}
      {blocked.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Cannot send yet ({blocked.length})
          </h2>
          {blocked.map((c) => (
            <CandidateCard key={c.dealId} candidate={c} />
          ))}
        </section>
      )}

      {/* ===== Already sent ===== */}
      {sent.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Already sent ({sent.length})
          </h2>
          {sent.map((c) => (
            <CandidateCard
              key={c.dealId}
              candidate={c}
              onPreview={c.sendable ? () => openPreview(c) : undefined}
              busy={previewLoading && previewFor?.dealId === c.dealId}
            />
          ))}
        </section>
      )}

      {data && (
        <p className="text-[11px] text-muted-foreground pt-2" data-testid="text-scan-summary">
          Scanned {data.scanned} unconditional {data.scanned === 1 ? "deal" : "deals"}
          {data.failed > 0 && ` · ${data.failed} could not be read from HubSpot`} · as at{" "}
          {new Date(data.generatedAt).toLocaleTimeString("en-AU")}
        </p>
      )}

      {/* ===== Preview + send dialog ===== */}
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
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col" data-testid="dialog-preview">
          <DialogHeader>
            <DialogTitle>{previewFor?.clientNames}</DialogTitle>
            <DialogDescription>
              This is the email exactly as the member will receive it. Read it before sending.
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
                  <strong data-testid="text-preview-to">{preview.to}</strong>
                </p>
                <p>
                  <span className="text-muted-foreground">CC </span>
                  {preview.cc.length > 0 ? (
                    preview.cc.join(", ")
                  ) : (
                    <span className="text-amber-600 dark:text-amber-500">
                      nobody — the strategist will not see this
                    </span>
                  )}
                </p>
                <p>
                  <span className="text-muted-foreground">Subject </span>
                  {preview.subject}
                </p>
                <p>
                  <span className="text-muted-foreground">Payment reference </span>
                  {preview.paymentReference}
                </p>
              </div>

              {previewFor && previewFor.warnings.length > 0 && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 space-y-1">
                  {previewFor.warnings.map((w, i) => (
                    <p
                      key={i}
                      className="text-xs text-amber-700 dark:text-amber-500 flex gap-1.5"
                      data-testid={`text-dialog-warning-${i}`}
                    >
                      <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
                      <span>{w}</span>
                    </p>
                  ))}
                </div>
              )}

              {previewFor?.alreadySent && (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
                  <p className="text-xs text-destructive" data-testid="text-dialog-already-sent">
                    A balance email already went to {previewFor.alreadySent.recipientEmail} on{" "}
                    {formatDate(new Date(previewFor.alreadySent.sentAt).toISOString())}
                    {previewFor.alreadySent.sentBy && ` by ${previewFor.alreadySent.sentBy}`}.
                    Sending again will demand the money a second time.
                  </p>
                </div>
              )}

              <iframe
                title="Email preview"
                srcDoc={preview.html}
                className="flex-1 min-h-[320px] w-full rounded-md border bg-white"
                sandbox=""
                data-testid="iframe-email-preview"
              />
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setPreviewFor(null);
                setPreview(null);
                setConfirmResend(null);
              }}
              data-testid="button-cancel-send"
            >
              Cancel
            </Button>
            {previewFor?.alreadySent && confirmResend !== previewFor.dealId ? (
              <Button
                variant="destructive"
                onClick={() => setConfirmResend(previewFor.dealId)}
                disabled={!preview}
                data-testid="button-arm-resend"
              >
                Send again anyway…
              </Button>
            ) : (
              <Button
                onClick={() =>
                  previewFor &&
                  sendMutation.mutate({
                    candidate: previewFor,
                    force: previewFor.alreadySent !== null,
                  })
                }
                disabled={!preview || sendMutation.isPending}
                style={{ backgroundColor: GOLD, color: "white" }}
                data-testid="button-confirm-send"
              >
                {sendMutation.isPending ? (
                  <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Send className="size-3.5 mr-1.5" />
                )}
                {previewFor?.alreadySent ? "Confirm re-send" : `Send to ${preview?.to ?? "member"}`}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CandidateCard({
  candidate: c,
  onPreview,
  busy,
}: {
  candidate: Candidate;
  onPreview?: () => void;
  busy?: boolean;
}) {
  const aging = agingLabel(c.daysSinceUnconditional);
  const agingColour = aging.late ? "text-amber-700 dark:text-amber-500" : "text-muted-foreground";

  return (
    <Card data-testid={`card-candidate-${c.dealId}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base flex items-center gap-2 flex-wrap">
              <span data-testid={`text-client-${c.dealId}`}>{c.clientNames}</span>
              <LeadSourceBadge source={c.leadSource} />
              {c.alreadySent && (
                <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-green-600/15 text-green-700 dark:text-green-400 flex items-center gap-1">
                  <CheckCircle2 className="size-3" />
                  Sent
                </span>
              )}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1" data-testid={`text-property-${c.dealId}`}>
              {c.propertyDescription}
            </p>
          </div>
          <div className="text-right shrink-0">
            {c.balance !== null ? (
              <p className="text-lg font-semibold tabular-nums" data-testid={`text-balance-${c.dealId}`}>
                {formatAud(c.balance)}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Balance unknown</p>
            )}
            <p className={`text-xs ${agingColour}`} data-testid={`text-aging-${c.dealId}`}>
              {aging.text}
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 pt-0">
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-xs">
          <div>
            <dt className="text-muted-foreground">Tier</dt>
            <dd>{c.tier || "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Joining fee paid</dt>
            <dd>{formatAud(c.joiningFeePaid)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Unconditional</dt>
            <dd>{formatDate(c.unconditionalDate)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Status</dt>
            <dd>Now due</dd>
          </div>
          {/* Addresses wrap rather than truncate: the approver has to be able
              to read exactly who receives this, and ICG addresses are long
              enough that an ellipsis would hide the distinguishing part. */}
          <div className="col-span-2">
            <dt className="text-muted-foreground">Member</dt>
            <dd className="break-all">{c.recipientEmail || "no email address"}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-muted-foreground">Strategist (CC'd)</dt>
            <dd className="break-all">
              {c.strategistName}
              {c.strategistEmail ? ` · ${c.strategistEmail}` : " · no address mapped"}
            </dd>
          </div>
        </dl>

        {c.blockers.length > 0 && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2.5 space-y-1">
            {c.blockers.map((b, i) => (
              <p
                key={i}
                className="text-xs text-destructive flex gap-1.5"
                data-testid={`text-blocker-${c.dealId}-${i}`}
              >
                <Ban className="size-3.5 shrink-0 mt-0.5" />
                <span>{b}</span>
              </p>
            ))}
          </div>
        )}

        {c.warnings.length > 0 && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5 space-y-1">
            {c.warnings.map((w, i) => (
              <p
                key={i}
                className="text-xs text-amber-700 dark:text-amber-500 flex gap-1.5"
                data-testid={`text-warning-${c.dealId}-${i}`}
              >
                <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
                <span>{w}</span>
              </p>
            ))}
          </div>
        )}

        {c.alreadySent && (
          <p className="text-xs text-muted-foreground" data-testid={`text-sent-${c.dealId}`}>
            Sent {formatDate(new Date(c.alreadySent.sentAt).toISOString())}
            {c.alreadySent.sentBy && ` by ${c.alreadySent.sentBy}`} to{" "}
            {c.alreadySent.recipientEmail}
          </p>
        )}

        {onPreview && (
          <div className="flex justify-end">
            <Button
              size="sm"
              variant={c.alreadySent ? "outline" : "default"}
              onClick={onPreview}
              disabled={busy}
              style={c.alreadySent ? undefined : { backgroundColor: GOLD, color: "white" }}
              data-testid={`button-review-${c.dealId}`}
            >
              {busy ? (
                <Loader2 className="size-3.5 mr-1.5 animate-spin" />
              ) : (
                <Eye className="size-3.5 mr-1.5" />
              )}
              {c.alreadySent ? "View email" : "Review & send"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
