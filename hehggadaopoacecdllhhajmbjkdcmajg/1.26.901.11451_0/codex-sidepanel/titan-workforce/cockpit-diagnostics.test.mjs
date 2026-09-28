import assert from "node:assert/strict";
import fs from "node:fs";
import {buildCockpitDiagnostics} from "./cockpit-diagnostics.js";
import {TitanRuntimeOwner} from "./runtime-owner.js";

const agents={
 A1:{id:"A1",executionClass:"chat_worker",squad:"A",status:"waiting-gate",health:"ready",missionId:"m1",profileIds:["crm"],conversation:{tabId:11,title:"Chat A1",key:"https://chatgpt.com/c/a1"},control:{paused:false,quarantined:false,emergencyStopped:false}},
 SUPERVISOR_A:{id:"SUPERVISOR_A",executionClass:"work_supervisor",squad:"A",status:"reviewing",health:"ready",missionId:"m1",profileIds:["mission-planning"],conversation:{tabId:12,title:"Supervisor A",key:"https://chatgpt.com/c/supa"},control:{}},
 BUILDER_A:{id:"BUILDER_A",executionClass:"codex_builder",status:"building",health:"ready",missionId:"m1",profileIds:["git-worktrees"],control:{}},
 BUILDER_B:{id:"BUILDER_B",executionClass:"codex_builder",status:"idle",health:"ready",missionId:null,profileIds:[],control:{paused:true}},
 ORCHESTRATOR:{id:"ORCHESTRATOR",executionClass:"codex_orchestrator",status:"reviewing",health:"ready",missionId:"m1",profileIds:["final-mission-qa"],control:{}}
};
const state={
 controls:{armed:true,emergencyStop:false},
 agents,
 missions:{m1:{id:"m1",title:"Mission One",status:"verification"}},
 chatScheduler:{workers:{A1:{cycleId:"m1-cycle-2",currentPass:3,completedPasses:[{passNumber:1},{passNumber:2}],nextGateAt:Date.now()+120000,state:"WAITING_GATE",slowdown:"normal",conversationIdentity:"https://chatgpt.com/c/a1"}}},
 chatRuntime:{pendingReviews:{r1:{id:"r1",supervisorId:"SUPERVISOR_A",workerId:"A1",cycleId:"m1-cycle-1",missionId:"m1",status:"awaiting-result",updatedAt:Date.now()}}},
 pipeline:{
  builders:{BUILDER_A:{branch:"agent/m1",pr:{number:44},ci:{status:"success"},packetId:"p1",phase:"building"}},
  orchestrator:{phase:"reviewing",decision:{state:"VERIFY"},missionId:"m1"}
 },
 lifecycle:{mergePressure:{state:"throttled"}}
};
const registry={list:()=>Object.values(agents),get:id=>agents[id]||null};
const api={
 state,
 controller:{registry},
 missions:{list:()=>Object.values(state.missions)},
 services:{status:()=>({chat:{available:true,source:"conversation"},work:{available:true,source:"conversation"},codex:{available:true,source:"native"}})},
 integration:{readiness:()=>({profiles:true,chat:true,pipeline:true})},
 mergeController:{state:{state:"throttled",active:2}},
 usageGovernor:{status:()=>({state:"normal",policy:{chatConcurrency:10,codexConcurrency:2,contextScale:1}})}
};

const d=buildCockpitDiagnostics(api);
assert.equal(d.topology.total,5);
assert.equal(d.nativeExecution.buildersReady,true);
assert.equal(d.verification.count,1);
const a1=d.agents.find(x=>x.id==="A1");
assert.equal(a1.chat.cycleId,"m1-cycle-2");
assert.equal(a1.chat.pass,3);
assert.equal(a1.chat.completedPasses,2);
assert(a1.chat.nextGateAt);
assert.deepEqual(a1.profileIds,["crm"]);
const sup=d.agents.find(x=>x.id==="SUPERVISOR_A");
assert.equal(sup.supervisor.reviewStatus,"awaiting-result");
assert.equal(sup.supervisor.workerId,"A1");
const builder=d.agents.find(x=>x.id==="BUILDER_A");
assert.equal(builder.builder.branch,"agent/m1");
assert.equal(builder.builder.pr.number,44);
assert.equal(builder.builder.ci.status,"success");
const builderB=d.agents.find(x=>x.id==="BUILDER_B");
assert.equal(builderB.state,"paused");
const orch=d.agents.find(x=>x.id==="ORCHESTRATOR");
assert.equal(orch.orchestrator.decision.state,"VERIFY");
assert.deepEqual(d.mergePressure,{state:"throttled",active:2});

