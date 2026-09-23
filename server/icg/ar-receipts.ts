import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { arDatabase, listOverrides } from "./ar-overrides";
import { xeroGet, XERO_TENANTS, XERO_TENANT_CENTRAL, normaliseInvoice, parseXeroDate } from "./xero";
import { matchesOutstandingAmount } from "../../shared/membership-receipts";
import type { ArReceipt, ArReceiptLink, ArReceiptEvidence } from "../../shared/ar-receipts";

type Fetcher = typeof xeroGet;
const CENTRAL = {id:XERO_TENANT_CENTRAL,name:"Inner Circle Group Pty Ltd (central)"};
export const receiptOrganisations = [CENTRAL,...XERO_TENANTS];
class InvalidReceipt extends Error {}
const uuid = z.string().uuid();
const source = z.enum(["payment","bank_transaction"]);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v =>
  Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v);
const invoiceBody = z.object({tenantId:uuid});
function invoiceTenant(id:string) {
  const tenant = XERO_TENANTS.find(t=>t.id===id);
  if (!tenant) throw new Error("Unknown invoice organisation");
  return tenant;
}
function receiptTenant(invoiceTenantId:string, receiptTenantId:string) {
  if (![XERO_TENANT_CENTRAL,invoiceTenantId].includes(receiptTenantId))
    throw new Error("Choose the central or invoice organisation");
  return receiptOrganisations.find(t=>t.id===receiptTenantId)!;
}
function db() {
  const d=arDatabase();
  d.exec(`CREATE TABLE IF NOT EXISTS ar_receipt_links(
    id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id TEXT NOT NULL,
    invoice_tenant_id TEXT NOT NULL, receipt_tenant_id TEXT NOT NULL,
    receipt_source TEXT NOT NULL, receipt_id TEXT NOT NULL, evidence_json TEXT NOT NULL,
    linked_at TEXT NOT NULL, removed_at TEXT, removed_by TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS ar_one_receipt ON ar_receipt_links
      (receipt_tenant_id,receipt_source,receipt_id) WHERE removed_at IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS ar_one_invoice_receipt ON ar_receipt_links
      (invoice_tenant_id,invoice_id) WHERE removed_at IS NULL;`);
  return d;
}
export function arReceiptLinks(includeRemoved=false):ArReceiptLink[] {
  return (db().prepare(`SELECT * FROM ar_receipt_links ${includeRemoved?"":"WHERE removed_at IS NULL"} ORDER BY id DESC`).all() as any[])
    .map(r=>({...JSON.parse(r.evidence_json),id:r.id,linkedAt:r.linked_at,removedAt:r.removed_at,removedBy:r.removed_by}));
}
export function findArReceiptLink(tenantId:string,invoiceId:string) {
  return arReceiptLinks().find(l=>l.invoiceTenantId===tenantId && l.invoiceId===invoiceId);
}
export function assertArFollowupAllowed(tenantId:string,invoiceId:string) {
  const manual=listOverrides().get(invoiceId);
  if ((manual?.tenant_id===tenantId && manual.marked_paid_at) || findArReceiptLink(tenantId,invoiceId))
    throw new Error("Payment is already marked received or has linked evidence. Review it before sending a reminder.");
}
export async function readArInvoice(tenantId:string,id:string,fetcher:Fetcher=xeroGet) {
  invoiceTenant(tenantId); uuid.parse(id);
  const body=await fetcher<any>(tenantId,`/api.xro/2.0/Invoices/${id}`);
  const raw=body.Invoices?.[0];
  if (!raw || raw.InvoiceID!==id || raw.Type!=="ACCREC") throw new Error("Sales invoice not found");
  return normaliseInvoice(raw);
}
function normaliseReceipt(raw:any,tenantId:string,kind:ArReceipt["source"]):ArReceipt {
  const isPayment=kind==="payment";
  if (raw.Status!=="AUTHORISED" || (isPayment ? raw.PaymentType!=="ACCRECPAYMENT" : raw.Type!=="RECEIVE"))
    throw new InvalidReceipt("Receipt is deleted, reversed or is not an authorised incoming payment");
  return {
    id:isPayment?raw.PaymentID:raw.BankTransactionID,source:kind,tenantId,
    tenantName:receiptOrganisations.find(t=>t.id===tenantId)?.name ?? tenantId,
    amount:Number(isPayment?raw.Amount:raw.Total),currency:(isPayment?raw.Invoice?.CurrencyCode:raw.CurrencyCode)||"",
    date:parseXeroDate(raw.Date)?.toISOString().slice(0,10)||"",
    contactName:(isPayment?raw.Invoice?.Contact?.Name:raw.Contact?.Name)||"",
    reference:raw.Reference||"",invoiceId:raw.Invoice?.InvoiceID,invoiceNumber:raw.Invoice?.InvoiceNumber,
    isReconciled:raw.IsReconciled===true,
  };
}
export async function readArReceipt(tenantId:string,kind:ArReceipt["source"],id:string,fetcher:Fetcher=xeroGet):Promise<ArReceipt> {
  uuid.parse(id);
  if (!receiptOrganisations.some(t=>t.id===tenantId)) throw new Error("Unknown receipt organisation");
  const endpoint=kind==="payment"?"Payments":"BankTransactions";
  let body:any;
  try { body=await fetcher<any>(tenantId,`/api.xro/2.0/${endpoint}/${id}`); }
  catch(e) { if (/ 404$/.test((e as Error).message)) throw new InvalidReceipt("Receipt no longer exists"); throw e; }
  const raw=body[endpoint]?.[0];
  if (!raw || (kind==="payment"?raw.PaymentID:raw.BankTransactionID)!==id)
    throw new InvalidReceipt("Receipt not found");
  if (kind==="payment" && !raw.Invoice?.CurrencyCode && raw.Invoice?.InvoiceID) {
    const detail=await fetcher<any>(tenantId,`/api.xro/2.0/Invoices/${uuid.parse(raw.Invoice.InvoiceID)}`);
    raw.Invoice.CurrencyCode=detail.Invoices?.[0]?.CurrencyCode;
  }
  return normaliseReceipt(raw,tenantId,kind);
}
export async function checkArReceiptLink(link:ArReceiptLink,fetcher:Fetcher=xeroGet):Promise<ArReceiptEvidence> {
  try {
    const current=await readArReceipt(link.receipt.tenantId,link.receipt.source,link.receipt.id,fetcher);
    const valid=current.currency==="AUD" && matchesOutstandingAmount(current.amount,link.amount) &&
      current.date===link.receipt.date && current.invoiceId===link.receipt.invoiceId;
    return {...link,verification:valid?"verified":"invalid"};
  } catch(e) {
    return {...link,verification:e instanceof InvalidReceipt?"invalid":"unavailable"};
  }
}
async function pages(tenantId:string,endpoint:string,where:string,fetcher:Fetcher) {
  const rows:any[]=[];
  for(let page=1;page<=100;page++) {
    const body=await fetcher<any>(tenantId,`/api.xro/2.0/${endpoint}`,{where,page,pageSize:100,order:"Date DESC"});
    if(!Array.isArray(body[endpoint])) throw new Error("Invalid Xero receipt response");
    rows.push(...body[endpoint]);
    if(body[endpoint].length<100) return rows;
  }
  throw new Error("Too many receipts; choose a narrower date range");
}
export async function listArReceipts(tenantId:string,since:string,until:string,amount:number,fetcher:Fetcher=xeroGet) {
  const dates=`Date>=DateTime(${since.replace(/-/g,",")})&&Date<=DateTime(${until.replace(/-/g,",")})`;
  const [payments,txns]=await Promise.all([
    pages(tenantId,"Payments",`PaymentType=="ACCRECPAYMENT"&&Status=="AUTHORISED"&&${dates}`,fetcher),
    pages(tenantId,"BankTransactions",`Type=="RECEIVE"&&Status=="AUTHORISED"&&${dates}`,fetcher),
  ]);
  const rows:ArReceipt[]=[];
  for (const [kind,items] of [["payment",payments],["bank_transaction",txns]] as const) {
    for(const raw of items) {
      if(!matchesOutstandingAmount(Number(kind==="payment"?raw.Amount:raw.Total),amount)) continue;
      try { rows.push(normaliseReceipt(raw,tenantId,kind)); } catch(e) { if(!(e instanceof InvalidReceipt)) throw e; }
    }
  }
  return Array.from(new Map(rows.map(p=>[`${p.source}:${p.id}`,p])).values())
    .filter(p=>p.date>=since && p.date<=until && p.date<=new Date().toISOString().slice(0,10) && (!p.currency||p.currency==="AUD"))
    .sort((a,b)=>b.date.localeCompare(a.date));
}
export function saveArReceiptLink(link:Omit<ArReceiptLink,"id"|"linkedAt"|"removedAt"|"removedBy">):ArReceiptLink {
  if(!matchesOutstandingAmount(link.receipt.amount,link.amount) || link.receipt.currency!=="AUD" ||
      !link.receipt.date || link.receipt.date>new Date().toISOString().slice(0,10))
    throw new Error("Receipt must be a dated AUD payment for the exact outstanding balance");
  return db().transaction(()=>{
    const active=arReceiptLinks();
    const used=active.find(l=>l.receipt.tenantId===link.receipt.tenantId && l.receipt.source===link.receipt.source && l.receipt.id===link.receipt.id);
    if(used?.invoiceId===link.invoiceId && used.invoiceTenantId===link.invoiceTenantId) return used;
    if(used) throw new Error("This receipt is already linked to another invoice");
    if(active.some(l=>l.invoiceTenantId===link.invoiceTenantId && l.invoiceId===link.invoiceId))
      throw new Error("This invoice already has a linked receipt");
    const result=db().prepare(`INSERT INTO ar_receipt_links
      (invoice_id,invoice_tenant_id,receipt_tenant_id,receipt_source,receipt_id,evidence_json,linked_at)
      VALUES (?,?,?,?,?,?,?)`).run(link.invoiceId,link.invoiceTenantId,link.receipt.tenantId,link.receipt.source,link.receipt.id,JSON.stringify(link),new Date().toISOString());
    return arReceiptLinks().find(l=>l.id===Number(result.lastInsertRowid))!;
  })();
}
export function removeArReceiptLink(tenantId:string,invoiceId:string,id:number) {
  const row=arReceiptLinks(true).find(l=>l.id===id && l.invoiceTenantId===tenantId && l.invoiceId===invoiceId);
  if(!row) throw new Error("Receipt link not found");
  db().prepare(`UPDATE ar_receipt_links SET removed_at=?,removed_by=? WHERE id=? AND removed_at IS NULL`)
    .run(new Date().toISOString(),"ICG Dashboard (shared login)",id);
}
export function registerArReceiptRoutes(app:Express,auth:RequestHandler,invalidate:()=>void,fetcher:Fetcher=xeroGet) {
  app.post("/api/ar/invoices/:invoiceId/xero-receipts",auth,async(req,res)=>{
    res.setHeader("Cache-Control","no-store");
    try {
      const body=invoiceBody.extend({receiptTenantId:uuid,since:date,until:date}).parse(req.body);
      const org=receiptTenant(body.tenantId,body.receiptTenantId);
      if(body.since>body.until || Date.parse(body.until)-Date.parse(body.since)>366*86400000) throw new Error("Choose a date range of up to one year");
      const inv=await readArInvoice(body.tenantId,String(req.params.invoiceId),fetcher);
      if(inv.Status!=="AUTHORISED" || inv.CurrencyCode!=="AUD" || inv.AmountDue<=0) throw new Error("Invoice must have an outstanding AUD balance");
      const receipts=await listArReceipts(org.id,body.since,body.until,inv.AmountDue,fetcher);
      const links=arReceiptLinks();
      res.json({amountDue:inv.AmountDue,tenantId:org.id,tenantName:org.name,
        organisations:[CENTRAL,invoiceTenant(body.tenantId)],
        receipts:receipts.map(p=>({...p,
          linkedInvoice:links.find(l=>l.receipt.tenantId===p.tenantId && l.receipt.source===p.source && l.receipt.id===p.id)?.invoiceNumber || null,
          // Same-entity invoice payments already reduce Xero AmountDue,
          // whether applied to this invoice or another. Never count twice.
          alreadyApplied:p.tenantId===body.tenantId && !!p.invoiceId,
        }))});
    } catch(e) { res.status(e instanceof z.ZodError?400:409).json({error:(e as Error).message}); }
  });
  app.post("/api/ar/invoices/:invoiceId/link-xero-receipt",auth,async(req,res)=>{
    try {
      const body=invoiceBody.extend({receiptTenantId:uuid,source,paymentId:uuid,expectedAmount:z.number().positive(),confirmed:z.literal(true)}).parse(req.body);
      receiptTenant(body.tenantId,body.receiptTenantId);
      const inv=await readArInvoice(body.tenantId,String(req.params.invoiceId),fetcher);
      if(inv.Status!=="AUTHORISED" || inv.CurrencyCode!=="AUD" || !matchesOutstandingAmount(inv.AmountDue,body.expectedAmount))
        throw new Error("Invoice balance or status changed; refresh and review it");
      const payment=await readArReceipt(body.receiptTenantId,body.source,body.paymentId,fetcher);
      if(payment.tenantId===body.tenantId && payment.invoiceId)
        throw new Error("This invoice payment is already reflected in this organisation's invoice balances");
      const link=saveArReceiptLink({invoiceId:inv.InvoiceID,invoiceTenantId:body.tenantId,
        invoiceNumber:inv.InvoiceNumber,invoiceTenantName:invoiceTenant(body.tenantId).name,
        vendor:inv.Contact.Name||"",amount:inv.AmountDue,receipt:payment,linkedBy:"ICG Dashboard (shared login)"});
      invalidate(); res.json({ok:true,link});
    } catch(e) { res.status(e instanceof z.ZodError?400:409).json({error:(e as Error).message}); }
  });
  app.post("/api/ar/invoices/:invoiceId/unlink-xero-receipt",auth,(req,res)=>{
    try {
      const body=invoiceBody.extend({linkId:z.number().int().positive(),confirmed:z.literal(true)}).parse(req.body);
      invoiceTenant(body.tenantId);
      removeArReceiptLink(body.tenantId,String(req.params.invoiceId),body.linkId);
      invalidate(); res.json({ok:true});
    } catch(e) { res.status(400).json({error:(e as Error).message}); }
  });
}
