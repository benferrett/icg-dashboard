import React, {useState} from "react";
import {createRoot} from "react-dom/client";
import {ConsultantsView} from "./pages/views/ConsultantsView";
import {OverviewView} from "./pages/views/OverviewView";
import {MarketingView} from "./pages/views/MarketingView";
import "./index.css";
const statuses = ["sat","sat","sat","sat","sat","sat","awaiting_confirmation","cancelled","rescheduled","no_show_or_reschedule","no_show_or_reschedule"];
const scheduleds = statuses.map((status,i)=>({key:`d:demo-${i}`,meetingId:`demo-${i}`,client:i===6?"Sample client with a longer household name":`Sample client ${i+1}`,date:"2026-09-16T05:30:00Z",status,reason:"Synthetic test record. Not live CRM data."}));
const source = {booked:11,scheduled:11,sat:6,sold:0};
const win = {dsBooked:11,dsStarted:11,dsScheduled:11,dsSat:6,dsAwaitingConfirmation:1,dsUpcoming:0,dsNotAttended:4,dsBookedSat:6,dsBySource:{META:source,EMBR:{booked:0,scheduled:0,sat:0,sold:0}},membershipsSold:0,membershipTiers:{},consultants:[],leads:0,contacted:0,connected:0,contactRate:0,connectRate:0};
Object.assign(win,{totals:{leads:0,contacted:0,connected:0,contactRate:0,connectRate:0},label:"Synthetic preview"});
const fixture:any = {
 consultants:[{name:"Sample consultant",deals:11,dsBooked:11,dsScheduled:11,dsSat:6,sold:0,showUp:55,talkMs:0,bookings:scheduleds,sats:scheduleds.filter(s=>s.status==="sat"),scheduleds}],
 salesFunnel:{ok:true,window:win},contracts:{funnel:[]},embr:{ok:false},
 marketing:{newLeads90:0,trend:[],sources:[],leadBooking:{ok:false}},soldByChannel:{},
};
function App(){
 const [tab,setTab]=useState("Consultants");
 const [state,setState]=useState("Ready");
 const [dark,setDark]=useState(false);
 const d=state==="Empty"?{...fixture,consultants:[],salesFunnel:{ok:true,window:{...win,dsBooked:0,dsScheduled:0,dsSat:0,dsAwaitingConfirmation:0,dsNotAttended:0}}}:state==="Error"?{...fixture,salesFunnel:{ok:false,error:"Preview: attendance data could not be loaded."}}:fixture;
 return <main className={`min-h-screen bg-background text-foreground ${dark?"dark":""}`} style={{padding:"clamp(16px,3vw,40px)"}}>
 <header className="mb-8"><div className="flex items-center gap-3"><svg width="32" height="32" viewBox="0 0 32 32" aria-label="ICG preview"><circle cx="16" cy="16" r="13" stroke="currentColor" strokeWidth="3" fill="none"/><circle cx="16" cy="16" r="5" fill="currentColor"/></svg><h1 className="text-xl font-semibold">ICG Attendance Correction Preview</h1></div>
 <p className="text-sm text-muted-foreground mt-3">Synthetic test data only. This preview does not change the live dashboard or HubSpot.</p>
 <div className="flex flex-wrap gap-2 mt-5">{["Consultants","Overview","Marketing"].map(t=><button key={t} className={`border rounded-md px-4 py-2 ${tab===t?"bg-primary text-primary-foreground":""}`} onClick={()=>setTab(t)}>{t}</button>)}
 <select aria-label="Preview state" className="border rounded-md p-2 bg-background" value={state} onChange={e=>setState(e.target.value)}>{["Ready","Loading","Empty","Error"].map(s=><option key={s}>{s}</option>)}</select>
 <button className="border rounded-md px-4 py-2" onClick={()=>setDark(!dark)}>Toggle theme</button></div></header>
 {tab==="Consultants"?<ConsultantsView d={d} loading={state==="Loading"} periodLabel="Test period"/>:tab==="Overview"?<OverviewView d={d} loading={state==="Loading"} periodLabel="Test period"/>:<MarketingView d={d} loading={state==="Loading"} metaLoading={false} periodLabel="Test period"/>}
 </main>;
}
createRoot(document.getElementById("root")!).render(<App/>);
