import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {TitanLiveChatRuntime} from "./live-chat-runtime.js";
import {createWorkforceState} from "./state.js";
import {TitanWorkforceController,validateAssignmentInvariants} from "./controller.js";
import {TitanMissionControl} from "./mission-control.js";

const require=createRequire(import.meta.url);
const pipeline=require("../../titan-work-codex-pipeline.js");

class FakeScheduler{
 constructor(options={}){
  this.options=options;
  this.workers={
   A1:{id:"A1",missionId:null,cycleId:null,currentPass:0,completedPasses:[],state:"READY",health:"ready",queue:[],conversationIdentity:null,lastDispatchAt:null}
  };
 }
 static restore(snapshot,options){
  const next=new FakeScheduler(options);
  if(snapshot?.workers)next.workers=JSON.parse(JSON.stringify(snapshot.workers));
  return next;
 }
 snapshot(){return{workers:JSON.parse(JSON.stringify(this.workers))}}
 getWorker(id){return this.workers[id]||{id}}
 bindConversation(id,key){this.workers[id]=this.workers[id]||{id};this.workers[id].conversationIdentity=key;return true}
 startCycle(id,{missionId,cycleId,queue}){
  if(!Array.isArray(queue)||queue.length!==5)throw new Error("five-pass queue must contain exactly 5 instructions");
  const worker=this.workers[id]||{id};
  Object.assign(worker,{missionId,cycleId,queue:[...queue],currentPass:0,completedPasses:[],state:"WAITING_GATE",health:"ready"});
  this.workers[id]=worker;
  return JSON.parse(JSON.stringify(worker));
 }
 inspectGate(){return{action:"none"}}
 setSlowdown(){return true}
}
globalThis.TitanChatFivePass={ChatFivePassScheduler:FakeScheduler};

const queue=n=>[1,2,3,4,5].map(i=>`cycle ${n} pass ${i}`);

function makeHarness({reviewResult={ok:true},missionId="mission-1"}={}){
 const state=createWorkforceState();
 const missionControl=new TitanMissionControl(state);
 const controller=new TitanWorkforceController(state,{missionControl});
 missionControl.upsert({
  id:missionId,
  title:"Autonomous runtime mission",
  goal:"Exercise Chat to Work routing",
  status:"queued",
  scope_paths:["src/runtime"],
  acceptance:["runtime works"],
  verificationRequirements:["browser"]
 });
 state.agents.A1.conversation={key:"https://chatgpt.com/c/a1",tabId:11,boundAt:Date.now()};
 state.agents.SUPERVISOR_A.conversation={key:"https://chatgpt.com/c/supa",tabId:21,boundAt:Date.now()};
 const calls=[],audits=[];
 const integration={
  controller,
  pipelineApi:pipeline,
  profileApi:null,
  normalizePipelineMission:m=>({
   id:m.id,title:m.title,goal:m.goal,repository:m.repository,
   scope_paths:m.scopePaths||[],constraints:m.constraints||[],
   acceptance_criteria:m.acceptanceCriteria||[],
   runtime_requirements:m.verificationRequirements||[],
   dependencies:m.dependencies||[]
  }),
  squadForWorker:id=>id.startsWith("A")?"A":"B",
  async requestWorkReview(squad,payload){calls.push({squad,payload});return typeof reviewResult==="function"?reviewResult({squad,payload}):reviewResult},
  async dispatchChatPass(){return{ok:true}}
 };
 const chat={
  async observe(){return{assistantCount:0,generating:false,composerReady:true,lastText:""}},
  async assertConversation(){return true}
 };
 const services={require(kind){if(kind==="chat")return chat;return{}}};
 let saves=0;
 const runtime=new TitanLiveChatRuntime({
  state,integration,missionControl,services,
  audit:(type,data)=>audits.push({type,data}),
  save:async()=>{saves++;return true}
 });
 return{state,missionControl,controller,integration,runtime,calls,audits,get saves(){return saves},missionId};
}

function reviewEvent(missionId="mission-1",cycleId="cycle-1"){
 return{
  type:"supervisor_review_required",
  workerId:"A1",squad:"A",missionId,cycleId,at:Date.now(),
  detail:{missionId,cycleId,completedPasses:[1,2,3,4,5].map(passNumber=>({passNumber,result:{ok:true}}))}
 };
}

{
 const h=makeHarness({reviewResult:{
  next_decision:"CONTINUE_5",
  passes_completed:5,
  worker:"A1",squad:"A",cycle:1,
  approved_findings:["continue research"],
  next_queue:queue(2)
 }});
 await h.runtime.startCycle("A1",{missionId:h.missionId,cycleId:"cycle-1",queue:queue(1)});
 assert.equal(h.missionControl.get(h.missionId).assignedAgent,"A1");
 assert.equal(h.state.agents.A1.missionId,h.missionId);
 assert(validateAssignmentInvariants(h.state).ok);

 const out=await h.runtime.routeSupervisorReview(reviewEvent(h.missionId));
 assert.equal(out.consumed.action,"continue-5");
 assert.equal(out.consumed.nextCycleId,"cycle-2");
 assert.equal(h.runtime.scheduler.getWorker("A1").cycleId,"cycle-2");
 assert.deepEqual(h.runtime.scheduler.getWorker("A1").queue,queue(2));
 assert.equal(h.missionControl.get(h.missionId).assignedAgent,"A1","CONTINUE_5 must transfer ownership back to Chat worker");
 assert.equal(h.state.agents.SUPERVISOR_A.missionId,null,"Supervisor must release mission after CONTINUE_5");
 assert.equal(h.missionControl.get(h.missionId).status,"research");
 assert(validateAssignmentInvariants(h.state).ok);
 assert(h.audits.some(x=>x.type==="cycle-review-continue"));
}