const calls=[];
const runtimeApi={
 ...api,
 state:JSON.parse(JSON.stringify(state)),
 missions:{list:()=>Object.values(state.missions),upsert:m=>m},
 mcp:{status:()=>({count:0,online:0,tools:0})},
 capabilities:{status:()=>({count:0,healthy:0,failing:0})},
 integration:{readiness:()=>({chat:true})},
 diagnostics:()=>d,
 usageGovernor:{status:()=>null},
 mergeController:{state:null},
 lifecycle:null,
 controller:{
  registry,
  arm:()=>true,disarm:()=>true,emergencyStop:()=>true,clearEmergencyStop:()=>true,markReconciled:()=>true
 },
 controls:{
  pauseAgent:(id,reason)=>(calls.push(["pauseAgent",id,reason]),agents[id]),
  resumeAgent:id=>(calls.push(["resumeAgent",id]),agents[id]),
  quarantine:(id,reason)=>(calls.push(["quarantine",id,reason]),agents[id]),
  unquarantine:(id,o)=>(calls.push(["unquarantine",id,o]),agents[id]),
  pauseSquad:(squad,reason)=>(calls.push(["pauseSquad",squad,reason]),[]),
  resumeSquad:squad=>(calls.push(["resumeSquad",squad]),[])
 },
 liveChat:{bindConversation:async()=>true,startCycle:async()=>true,submitCycleReview:async()=>true,tick:async()=>{}},
 bindAgentConversation:async(id,tabId)=>(calls.push(["bind",id,tabId]),{id,tabId}),
 save:async()=>true
};
const tabs={
 async query(){return[
  {id:21,title:"Mission chat",url:"https://chatgpt.com/c/abc",active:true,windowId:1},
  {id:22,title:"ChatGPT home",url:"https://chatgpt.com/",active:false,windowId:1},
  {id:23,title:"Other",url:"https://example.com/c/nope",active:false,windowId:1},
  {id:24,title:"Supervisor",url:"https://chatgpt.com/c/sup",active:false,windowId:1}
 ]}
};
const owner=new TitanRuntimeOwner({createRuntime:async()=>runtimeApi,tabs,alarms:null});
let response=await owner.command("discoverConversations");
assert.equal(response.result.length,2);
assert.equal(response.result[0].tabId,21);
assert.equal(response.result[0].key,"https://chatgpt.com/c/abc");
await owner.command("bindAgentConversation",{id:"SUPERVISOR_A",tabId:24});
await owner.command("pauseSquad",{squad:"A",reason:"test"});
await owner.command("resumeSquad",{squad:"A"});
await owner.command("quarantineAgent",{id:"A1",reason:"test"});
await owner.command("unquarantineAgent",{id:"A1",approved:true});
response=await owner.command("diagnostics");
assert.equal(response.result.verification.count,1);
assert(calls.some(x=>x[0]==="bind"&&x[1]==="SUPERVISOR_A"&&x[2]===24));
assert(calls.some(x=>x[0]==="pauseSquad"));
assert(calls.some(x=>x[0]==="quarantine"));

const client=fs.readFileSync(new URL("./sidepanel-client.js",import.meta.url),"utf8");
for(const action of ["discoverConversations","bindAgentConversation","pauseSquad","resumeSquad","quarantineAgent","unquarantineAgent","diagnostics","preflight"]){
 assert(client.includes(action),"sidepanel missing "+action);
}
assert(!/Titan5x5|titan5x5/.test(client),"v4 cockpit must not depend on legacy 5x5 globals");
assert(client.includes("Chat workers"));
assert(client.includes("Work supervisors"));
assert(client.includes("Codex builders"));
assert(client.includes("Codex orchestrator"));

console.log("Titan cockpit diagnostics/control tests PASS");
