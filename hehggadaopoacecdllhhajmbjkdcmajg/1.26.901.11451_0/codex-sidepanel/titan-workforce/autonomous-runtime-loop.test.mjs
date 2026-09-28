import assert from "node:assert/strict";
import {TitanLiveChatRuntime} from "./live-chat-runtime.js";

class FakeScheduler{
  constructor(options={}){
    this.options=options;
    this.workers={
      A1:{id:"A1",missionId:"m1",cycleId:"cycle-1",currentPass:5,completedPasses:[1,2,3,4,5].map(passNumber=>({passNumber})),state:"CYCLE_COMPLETE",health:"ready",conversationIdentity:"conv-a1"}
    };
    this.started=[];
  }
  static restore(snapshot,options){
    const s=new FakeScheduler(options);
    if(snapshot?.workers)s.workers=JSON.parse(JSON.stringify(snapshot.workers));
    s.started=Array.isArray(snapshot?.started)?snapshot.started.slice():[];
    return s;
  }
  snapshot(){return{workers:this.workers,started:this.started}}
  getWorker(id){return this.workers[id]||(this.workers[id]={id,missionId:null,cycleId:null,currentPass:0,completedPasses:[],state:"READY",health:"ready"})}
  bindConversation(id,key){this.getWorker(id).conversationIdentity=key;return true}
  startCycle(id,contract){
    const w=this.getWorker(id);
    Object.assign(w,{missionId:contract.missionId,cycleId:contract.cycleId,currentPass:0,completedPasses:[],state:"WAITING_GATE",health:"ready"});
    this.started.push({id,...JSON.parse(JSON.stringify(contract))});
    return w;
  }
  inspectGate(){return{action:"none"}}
  setSlowdown(){}
}
globalThis.TitanChatFivePass={ChatFivePassScheduler:FakeScheduler};

const pipeline={
  adaptChatSupervisorReviewEvent(event,mission){
    return {review_id:"pending:"+event.missionId+":"+event.cycleId,mission,worker:event.workerId,squad:event.squad,cycle:1,passes_completed:5};
  },
  createCycleReview(input){
    return {
      schema_version:1,
      review_id:input.review_id||input.reviewId||"review:"+input.mission.id+":"+input.worker,
      mission:input.mission,
      worker:input.worker,
      squad:input.squad,
      cycle:input.cycle||1,
      passes_completed:input.passes_completed||input.passesCompleted||5,
      approved_findings:input.approved_findings||[],
      dependencies:input.dependencies||[],
      next_decision:input.next_decision||input.nextDecision,
      redirect:input.redirect||null,
      blocker:input.blocker||null
    };
  },
  nextResearchEpoch(review){
    if(review.next_decision==="CONTINUE_5")return{action:"research",target_passes:review.passes_completed+5};
    if(review.next_decision==="READY_FOR_CODEX")return{action:"compile-delta"};
    if(review.next_decision==="REDIRECT")return{action:"redirect",redirect:review.redirect||{}};
    return{action:"mission-control-attention",blocker:review.blocker||{}};
  },
  compileApprovedImplementationDelta(input){
    assert(input.scope_paths.length>0);
    return {delta_id:"delta:"+input.mission.id,mission:input.mission,scope_paths:input.scope_paths,source_cycle_reviews:input.cycle_reviews.map(x=>({id:x.review_id}))};
  }
};

function makeRuntime({reviewResult}={}){
  const state={
    controls:{armed:true,emergencyStop:false},
    agents:{
      A1:{id:"A1",executionClass:"chat_worker",missionId:"m1",profileIds:[],conversation:{key:"conv-a1",tabId:1},status:"cycle-complete",health:"ready"},
      SUPERVISOR_A:{id:"SUPERVISOR_A",executionClass:"work_supervisor",missionId:null,profileIds:[],conversation:{key:"conv-supervisor",tabId:2},status:"idle",health:"ready"}
    },
    missions:{
      m1:{id:"m1",title:"Runtime loop",goal:"Complete cycle routing",status:"research",scopePaths:["src/**"],acceptanceCriteria:[],runtimeRequirements:[],verificationRequirements:[],testPlan:[]}
    }
  };
  const audits=[];
  const events=[];
  const eventTarget={dispatchEvent:e=>{events.push({type:e.type,detail:e.detail});return true}};
  const registry={
    get:id=>state.agents[id]||null,
    list:executionClass=>Object.values(state.agents).filter(x=>!executionClass||x.executionClass===executionClass)
  };
  const missionControl={
    get:id=>state.missions[id]||null,
    assign(id,agentId){state.missions[id].assignedAgent=agentId;state.missions[id].status="assigned";return state.missions[id]},
    transition(id,status,reason=null){state.missions[id].status=status;state.missions[id].statusReason=reason;return state.missions[id]}
  };
  const integration={
    controller:{registry},
    pipelineApi:pipeline,
    profileApi:null,
    normalizePipelineMission:m=>({id:m.id,title:m.title,goal:m.goal,repository:m.repository||"",scope_paths:m.scopePaths||[],constraints:m.constraints||[],acceptance_criteria:m.acceptanceCriteria||[],runtime_requirements:m.runtimeRequirements||[]}),
    squadForWorker:id=>id.startsWith("A")?"A":id.startsWith("B")?"B":null,
    async requestWorkReview(){return reviewResult??{ok:true}},
    async dispatchChatPass(){return{ok:true}}
  };
  const runtime=new TitanLiveChatRuntime({
    state,integration,missionControl,services:{require:()=>({observe:async()=>({assistantCount:0,generating:false,lastText:""})})},
    audit:(type,data)=>audits.push({type,data}),
    save:async()=>{},
    eventTarget
  });
  return{runtime,state,audits,events,missionControl,integration,eventTarget};
}