{
 const h=makeHarness({reviewResult:{
  next_decision:"READY_FOR_CODEX",
  passes_completed:10,
  worker:"A1",squad:"A",cycle:2,
  approved_findings:["implement bounded change"],
  required_changes:["change runtime loop"],
  scope_paths:["src/runtime"],
  expected_files:["src/runtime/index.js"]
 }});
 await h.runtime.startCycle("A1",{missionId:h.missionId,cycleId:"cycle-2",queue:queue(2)});
 const out=await h.runtime.routeSupervisorReview(reviewEvent(h.missionId,"cycle-2"));
 assert.equal(out.consumed.action,"ready-for-codex");
 assert(out.consumed.delta?.delta_id);
 assert.equal(h.state.chatRuntime.approvedDeltas[h.missionId].delta_id,out.consumed.delta.delta_id);
 assert.equal(h.missionControl.get(h.missionId).status,"ready-for-codex");
 assert.equal(h.missionControl.get(h.missionId).assignedAgent,"SUPERVISOR_A","READY_FOR_CODEX remains owned by supervisor until Builder handoff");
 assert.equal(h.state.agents.A1.missionId,null,"Chat worker ownership must be cleared at Work handoff");
 assert(validateAssignmentInvariants(h.state).ok);
}

{
 const h=makeHarness({reviewResult:{
  next_decision:"REDIRECT",
  passes_completed:5,
  worker:"A1",squad:"A",cycle:1,
  redirect:{target:"B1",reason:"needs different research"}
 }});
 await h.runtime.startCycle("A1",{missionId:h.missionId,cycleId:"cycle-1",queue:queue(1)});
 const out=await h.runtime.routeSupervisorReview(reviewEvent(h.missionId));
 assert.equal(out.consumed.action,"redirect");
 assert.equal(h.missionControl.get(h.missionId).status,"redirected");
 assert.equal(h.state.chatRuntime.redirects[h.missionId].redirect.target,"B1");
 assert(validateAssignmentInvariants(h.state).ok);
}

{
 const h=makeHarness({reviewResult:{
  next_decision:"BLOCKED",
  passes_completed:5,
  worker:"A1",squad:"A",cycle:1,
  blocker:{reason:"external dependency unavailable"}
 }});
 await h.runtime.startCycle("A1",{missionId:h.missionId,cycleId:"cycle-1",queue:queue(1)});
 const out=await h.runtime.routeSupervisorReview(reviewEvent(h.missionId));
 assert.equal(out.consumed.action,"blocked");
 assert.equal(h.missionControl.get(h.missionId).status,"blocked");
 assert.match(h.missionControl.get(h.missionId).statusReason,/external dependency/i);
 assert(validateAssignmentInvariants(h.state).ok);
}

{
 const h=makeHarness({reviewResult:{ok:true,at:Date.now()}});
 await h.runtime.startCycle("A1",{missionId:h.missionId,cycleId:"cycle-1",queue:queue(1)});
 const out=await h.runtime.routeSupervisorReview(reviewEvent(h.missionId));
 assert.equal(out.ok,true,"send-only Work adapter acknowledgement should remain pending");
 const pending=Object.values(h.state.chatRuntime.pendingReviews);
 assert.equal(pending.length,1);
 assert.equal(pending[0].status,"awaiting-result");
 assert.equal(h.missionControl.get(h.missionId).assignedAgent,"SUPERVISOR_A");
 assert(validateAssignmentInvariants(h.state).ok);

 const persisted=JSON.parse(JSON.stringify(h.state));
 const missionControl2=new TitanMissionControl(persisted);
 const controller2=new TitanWorkforceController(persisted,{missionControl:missionControl2});
 const integration2={...h.integration,controller:controller2};
 const runtime2=new TitanLiveChatRuntime({
  state:persisted,integration:integration2,missionControl:missionControl2,services:{require:()=>({})},save:async()=>{}
 });
 assert.equal(Object.values(runtime2.state.chatRuntime.pendingReviews).length,1,"pending Work review must survive runtime restart");
 assert.equal(Object.values(runtime2.state.chatRuntime.pendingReviews)[0].status,"awaiting-result");
 assert(validateAssignmentInvariants(persisted).ok);
}

{
 const h=makeHarness();
 await h.runtime.startCycle("A1",{missionId:h.missionId,cycleId:"cycle-1",queue:queue(1)});
 h.missionControl.get(h.missionId).maxPasses=5;
 assert.deepEqual(h.runtime.advanceGuard({missionId:h.missionId,completedPasses:[1,2,3,4,5]}),{allowed:false,reason:"MISSION_PASS_BUDGET_EXHAUSTED"});
 h.missionControl.cancel(h.missionId);
 assert.deepEqual(h.runtime.advanceGuard({missionId:h.missionId,completedPasses:[]}),{allowed:false,reason:"MISSION_NOT_ACTIVE"});
}

console.log("Titan Live Chat Runtime autonomous-loop tests PASS");
