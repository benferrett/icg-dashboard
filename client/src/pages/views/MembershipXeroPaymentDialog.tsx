import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { membershipApi } from "@/lib/membership-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

export interface XeroReceipt {
  source: "payment" | "bank_transaction";
  id: string;
  date: string;
  amount: number;
  currency?: string;
  contactName: string;
  reference: string;
  invoiceNumber?: string | null;
  isReconciled?: boolean;
}
export interface SavedPaymentLink {
  id: number;
  tenantId: string;
  tenantName: string | null;
  payment: XeroReceipt;
  appliedAmount: number;
  linkedAt: number;
  linkedBy: string;
  verified: boolean | null;
}
interface ReceiptOption extends XeroReceipt {
  linkedDealId: string | null;
  matchesThisMember: boolean;
  matchesOtherMember: boolean;
}
interface ReceiptResponse {
  tenantId: string;
  tenantName: string;
  balance: number;
  remainingToLink: number;
  payments: ReceiptOption[];
}
const aud = (n: number) => n.toLocaleString("en-AU", {style:"currency",currency:"AUD"});

export function MembershipXeroPaymentDialog({ token, member, onClose, onLinked }: {
  token: string;
  member: {dealId:string; clientNames:string; sentAt:number};
  onClose: () => void;
  onLinked: () => void;
}) {
  const api = membershipApi(token);
  const [since,setSince] = useState(() => new Date(Math.min(member.sentAt-30*86400000,Date.now()-90*86400000)).toISOString().slice(0,10));
  const [until,setUntil] = useState(() => new Date().toISOString().slice(0,10));
  const [search,setSearch] = useState("");
  const [selected,setSelected] = useState<ReceiptOption | null>(null);
  const [confirmed,setConfirmed] = useState(false);
  const receipts = useQuery<ReceiptResponse>({
    queryKey:["membership-xero-receipts",member.dealId,since,until],
    queryFn:async () => (await api("POST","/api/membership-payment-followup/xero-payments",{dealId:member.dealId,since,until})).json(),
    enabled:!!since && !!until,
    retry:false,
  });
  const options = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (receipts.data?.payments ?? []).filter(p =>
      !q || `${p.contactName} ${p.reference} ${p.invoiceNumber ?? ""} ${p.amount} ${p.id}`.toLowerCase().includes(q));
  },[receipts.data,search]);
  const apply = Math.min(selected?.amount ?? 0,receipts.data?.remainingToLink ?? 0);
  const remaining = Math.max(0,Math.round(((receipts.data?.remainingToLink ?? 0)-apply)*100)/100);
  const mutation = useMutation({
    mutationFn:async () => {
      if (!selected || !receipts.data || !confirmed) throw new Error("Choose and confirm a receipt first");
      return (await api("POST","/api/membership-payment-followup/link-xero-payment", {
        dealId:member.dealId,tenantId:receipts.data.tenantId,
        source:selected.source,paymentId:selected.id,confirmed:true,
        expectedReceiptAmount:selected.amount,expectedAppliedAmount:apply,
      })).json();
    },
    onSuccess:onLinked,
  });
  function changeDates(field:"since"|"until", value:string) {
    setSelected(null);setConfirmed(false);
    field === "since" ? setSince(value) : setUntil(value);
  }
  return (
    <Dialog open onOpenChange={open => { if (!open && !mutation.isPending) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[92dvh] flex flex-col" data-testid="dialog-link-xero">
        <DialogHeader>
          <DialogTitle>Link Xero payment</DialogTitle>
          <DialogDescription>
            Select the receipt for {member.clientNames}. This updates the dashboard only; it does not create or change transactions in Xero.
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label htmlFor="xero-since">From</Label><Input id="xero-since" type="date" value={since} disabled={mutation.isPending} onChange={e=>changeDates("since",e.target.value)} /></div>
            <div className="space-y-1"><Label htmlFor="xero-until">To</Label><Input id="xero-until" type="date" value={until} disabled={mutation.isPending} onChange={e=>changeDates("until",e.target.value)} /></div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="xero-search">Search receipts</Label>
            <div className="relative">
              <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
              <Input id="xero-search" className="pl-9" placeholder="Name, reference, invoice or amount" value={search} onChange={e=>setSearch(e.target.value)} />
            </div>
          </div>
          <Button size="sm" variant="outline" disabled={receipts.isFetching || mutation.isPending}
            onClick={()=>{setSelected(null);setConfirmed(false);mutation.reset();receipts.refetch();}}>
            Refresh Xero receipts
          </Button>
          {receipts.isFetching && <p className="text-sm flex gap-2"><Loader2 className="size-4 animate-spin" />Reading Xero receipts…</p>}
          {receipts.error && <div role="alert" className="text-sm text-destructive">{receipts.error.message}<Button variant="outline" size="sm" className="ml-2" onClick={()=>receipts.refetch()}>Retry</Button></div>}
          {receipts.data && (
            <>
              <p className="text-xs text-muted-foreground">
                {receipts.data.tenantName} · {aud(receipts.data.remainingToLink)} left to link.
                Authorised invoice payments and recorded receive-money transactions only, not raw bank-feed lines.
              </p>
              <div className="space-y-2 max-h-64 overflow-y-auto" role="radiogroup" aria-label="Xero receipts">
                {options.map(p => {
                  const key = `${p.source}:${p.id}`;
                  const disabled = !!p.linkedDealId || p.matchesOtherMember || (!!p.currency && p.currency !== "AUD");
                  const checked = selected?.id === p.id && selected?.source === p.source;
                  return (
                    <button type="button" key={key} role="radio" aria-checked={checked} disabled={disabled || mutation.isPending}
                      data-testid={`xero-receipt-${p.id}`}
                      onClick={()=>{setSelected(p);setConfirmed(false);}}
                      className={`w-full text-left rounded-md border p-3 space-y-1 disabled:opacity-50 ${checked ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}>
                      <div className="flex justify-between gap-3 text-sm font-medium"><span className="break-words min-w-0">{p.contactName || "No contact name"}</span><span className="shrink-0">{p.currency || "Currency unverified"} {p.amount.toLocaleString("en-AU",{minimumFractionDigits:2})}</span></div>
                      <p className="text-xs break-words">{p.date} · {p.reference || "No reference"}{p.invoiceNumber ? ` · ${p.invoiceNumber}` : ""}</p>
                      <p className="text-xs text-muted-foreground">{p.source === "payment" ? "Invoice payment" : "Receive money"} · {p.isReconciled ? "Bank-reconciled" : "Not bank-reconciled"}
                        {p.linkedDealId ? " · Already linked" : p.matchesOtherMember ? " · Matches another member" : p.matchesThisMember ? " · Name and full amount match" : ""}
                      </p>
                    </button>
                  );
                })}
                {!options.length && !receipts.isFetching && <p className="text-sm text-muted-foreground p-3">No matching receipts in this date range. Try a different reference or wider dates.</p>}
              </div>
            </>
          )}
          {selected && (
            <div className="rounded-md border p-4 space-y-3 bg-muted/30" data-testid="xero-link-confirmation">
              <p className="text-sm"><strong>{member.clientNames}</strong>: apply <strong>{aud(apply)}</strong> from the {selected.date} receipt.</p>
              <p className="text-sm">{remaining === 0 ? "This covers the balance and will mark the membership paid." : `${aud(remaining)} will remain outstanding. The membership will not be marked fully paid.`}</p>
              {selected.amount > apply && <p className="text-xs text-amber-700 dark:text-amber-400">{aud(selected.amount-apply)} exceeds this balance and is not applied here. This receipt cannot be reused for another member.</p>}
              {!selected.isReconciled && <p className="text-xs text-amber-700 dark:text-amber-400">This is recorded in Xero but is not bank-reconciled. Check that the money has actually arrived before confirming.</p>}
              <Label className="flex items-start gap-2 text-sm font-normal">
                <input type="checkbox" className="mt-1" checked={confirmed} disabled={mutation.isPending} onChange={e=>setConfirmed(e.target.checked)} data-testid="confirm-xero-receipt" />
                I have checked that this receipt belongs to {member.clientNames} and covers the amount shown.
              </Label>
            </div>
          )}
          {mutation.error && <p role="alert" className="text-sm text-destructive">{mutation.error.message}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button data-testid="button-confirm-xero-link" onClick={()=>mutation.mutate()} disabled={!selected || !confirmed || apply<=0 || mutation.isPending || receipts.isFetching || !!receipts.error}>
            {mutation.isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
            {remaining === 0 ? "Link payment and mark paid" : "Link part payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
