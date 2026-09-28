import {createWorkforceState} from "./state.js";import {TitanMissionControl} from "./mission-control.js";import {TitanWorkforceController} from "./controller.js";import {TitanExecutionServices} from "./execution-services.js";import {TitanWorkforceIntegration} from "./integration.js";import {TitanLiveChatRuntime} from "./live-chat-runtime.js";
const assert=(x,m)=>{if(!x)throw new Error(m)};
let now=1_000_000;const priorDateNow=Date.now;Date.now=()=>now;
const workers={};
class FakeScheduler{
 constructor(){this.workers={A1:{id:"A1",squad:"A",missionId:null,cycleId:null,currentPass:0,completedPasses:[],state:"READY",health:"ready",queue:[],actionKeys:[]}}}
 static restore(s){const x=new FakeScheduler();x.workers=JSON.parse(JSON.stringify(s.workers));return x}
 snapshot(){return {workers:this.workers}}
 getWorker(id){return this.workers[id]}
 bindConversation(){}
 startCycle(id,c){const w=this.workers[id];Object.assign(w,{missionId:c.missionId,cycleId:c.cycleId,queue:c.queue,currentPass:0,completedPasses:[],state:"WAITING_GATE"});return JSON.parse(JSON.stringify(w))}
 block(id,r){this.workers[id].state="BLOCKED";this.workers[id].blockReason=r}
}
globalThis.TitanChatFivePass={ChatFivePassScheduler:FakeScheduler};
globalThis.TitanWorkCodexPipeline={
 createCycleReview:x=>({...x,review_id:"review-"+x.next_decision,cycle:x.cycle||1,passes_completed:x.passes_completed||5,approved_findings:x.approved_findings||[],dependencies:x.dependencies||[],next_decision:x.next_decision}),
 nextResearchEpoch:r=>r.next_decision==="CONTINUE_5"?{action:"research",target_passes:r.passes_completed+5}:r.next_decision==="READY_FOR_CODEX"?{action:"compile-delta"}:r.next_decision==="REDIRECT"?{action:"redirect",redirect:r.redirect||{}}:{action:"mission-control-attention",blocker:r.blocker||{}},
 compileApprovedImplementationDelta:x=>({delta_id:"delta-1",mission:x.mission,source_cycle_reviews:x.cycle_reviews,scope_paths:x.scope_paths})
};
const state=createWorkforceState(),missions=new TitanMissionControl(state),services=new TitanExecutionServices(),controller=new TitanWorkforceController(state,{services});
missions.upsert({id:"m1",title:"Mission",scope_paths:["src"],acceptance:["ok"]});controller.registry.get("A1").conversation={key:"conv",tabId:1};
services.register("chat",{observe:async()=>({assistantCount:0,generating:false}),assertConversation:async()=>true,send:async()=>({ok:true})});
let decision="CONTINUE_5";services.register("work",{review:async()=>({next_decision:decision,approved_findings:["finding"],next_queue:["n1","n2","n3","n4","n5"]})});
const integration=new TitanWorkforceIntegration({state,controller,missionControl:missions,services});integration.bindGlobals();
let saves=0;const runtime=new TitanLiveChatRuntime({state,integration,missionControl:missions,services,save:async()=>{saves++}});
await runtime.startCycle("A1",{missionId:"m1",cycleId:"1",queue:["a","b","c","d","e"]});
const ev={type:"supervisor_review_required",workerId:"A1",squad:"A",missionId:"m1",cycleId:"1",detail:{completedPasses:[1,2,3,4,5].map(passNumber=>({passNumber}))}};
let out=await runtime.routeSupervisorReview(ev);assert(out.review.next_decision==="CONTINUE_5","continue decision");assert(runtime.scheduler.getWorker("A1").cycleId==="2"&&runtime.scheduler.getWorker("A1").queue[0]==="n1","next cycle not queued");
decision="READY_FOR_CODEX";let deltas=0;const listener=()=>deltas++;globalThis.window={dispatchEvent:e=>{if(e.type==="titan-workforce:approved-delta")listener()},CustomEvent:class{constructor(type,o){this.type=type;this.detail=o?.detail}}};
out=await runtime.routeSupervisorReview({...ev,cycleId:"2"});assert(out.route.action==="compile-delta","ready route");assert(state.chatRuntime.approvedDeltas.m1.delta_id==="delta-1","delta not persisted");assert(deltas===1,"approved delta event count");
const snap=runtime.snapshot();const state2=JSON.parse(JSON.stringify(state));state2.chatScheduler=snap.scheduler;const integration2=new TitanWorkforceIntegration({state:state2,controller:new TitanWorkforceController(state2,{services}),missionControl:new TitanMissionControl(state2),services});integration2.bindGlobals();const restored=new TitanLiveChatRuntime({state:state2,integration:integration2,missionControl:integration2.missionControl,services});assert(restored.scheduler.getWorker("A1").cycleId==="2","restart lost scheduler cycle");assert(restored.scheduler.getWorker("A1").queue[0]==="n1","restart lost queued passes");
Date.now=priorDateNow;console.log("Autonomous loop decision/restart PASS",saves);
