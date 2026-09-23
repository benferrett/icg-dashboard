import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { membershipApi } from "@/lib/membership-api";
import { matchesOutstandingAmount } from "@shared/membership-receipts";
import type { ArReceipt } from "@shared/ar-receipts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

const CENTRAL="55a37885-188e-40da-a8f5-90cb79f1afe1";
const aud=(n:number)=>n.toLocaleString("en-AU",{style:"currency",currency:"AUD"});
interface Option extends ArReceipt { linkedInvoice:string|null; alreadyApplied:boolean; }
interface Result { amountDue:number; tenantId:string; tenantName:string; receipts:Option[]; }
export function ArReceiptDialog({token,invoice,onClose,onLinked}:{
  token:string;
  invoice:{invoice_id:string;tenant_id:string;tenant_name:string;invoice_number:string;contact_name:string|null};
  onClose:()=>void;onLinked:()=>void;
}) {
  const api=membershipApi(token);
  const [org,setOrg]=useState(CENTRAL);
  const [since,setSince]=useState(()=>new Date(Date.now()-90*86400000).toISOString().slice(0,10));
  const [until,setUntil]=useState(()=>new Date().toISOString().slice(0,10));
  const [search,setSearch]=useState("");
  const [selected,setSelected]=useState<Option|null>(null);
  const [confirmed,setConfirmed]=useState(false);
  const q=useQuery<Result>({
    queryKey:["ar-receipts",invoice.tenant_id,invoice.invoice_id,org,since,until],
    queryFn:async()=>(await api("POST",`/api/ar/invoices/${invoice.invoice_id}/xero-receipts`,{
      tenantId:invoice.tenant_id,receiptTenantId:org,since,until,
    })).json(),retry:false,enabled:!!since&&!!until,
  });
  const options=(q.data?.receipts||[]).filter(r=>matchesOutstandingAmount(r.amount,q.data?.amountDue||0))
    .filter(r=>`${r.contactName} ${r.reference} ${r.invoiceNumber||""} ${r.id}`.toLowerCase().includes(search.trim().toLowerCase()));
  const chosen=selected && q.data?.receipts.find(r=>r.id===selected.id&&r.source===selected.source&&r.tenantId===org);
  const allowed=!!chosen && !chosen.linkedInvoice && !chosen.alreadyApplied &&
    (!chosen.currency||chosen.currency==="AUD") && matchesOutstandingAmount(chosen.amount,q.data?.amountDue||0);
  const mutation=useMutation({
    mutationFn:async()=>{
      if(!chosen||!confirmed||!allowed) throw new Error("Select and confirm an eligible receipt");
      return (await api("POST",`/api/ar/invoices/${invoice.invoice_id}/link-xero-receipt`,{
        tenantId:invoice.tenant_id,receiptTenantId:org,source:chosen.source,paymentId:chosen.id,
        expectedAmount:q.data!.amountDue,confirmed:true,
      })).json();
    },onSuccess:onLinked,
  });
  function reset() { setSelected(null);setConfirmed(false);mutation.reset(); }
  return <Dialog open onOpenChange={open=>{if(!open&&!mutation.isPending)onClose();}}>
    <DialogContent className="max-w-3xl max-h-[92dvh] flex flex-col" data-testid="ar-receipt-dialog">
      <DialogHeader>
        <DialogTitle>Link commission payment</DialogTitle>
        <DialogDescription>{invoice.invoice_number} · {invoice.contact_name}. Records cash received in the dashboard only. It does not clear or change the invoice in Xero.</DialogDescription>
      </DialogHeader>
      <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">
        <div className="space-y-1">
          <Label htmlFor="ar-receipt-org">Receipt organisation</Label>
          <select id="ar-receipt-org" className="flex w-full rounded-md border bg-background p-2 text-sm" disabled={mutation.isPending}
            value={org} onChange={e=>{reset();setOrg(e.target.value);}}>
            <option value={CENTRAL}>Inner Circle Group Pty Ltd (central)</option>
            <option value={invoice.tenant_id}>{invoice.tenant_name}</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label htmlFor="ar-receipt-from">From</Label><Input id="ar-receipt-from" type="date" value={since} disabled={mutation.isPending} onChange={e=>{reset();setSince(e.target.value);}}/></div>
          <div><Label htmlFor="ar-receipt-to">To</Label><Input id="ar-receipt-to" type="date" value={until} disabled={mutation.isPending} onChange={e=>{reset();setUntil(e.target.value);}}/></div>
        </div>
        <div><Label htmlFor="ar-receipt-search">Search matching receipts</Label><Input id="ar-receipt-search" placeholder="Vendor, reference or invoice" value={search} onChange={e=>setSearch(e.target.value)}/></div>
        <Button variant="outline" size="sm" disabled={q.isFetching||mutation.isPending} onClick={()=>{reset();q.refetch();}}>Refresh Xero receipts</Button>
        {q.isFetching&&<p className="text-sm">Reading Xero receipts…</p>}
        {q.error&&<p role="alert" className="text-sm text-destructive">{q.error.message}</p>}
        {q.data&&<>
          <p className="text-xs text-muted-foreground">Showing only payments of exactly {aud(q.data.amountDue)} from {q.data.tenantName}. Recorded receipts only, not raw bank-feed lines. Bundled or split payments require separate review.</p>
          <div role="radiogroup" aria-label="Commission receipts" className="space-y-2 max-h-64 overflow-y-auto">
            {options.map(r=><button key={`${r.source}:${r.id}`} type="button" role="radio"
              aria-checked={chosen?.id===r.id&&chosen?.source===r.source}
              disabled={!!r.linkedInvoice||r.alreadyApplied||mutation.isPending|| (!!r.currency&&r.currency!=="AUD")}
              onClick={()=>{setSelected(r);setConfirmed(false);}}
              className={`w-full text-left rounded-md border p-3 space-y-1 disabled:opacity-50 ${chosen?.id===r.id&&chosen?.source===r.source?"border-primary bg-primary/5":"hover:bg-muted/50"}`}>
              <div className="flex justify-between gap-3 text-sm font-medium"><span className="min-w-0 break-words">{r.contactName||"No contact name"}</span><span className="shrink-0">{aud(r.amount)}</span></div>
              <p className="text-xs break-words">{r.date} · {r.reference||"No reference"}{r.invoiceNumber?` · ${r.invoiceNumber}`:""}</p>
              <p className="text-xs text-muted-foreground">{r.source==="payment"?"Invoice payment":"Receive money"} · {r.isReconciled?"Bank-reconciled":"Not bank-reconciled"}{!r.currency?" · Currency checked on confirmation":""}
                {r.linkedInvoice?` · Linked to ${r.linkedInvoice}`:r.alreadyApplied?" · Already included in Xero invoice balances":""}</p>
            </button>)}
            {!options.length&&!q.isFetching&&<p className="text-sm text-muted-foreground">No receipts match {aud(q.data.amountDue)} and this search. Try wider dates or the other organisation.</p>}
          </div>
        </>}
        {chosen&&<div className="rounded-md border p-4 space-y-3 bg-muted/30">
          <p className="text-sm">Link <strong>{aud(chosen.amount)}</strong> to <strong>{invoice.invoice_number}</strong> and mark cash received, pending Xero clearing.</p>
          {!chosen.isReconciled&&<p className="text-sm text-amber-700 dark:text-amber-400">Not bank-reconciled. Verify that the money has actually arrived.</p>}
          <Label className="flex items-start gap-2 text-sm font-normal"><input type="checkbox" className="mt-1" checked={confirmed} disabled={mutation.isPending} onChange={e=>setConfirmed(e.target.checked)}/>
            I checked the vendor, property/reference and receipt. This payment belongs to this invoice and has not already been allocated elsewhere.</Label>
        </div>}
        {mutation.error&&<p role="alert" className="text-sm text-destructive">{mutation.error.message}</p>}
      </div>
      <DialogFooter><Button variant="outline" disabled={mutation.isPending} onClick={onClose}>Cancel</Button>
        <Button disabled={!allowed||!confirmed||q.isFetching||!!q.error||mutation.isPending} onClick={()=>mutation.mutate()}>Link receipt and mark received</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
