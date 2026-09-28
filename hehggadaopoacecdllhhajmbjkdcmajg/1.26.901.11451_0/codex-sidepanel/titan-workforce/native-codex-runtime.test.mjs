import assert from "node:assert/strict";
await import("../../titan-work-codex-pipeline.js");
const {TitanWorkCodexRuntime}=await import("./work-codex-runtime.js");\nconst {TitanGitMissionSubstrate}=await import("./git-mission-substrate.js");

const pipeline=globalThis.TitanWorkCodexPipeline;
assert.ok(pipeline?.createCycleReview,"WP3 pipeline must be loaded");

function fixture({
 workDecision="READY_FOR_CODEX",
 includeDelta=true,
 orchestratorDecision="COMPLETE",
 githubTruth={commitExists:true,ciPassed:true,merged:true,presentOnMain:true,mergeCommit:"merge123",headSha:"abc"},
 capabilities=["codex.build","codex.orchestrate"]
}={}){
 const state={agents:{},missions:{},controls:{armed:true},workCodexRuntime:null,gitSubstrate:null};
 for(const id of ["SUPERVISOR_A","SUPERVISOR_B","BUILDER_A","BUILDER_B","ORCHESTRATOR"]){
  state.agents[id]={id,executionClass:id.startsWith("SUPERVISOR")?"work_supervisor":id.startsWith("BUILDER")?"codex_builder":"codex_orchestrator",status:"idle",missionId:null,profileIds:[]};
 }
 const mission={
  id:"mission-1",title:"Implement bounded change",goal:"Change one scoped file",
  repository:"Masterleeaus/example",branch:"issue-1/test",scopePaths:["src/**"],
  constraints:["preserve architecture"],acceptanceCriteria:[{id:"ac-1",text:"done",done:true}],
  verificationRequirements:[],runtimeRequirements:[],dependencies:[],status:"assigned"
 };
 state.missions[mission.id]=mission;
 const transitions=[];
 const missionControl={
  get:id=>state.missions[id]||null,
  list:()=>Object.values(state.missions),
  transition(id,status,reason){const m=state.missions[id];m.status=status;m.statusReason=reason;transitions.push({id,status,reason});return m}
 };
 const registry={
  get:id=>state.agents[id]||null,
  list:executionClass=>Object.values(state.agents).filter(x=>!executionClass||x.executionClass===executionClass)
 };
 const controller={registry,assignMission(missionId,slotId){const m=missionControl.get(missionId),slot=registry.get(slotId),old=m.assignedAgent;if(old&&old!==slotId){const prev=registry.get(old);if(prev&&prev.missionId===missionId)prev.missionId=null}slot.missionId=missionId;m.assignedAgent=slotId;return{mission:m,slot}}};
 const calls={work:0,build:0,orchestrate:0,save:0};
 const workResult={next_decision:workDecision,approved_findings:["finding"],...(includeDelta?{approved_delta:{required_changes:["edit scoped implementation"],scope_paths:["src/**"],expected_files:["src/feature.js"],tests:[{name:"unit",passed:true,status:"passed"}]}}:{})};
 const integration={
  controller,
  normalizePipelineMission:m=>({id:m.id,title:m.title,goal:m.goal,repository:m.repository,branch:m.branch,constraints:m.constraints||[],acceptance_criteria:m.acceptanceCriteria||[],runtime_requirements:m.runtimeRequirements||[],metadata:{}}),
  async requestWorkReview(_squad,request){calls.work++;assert.equal(request.output_contract.format,"json");return{parsed:workResult}},
  async dispatchCodexPacket(builderId,packet){calls.build++;assert.equal(builderId,"BUILDER_A");assert.equal(packet.builder_slot,"builder-a");return{files_changed:["src/feature.js"],diff:"diff --git a/src/feature.js b/src/feature.js",tests:[{name:"unit",passed:true,status:"passed"}],commit:{sha:"abc"},branch:{name:"issue-1/test"},pr:{number:1,url:"https://example.invalid/pr/1"},ci:{passed:true},blockers:[],remaining_implementation:[]}},
  async orchestrate(bundle){calls.orchestrate++;assert.equal(bundle.output_contract.format,"json");return{decision:orchestratorDecision,reason:"mock orchestrator"}}
 };
 const services={get(kind){if(kind==="codex")return{source:"native-mock",build(){},orchestrate(){}};if(kind==="github")return{verify:async()=>githubTruth};if(kind==="runtime")return null;return null}};
 const capabilitySet=new Set(capabilities),broker={has:name=>capabilitySet.has(name)},audit=[];
 const gitSubstrate=new TitanGitMissionSubstrate(state);gitSubstrate.acquire({missionId:mission.id,builderId:"BUILDER_A",branch:mission.branch,worktree:"/tmp/mission-1",scopePaths:mission.scopePaths});
 const runtime=new TitanWorkCodexRuntime({state,integration,missionControl,services,capabilities:broker,gitSubstrate,pipelineApi:pipeline,audit:(type,data)=>audit.push({type,data}),save:async()=>{calls.save++;return true}});
 const event={
  type:"supervisor_review_required",workerId:"A1",squad:"A",missionId:mission.id,cycleId:"cycle-1",
  detail:{completedPasses:[1,2,3,4,5].map(passNumber=>({passNumber,result:{text:"pass "+passNumber}}))}
 };
 const request=pipeline.adaptChatSupervisorReviewEvent(event,integration.normalizePipelineMission(mission));
 return{state,mission,missionControl,registry,integration,services,broker,runtime,event,request,calls,transitions,audit};
}

