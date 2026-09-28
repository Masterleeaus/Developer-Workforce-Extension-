import assert from "node:assert/strict";
import {TitanLiveChatRuntime} from "./live-chat-runtime.js";

class FakeScheduler{
 constructor(options={}){
  this.options=options;
  this.workers={A1:{id:"A1",missionId:"mission-1",cycleId:"cycle-1",currentPass:5,completedPasses:[1,2,3,4,5].map(passNumber=>({passNumber})),state:"CYCLE_COMPLETE",health:"ready"}};
 }
 static restore(_snapshot,options){return new FakeScheduler(options)}
 snapshot(){return{workers:this.workers}}
 getWorker(id){return this.workers[id]||{id}}
 bindConversation(){return true}
 startCycle(){return this.workers.A1}
 inspectGate(){return{action:"none"}}
}
globalThis.TitanChatFivePass={ChatFivePassScheduler:FakeScheduler};

const state={
 controls:{armed:false,emergencyStop:false},
 agents:{
  A1:{id:"A1",executionClass:"chat_worker",profileIds:[]},
  SUPERVISOR_A:{id:"SUPERVISOR_A",executionClass:"work_supervisor",profileIds:[]}
 }
};
const mission={id:"mission-1",title:"Test mission",goal:"Verify handoff",status:"assigned",scopePaths:[],acceptanceCriteria:[],verificationRequirements:[],dependencies:[]};
const supervisor=state.agents.SUPERVISOR_A;
let reviewCall=null;
const integration={
 controller:{
  registry:{
   get:id=>state.agents[id]||null,
   list:executionClass=>Object.values(state.agents).filter(x=>!executionClass||x.executionClass===executionClass)
  }
 },
 pipelineApi:{
  adaptChatSupervisorReviewEvent(event,pipelineMission){
   assert.equal(event.type,"supervisor_review_required");
   assert.equal(event.workerId,"A1");
   assert.equal(event.detail.completedPasses.length,5);
   assert.equal(pipelineMission.id,"mission-1");
   return{review_id:"review-1",chat_event:event};
  }
 },
 profileApi:{},
 normalizePipelineMission:m=>({id:m.id,title:m.title,goal:m.goal}),
 squadForWorker:id=>id.startsWith("A")?"A":"B",
 castMission(missionId,slotId){
  assert.equal(missionId,"mission-1");
  assert.equal(slotId,"SUPERVISOR_A");
  supervisor.profileIds=["mission-planning"];
  return{compiled:{text:"SUPERVISOR PROFILE CONTEXT"}};
 },
 async requestWorkReview(squad,payload){
  reviewCall={squad,payload};
  return{ok:true};
 }
};
const missionControl={
 get:id=>id==="mission-1"?mission:null,
 assign(){return mission}
};
const services={require(){return{}}};
const audits=[];
const runtime=new TitanLiveChatRuntime({
 state,
 integration,
 missionControl,
 services,
 audit:(type,data)=>audits.push({type,data}),
 save:async()=>{}
});

const event={
 type:"supervisor_review_required",
 workerId:"A1",
 missionId:"mission-1",
 cycleId:"cycle-1",
 detail:{completedPasses:[1,2,3,4,5].map(passNumber=>({passNumber}))}
};
const result=await runtime.routeSupervisorReview(event);
assert.deepEqual(result,{ok:true});
assert.equal(reviewCall.squad,"A");
assert.equal(reviewCall.payload.profile_context,"SUPERVISOR PROFILE CONTEXT");
assert.equal(supervisor.missionId,"mission-1");
assert.equal(supervisor.status,"reviewing");
assert.deepEqual(supervisor.profileIds,["mission-planning"]);
assert(audits.some(x=>x.type==="supervisor-review-requested"));

assert.deepEqual(
 runtime.advanceGuard({missionId:"mission-1",completedPasses:[]}),
 {allowed:true}
);
mission.maxPasses=5;
assert.deepEqual(
 runtime.advanceGuard({missionId:"mission-1",completedPasses:[1,2,3,4,5]}),
 {allowed:false,reason:"MISSION_PASS_BUDGET_EXHAUSTED"}
);
mission.status="cancelled";
assert.deepEqual(
 runtime.advanceGuard({missionId:"mission-1",completedPasses:[]}),
 {allowed:false,reason:"MISSION_NOT_ACTIVE"}
);

assert(Array.isArray(state.sendLedger));
assert(state.chatRuntime&&state.chatScheduler);

console.log("Titan Live Chat Runtime test PASS");
