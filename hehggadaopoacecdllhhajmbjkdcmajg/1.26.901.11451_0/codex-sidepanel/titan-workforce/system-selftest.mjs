import {createRequire} from "node:module";
import {createWorkforceState,validateWorkforceStateDetailed} from "./state.js";
import {TitanMissionControl} from "./mission-control.js";
import {TitanWorkforceController} from "./controller.js";
import {verifyDiffScope} from "./scope-locks.js";
import {createVerificationState,recordGate,verificationDecision} from "./verification-plane.js";
import {staleWorkItems} from "./lifecycle.js";
import {conversationIdentity} from "./conversation-service.js";

const require=createRequire(import.meta.url);
const Profiles=require("../titan-agent-profiles.js");
const Chat=require("../../titan-workforce/chat-five-pass-scheduler.js");
const Pipeline=require("../../titan-work-codex-pipeline.js");

function assert(value,message){if(!value)throw new Error(message)}
const state=createWorkforceState();
const missions=new TitanMissionControl(state);
const controller=new TitanWorkforceController(state,{missionControl:missions});
let preflightBlocked=false;
try{controller.arm()}catch(error){preflightBlocked=error.code==="PREFLIGHT_REQUIRED"}
assert(preflightBlocked,"workforce armed before required preflight");
state.controls.preflightPassed=true;state.controls.preflightAt=Date.now();
controller.arm();assert(state.controls.armed===true,"workforce failed to arm after preflight");
controller.disarm("selftest");
const mission=missions.upsert({
 id:"system-selftest",
 title:"Verify 15-agent integration",
 goal:"Exercise deterministic zero-token workforce flow",
 repository:"example/repo",
 scope_paths:["src/system"],
 acceptance:["flow completes"],
 verificationRequirements:["browser","network"]
});
const cast=Profiles.selectProfilesForMission(mission,{executionClass:"chat_worker"});
const compiled=Profiles.compileProfileContext(cast,{executionClass:"chat_worker"});
assert(compiled.profileIds.length>0,"profile casting failed");
controller.assignMission(mission.id,"A1",{expectedExecutionClass:"chat_worker",profileIds:compiled.profileIds});
assert(validateWorkforceStateDetailed(state).ok,"canonical state invalid after assignment");

let now=0;const events=[];
const scheduler=new Chat.ChatFivePassScheduler({clock:()=>now,emit:event=>events.push(event)});
scheduler.startCycle("A1",{missionId:mission.id,cycleId:"cycle-1",queue:[1,2,3,4,5].map(n=>"pass "+n)});
let firstKey=null;
for(let pass=1;pass<=5;pass++){
 const worker=scheduler.getWorker("A1");now=worker.nextGateAt;
 const action=scheduler.inspectGate("A1",{busy:false});
 assert(action.action==="dispatch","expected dispatch at pass "+pass);
 if(pass===1)firstKey=action.key;
 scheduler.confirmDispatch("A1",action.key);
 if(pass===1){
   const before=scheduler.getWorker("A1").currentPass;
   let duplicateRejected=false;
   try{scheduler.confirmDispatch("A1",firstKey)}catch{duplicateRejected=true}
   assert(duplicateRejected,"duplicate dispatch confirmation was not rejected");
   assert(scheduler.getWorker("A1").currentPass===before,"duplicate dispatch changed pass state");
 }
 scheduler.completePass("A1",{summary:"completed "+pass});
}
const reviewEvent=events.find(e=>e.type==="supervisor_review_required");
assert(reviewEvent,"WP2 did not emit supervisor_review_required");
const reviewRequest=Pipeline.adaptChatSupervisorReviewEvent(reviewEvent,mission);
assert(reviewRequest.supervisor_slot==="supervisor-a","Squad A did not route to Supervisor A");