{
 const f=fixture();
 const result=await f.runtime.handleSupervisorBoundary({event:f.event,request:f.request,supervisorId:"SUPERVISOR_A",squad:"A"});
 assert.equal(result.stage,"orchestrator");
 assert.equal(result.decision.state,"COMPLETE");
 assert.equal(f.mission.status,"complete");
 assert.equal(f.calls.work,1);
 assert.equal(f.calls.build,1);
 assert.equal(f.calls.orchestrate,1);
 const run=f.runtime.snapshot().runs["mission-1"];
 assert.equal(run.cycleReviews.length,1);
 assert.equal(run.approvedDeltas.length,1);
 assert.equal(run.packets.length,1);
 assert.equal(run.builderResults.length,1);
 assert.equal(run.orchestratorDecisions.length,1);
 assert.equal(run.verification[0].type,"github");
 console.log("ok - Work READY_FOR_CODEX executes builder and orchestrator to COMPLETE");
}

{
 const f=fixture({capabilities:["codex.build"]});
 await assert.rejects(
  ()=>f.runtime.handleSupervisorBoundary({event:f.event,request:f.request,supervisorId:"SUPERVISOR_A",squad:"A"}),
  error=>error.code==="CODEX_EXECUTION_CAPABILITY_UNAVAILABLE"
 );
 assert.equal(f.mission.status,"blocked");
 assert.equal(f.calls.build,0);
 console.log("ok - missing orchestrate capability fails closed before build");
}

{
 const f=fixture({includeDelta:false});
 await assert.rejects(
  ()=>f.runtime.handleSupervisorBoundary({event:f.event,request:f.request,supervisorId:"SUPERVISOR_A",squad:"A"}),
  error=>error.code==="WORK_APPROVED_DELTA_REQUIRED"
 );
 assert.equal(f.mission.status,"blocked");
 assert.equal(f.calls.build,0);
 console.log("ok - READY_FOR_CODEX without structured approved delta is blocked");
}

{
 const f=fixture({githubTruth:{commitExists:true,ciPassed:false,merged:false,presentOnMain:false}});
 const result=await f.runtime.handleSupervisorBoundary({event:f.event,request:f.request,supervisorId:"SUPERVISOR_A",squad:"A"});
 assert.equal(result.decision.state,"VERIFY");
 assert.equal(f.mission.status,"verification");
 assert.equal(f.calls.orchestrate,1);
 console.log("ok - objective Git gates override optimistic COMPLETE to VERIFY");
}

{
 const f=fixture({orchestratorDecision:"REPAIR"});
 const result=await f.runtime.handleSupervisorBoundary({event:f.event,request:f.request,supervisorId:"SUPERVISOR_A",squad:"A"});
 assert.equal(result.decision.state,"REPAIR");
 assert.equal(f.mission.status,"repair");
 console.log("ok - orchestrator REPAIR routes back through Mission Control");
}

{
 const f=fixture({workDecision:"CONTINUE_5",includeDelta:false});
 const result=await f.runtime.handleSupervisorBoundary({event:f.event,request:f.request,supervisorId:"SUPERVISOR_A",squad:"A"});
 assert.equal(result.next.action,"research");
 assert.equal(f.mission.status,"research");
 assert.equal(f.calls.build,0);
 assert.equal(f.calls.orchestrate,0);
 console.log("ok - CONTINUE_5 returns to bounded research without Codex dispatch");
}

console.log("\nWork → Codex → Orchestrator runtime tests passed.");