const event={type:"supervisor_review_required",workerId:"A1",squad:"A",missionId:"m1",cycleId:"cycle-1",cycle:1,detail:{completedPasses:[1,2,3,4,5].map(passNumber=>({passNumber}))}};

{
  const queue=["p1","p2","p3","p4","p5"];
  const h=makeRuntime({reviewResult:{next_decision:"CONTINUE_5",next_queue:queue,worker:"A1",squad:"A",mission:{id:"m1"},passes_completed:5}});
  const out=await h.runtime.routeSupervisorReview(event);
  assert.equal(out.consumed.action,"continue-5");
  assert.equal(h.runtime.scheduler.started.length,1);
  assert.equal(h.runtime.scheduler.started[0].cycleId,"cycle-2");
  assert.deepEqual(h.runtime.scheduler.started[0].queue,queue);
  assert.equal(h.state.missions.m1.status,"research");
  const pending=Object.values(h.state.chatRuntime.pendingReviews)[0];
  assert.equal(pending.status,"consumed");
  assert(h.audits.some(x=>x.type==="cycle-review-continue"));
}

{
  const h=makeRuntime({reviewResult:{ok:true}});
  const original=await h.runtime.routeSupervisorReview(event);
  assert.deepEqual(original,{ok:true});
  const pending=Object.values(h.state.chatRuntime.pendingReviews)[0];
  assert.equal(pending.status,"awaiting-result");

  const restarted=new TitanLiveChatRuntime({
    state:h.state,
    integration:h.integration,
    missionControl:h.missionControl,
    services:{require:()=>({observe:async()=>({assistantCount:0,generating:false,lastText:""})})},
    audit:()=>{},
    save:async()=>{},
    eventTarget:h.eventTarget
  });
  assert.equal(Object.values(restarted.state.chatRuntime.pendingReviews)[0].status,"awaiting-result");

  const consumed=await restarted.submitCycleReview({
    pendingReviewId:pending.id,
    review:{
      next_decision:"READY_FOR_CODEX",
      worker:"A1",
      squad:"A",
      mission:{id:"m1"},
      passes_completed:5,
      approved_findings:["implement bounded change"],
      scope_paths:["src/**"]
    }
  });
  assert.equal(consumed.action,"ready-for-codex");
  assert.equal(h.state.missions.m1.status,"ready-for-codex");
  assert.equal(h.state.chatRuntime.approvedDeltas.m1.delta_id,"delta:m1");
}

{
  const h=makeRuntime();
  const redirect=await h.runtime.consumeCycleReview({
    next_decision:"REDIRECT",worker:"A1",squad:"A",mission:{id:"m1"},passes_completed:5,redirect:{target:"A2",reason:"specialist"}
  },{event,workerId:"A1"});
  assert.equal(redirect.action,"redirect");
  assert.equal(h.state.missions.m1.status,"redirected");
  assert.equal(h.state.chatRuntime.redirects.m1.redirect.target,"A2");
}

{
  const h=makeRuntime();
  const blocked=await h.runtime.consumeCycleReview({
    next_decision:"BLOCKED",worker:"A1",squad:"A",mission:{id:"m1"},passes_completed:5,blocker:{reason:"external dependency"}
  },{event,workerId:"A1"});
  assert.equal(blocked.action,"blocked");
  assert.equal(h.state.missions.m1.status,"blocked");
  assert.match(h.state.missions.m1.statusReason,/external dependency/);
}

{
  const h=makeRuntime();
  const out=await h.runtime.consumeCycleReview({
    next_decision:"CONTINUE_5",worker:"A1",squad:"A",mission:{id:"m1"},passes_completed:5
  },{event,workerId:"A1"});
  assert.equal(out.action,"blocked");
  assert.equal(out.reason,"NEXT_QUEUE_REQUIRED");
  assert.equal(h.state.missions.m1.status,"blocked");
}

console.log("Titan autonomous runtime loop tests PASS");
