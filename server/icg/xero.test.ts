import { test } from "node:test";
import assert from "node:assert/strict";

test("Xero invoice paging, sales-only filtering and shared token refresh",async()=>{
  process.env.XERO_CLIENT_ID="synthetic";
  process.env.XERO_CLIENT_SECRET="synthetic";
  process.env.XERO_GRANT_TYPE="client_credentials";
  const {listOpenInvoices,XERO_TENANT_VIC,XERO_TENANT_QLD}=await import("./xero");
  const original=globalThis.fetch;
  let tokenCalls=0,failedPage=false;
  const pages:number[]=[];
  globalThis.fetch=async(input,init)=>{
    const url=new URL(String(input));
    if(url.hostname==="identity.xero.com") {
      tokenCalls++;
      await new Promise(r=>setTimeout(r,10));
      return Response.json({access_token:"synthetic-token",expires_in:3600});
    }
    assert.equal(init?.method,"GET","all accounting calls are read-only");
    assert.equal(url.searchParams.get("where"),'Type=="ACCREC"');
    const page=Number(url.searchParams.get("page"));
    pages.push(page);
    if(failedPage&&page===2) return new Response("",{status:500});
    return Response.json({Invoices:Array.from({length:page===1?100:1},(_,i)=>({
      InvoiceID:`invoice-${page}-${i}`,InvoiceNumber:`INV-${page}-${i}`,
      Type:page===1&&i===0?"ACCPAY":"ACCREC",Status:"AUTHORISED",CurrencyCode:"AUD",
      AmountDue:22000,Total:33000,Date:"2026-09-01",Contact:{Name:"Synthetic"},
    }))});
  };
  try {
    const results=await Promise.all([listOpenInvoices(XERO_TENANT_VIC),listOpenInvoices(XERO_TENANT_QLD)]);
    assert.equal(tokenCalls,1,"parallel reads share a single token refresh");
    assert.equal(results[0].length,100,"page 2 included, outgoing bill excluded");
    assert.equal(results[1].length,100);
    assert.ok(pages.includes(2));
    assert.equal(results[0][0].CurrencyCode,"AUD");
    assert.equal(results[0][0].AmountDue,22000);
    failedPage=true;
    await assert.rejects(()=>listOpenInvoices(XERO_TENANT_VIC),/500/,"failed page is never a partial successful invoice list");
  } finally {globalThis.fetch=original;}
});
