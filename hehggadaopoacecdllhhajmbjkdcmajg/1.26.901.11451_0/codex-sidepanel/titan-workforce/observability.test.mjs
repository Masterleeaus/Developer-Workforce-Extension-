import assert from "node:assert/strict";
import {
  TitanWorkforceEventLog,
  TitanWorkforceObservability,
  deriveWorkforceMetrics,
  replayWorkforceEvents
} from "./observability.js";

function e(id,type,at,missionId="M1",extra={}){
  return {id,sequence:Number(id.replace(/\D/g,""))||0,type,at,missionId,...extra};
}

{
  const state={};
  let t=1000;
  const log=new TitanWorkforceEventLog(state,{clock:()=>++t,maxEvents:100});
  const created=log.append({type:"MISSION_CREATED",missionId:"M1"});
  assert.equal(created.type,"MISSION_CREATED");
  assert.equal(state.eventLog.length,1);
  assert.throws(()=>log.append({id:created.id,type:"MISSION_CREATED",missionId:"M1"}),/Duplicate workforce event id/);
}

{
  const events=[
    e("e1","MISSION_CREATED",1000),
    e("e2","PROFILE_CAST",1100,"M1",{agentId:"A1",refs:{profiles:["crm","tenant-isolation"]}}),
    e("e3","PASS_DISPATCHED",1200,"M1",{agentId:"A1",cycleId:"C1",passNumber:1,ref:"M1/C1/A1/1"}),
    e("e4","PASS_COMPLETED",2200,"M1",{agentId:"A1",cycleId:"C1",passNumber:1,ref:"M1/C1/A1/1"}),
    e("e5","SUPERVISOR_REVIEW",2300),
    e("e6","DELTA_APPROVED",2400),
    e("e7","BUILDER_ASSIGNED",2500,"M1",{agentId:"BUILDER_A"}),
    e("e8","CODEX_COMPLETED",3500,"M1",{details:{status:"success"}}),
    e("e9","CI_VERIFIED",3600,"M1",{details:{status:"pass"}}),
    e("e10","ORCHESTRATOR_DECISION",3700,"M1",{details:{decision:"COMPLETE"}}),
    e("e11","RUNTIME_VERIFIED",3800,"M1",{details:{status:"pass"}}),
    e("e12","ACCEPTANCE_RESOLVED",3900,"M1",{details:{status:"pass"}}),
    e("e13","MISSION_COMPLETE",4000)
  ];
  const replay=replayWorkforceEvents(events);
  assert.equal(replay.ok,true);
  assert.equal(replay.missions.M1.status,"complete");
  assert.equal(replay.missions.M1.passes.completed,1);
  assert.deepEqual(replay.missions.M1.profileIds,["crm","tenant-isolation"]);
}

{
  const invalid=[
    e("e1","MISSION_CREATED",1000),
    e("e2","PASS_COMPLETED",1100)
  ];
  const replay=replayWorkforceEvents(invalid);
  assert.equal(replay.ok,false);
  assert.equal(replay.errors[0].code,"IMPOSSIBLE_TRANSITION");
  assert.throws(()=>replayWorkforceEvents(invalid,{strict:true}),err=>err.code==="EVENT_REPLAY_INVALID");
}

{
  const events=[
    e("e1","MISSION_CREATED",0),
    e("e2","PROFILE_CAST",100,"M1",{agentId:"A1"}),
    e("e3","PASS_DISPATCHED",1000,"M1",{agentId:"A1",cycleId:"C1",passNumber:1,ref:"p1"}),
    e("e4","PASS_COMPLETED",4000,"M1",{agentId:"A1",cycleId:"C1",passNumber:1,ref:"p1"}),
    e("e5","SUPERVISOR_REVIEW",4100),
    e("e6","REPAIR",4200),
    e("e7","ORCHESTRATOR_DECISION",4300,"M1",{details:{decision:"REPAIR"}}),
    e("e8","CI_VERIFIED",4400,"M1",{details:{status:"fail"}}),
    e("e9","MCP_FAILURE",4500),
    e("e10","TOOL_FAILURE",4600),
    e("e11","RETRY",4700),
    e("e12","CONTEXT_COMPILED",4800,"M1",{details:{characters:2400}}),
    e("e13","CODEX_COMPLETED",5000,"M1",{details:{status:"success"}}),
    e("e14","VERIFY",5100),
    e("e15","MISSION_COMPLETE",7100)
  ];
  const metrics=deriveWorkforceMetrics(events,{agents:Array.from({length:15},(_,i)=>({id:"X"+i})),nowAt:8000});
  assert.equal(metrics.passes.averageDurationMs,3000);
  assert.equal(metrics.reviews.count,1);
  assert.equal(metrics.ci.failureRate,1);
  assert.equal(metrics.failures.mcp,1);
  assert.equal(metrics.failures.tool,1);
  assert.equal(metrics.retries,1);
  assert.equal(metrics.context.characters,2400);
  assert.equal(metrics.profileSelections,1);
  assert.equal(metrics.missions.completed,1);
}

{
  const state={};
  let t=1000;
  const obs=new TitanWorkforceObservability(state,{clock:()=>++t});
  obs.recordAudit("mission-created",{missionId:"M1"});
  obs.recordAudit("mission-cast",{missionId:"M1",slotId:"A1",profiles:["architecture"]});
  obs.recordAudit("chat-pass-sent",{missionId:"M1",workerId:"A1",cycleId:"C1",passNumber:1,key:"k1"});
  obs.recordAudit("chat-pass-completed",{missionId:"M1",workerId:"A1",cycleId:"C1",passNumber:1,key:"k1"});
  obs.recordAudit("mission-transition:complete",{missionId:"M1"});
  const bundle=obs.exportBundle({agents:[{id:"A1"}]});
  assert.equal(bundle.schema,"titan-workforce-diagnostics/v1");
  assert.equal(bundle.replay.missions.M1.status,"complete");
  assert.equal(bundle.events.length,5);
  assert.ok(bundle.metrics.workerUtilization.ratio>0);
}

console.log("Titan workforce observability tests passed");