const cycleReview=Pipeline.createCycleReview({
 mission,worker:"A1",squad:"A",cycle:1,passes_completed:5,
 approved_findings:["bounded change"],next_decision:"READY_FOR_CODEX"
});
const delta=Pipeline.compileApprovedImplementationDelta({
 mission,cycle_reviews:[cycleReview],validated_findings:["bounded change"],
 required_changes:["implement system path"],scope_paths:["src/system"],
 expected_files:["src/system/index.js"],tests:[{name:"system",required:true}]
});
const packet=Pipeline.assignBuilder(delta,{},{
 "builder-a":{workload:0,repository:"example/repo"},
 "builder-b":{workload:1,repository:"example/repo"}
});
assert(packet.builder_slot==="builder-a","Builder A routing failed");
const builderResult=Pipeline.createBuilderResult({
 packet,files_changed:["src/system/index.js"],diff:"diff --git",
 tests:[{name:"system",passed:true}],commit:{sha:"abc"},branch:{name:"selftest"},
 pr:{number:1},ci:{passed:true}
});
const bundle=Pipeline.createOrchestratorBundle({
 mission,approved_deltas:[delta],builder_results:[builderResult],
 actual_git_diff:"diff --git",tests:[{name:"system",passed:true}],
 github_truth:{commitExists:true,ciPassed:true,merged:true,presentOnMain:true},
 runtime_evidence:{deployed:true,browserPassed:true,consoleClean:true,networkPassed:true,acceptancePassed:true},
 acceptance_evidence:{passed:true}
});
assert(Pipeline.decideOrchestrator(bundle).state==="COMPLETE","happy-path orchestrator did not COMPLETE");

const verifyBundle=Pipeline.createOrchestratorBundle({...bundle,github_truth:{commitExists:true,ciPassed:true,merged:false,presentOnMain:false}});
assert(Pipeline.decideOrchestrator(verifyBundle).state==="VERIFY","missing Git truth did not VERIFY");
const repairBundle=Pipeline.createOrchestratorBundle({...bundle,tests:[{name:"system",passed:false}]});
assert(Pipeline.decideOrchestrator(repairBundle).state==="REPAIR","failed tests did not REPAIR");
assert(Pipeline.decideOrchestrator(bundle,{research_required:true,research_request:{question:"why"}}).state==="RESEARCH","research route failed");
const blockedResult=Pipeline.createBuilderResult({packet,files_changed:[],blockers:["blocked"]});
const blockedBundle=Pipeline.createOrchestratorBundle({...bundle,builder_results:[blockedResult]});
assert(Pipeline.decideOrchestrator(blockedBundle).state==="BLOCKED","blocked builder did not BLOCK");

assert(!verifyDiffScope(["src/escape.js"],["src/system"]).ok,"scope violation was not rejected");

const usageScheduler=new Chat.ChatFivePassScheduler({clock:()=>0});
usageScheduler.startCycle("B1",{missionId:"usage",cycleId:"c1",queue:["1","2","3","4","5"]});
usageScheduler.markUsageRestricted("B1","restriction");
assert(usageScheduler.getWorker("B1").state===Chat.STATES.PAUSED,"usage restriction did not pause worker");

const ciState=createVerificationState("ci");
recordGate(ciState,"git",{status:"pass"});recordGate(ciState,"ci",{status:"fail",details:{message:"typescript typecheck failed"}});
assert(verificationDecision(ciState).decision==="REPAIR","CI failure did not route to repair");
const runtimeState=createVerificationState("runtime");
recordGate(runtimeState,"runtime",{status:"fail"});
assert(verificationDecision(runtimeState).decision==="VERIFY","runtime failure did not route to verification");

assert(conversationIdentity("https://example.com/c/not-chatgpt")===null,"identity guard accepted wrong origin");
const stale=staleWorkItems([{id:"branch-1",updatedAt:1,prOpen:true}],{now:4*3600000+1,staleMs:3*3600000});
assert(stale[0]?.reaperAction==="finish-or-merge","stale work item route failed");

console.log("Titan 15-agent system self-test PASS");
