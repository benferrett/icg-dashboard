import test from "node:test";
import assert from "node:assert/strict";
import {hubspot} from "./hubspot";
import {discoverySessions} from "./metrics";
import {attendanceReviews} from "./attendance-reviews";
import {DS_TITLE_PREFIX} from "./reference";

test("headline attendance reconciles with consultant, strategist, source and drilldown counts", async (t) => {
  const review=attendanceReviews[0];
  const ids=[review.meetingId,"fallback","pending","no-show","duplicate-sat"];
  const meetings=ids.map((id,i)=>({id,properties:{
    hs_meeting_title:`${DS_TITLE_PREFIX}: Same display name With Rob Gallacher Via Zoom`,
    hs_createdate:"2026-09-14T00:00:00Z",
    hs_meeting_start_time:i===0?review.startTime:"2026-09-16T06:00:00Z",
    hs_meeting_end_time:"2026-09-16T08:00:00Z",
    hubspot_owner_id:"363184380",hs_meeting_outcome:"SCHEDULED",
  }}));
  const contactMap:any=Object.fromEntries(ids.map(id=>[id,[id==="duplicate-sat"?"fallback-contact":`${id}-contact`]]));
  const direct:any={[review.meetingId]:[review.dealId],fallback:[],pending:["p"],"no-show":["n"],"duplicate-sat":["f"]};
  const props:any=Object.fromEntries([[review.dealId,"2870714823"],["f","2400252397"],["p","2870714823"],["n","2868125118"]].map(([id,dealstage])=>[id,{dealstage,pipeline:"1448193481",booking_consultant:"366721097"}]));
  t.mock.method(hubspot,"searchObjects",async()=>meetings);
  t.mock.method(hubspot,"batchAssociations",async(from:string,to:string)=>{
    if(from==="contacts")return {"fallback-contact":["f"]};
    return to==="contacts"?contactMap:direct;
  });
  t.mock.method(hubspot,"batchRead",async(type:string,objectIds:string[])=>Object.fromEntries(objectIds.map(id=>[id,type==="deals"?props[id]:{hs_analytics_source:"PAID_SOCIAL"}])));
  t.mock.method(hubspot,"batchReadWithHistory",async()=>({}));
  const d=await discoverySessions("2026-09-13T14:00:00Z","2026-09-16T14:00:00Z");
  assert.equal(d.scheduled,4);
  assert.equal(d.sat,2);
  assert.equal(d.awaitingConfirmation,1);
  assert.equal(d.notAttended,1);
  const sum=(x:Record<string,number>)=>Object.values(x).reduce((a,b)=>a+b,0);
  assert.equal(sum(d.scheduledByConsultant),d.scheduled);
  assert.equal(sum(d.satByConsultant),d.sat);
  assert.equal(sum(d.satByStrategist),d.sat);
  assert.equal(d.bySource.META.sat+d.bySource.EMBR.sat,d.sat);
  assert.equal(d.bySource.META.scheduled+d.bySource.EMBR.scheduled,d.scheduled);
  const rows=Object.values(d.scheduledsByConsultant).flat();
  assert.equal(rows.length,d.scheduled);
  assert.equal(rows.filter(r=>r.status==="sat").length,d.sat);
  assert.equal(new Set(rows.map(r=>r.key)).size,rows.length);
  assert.equal(Object.values(d.satsByConsultant).flat().length,d.sat);
});
