import {CHAT_SLOTS,SUPERVISOR_SLOTS,BUILDER_SLOTS,ORCHESTRATOR_SLOTS,SLOT_IDS,SLOT_CLASS} from "./constants.js";
import {createWorkforceState,validateWorkforceState,normalizeWorkforceState,validateWorkforceStateDetailed} from "./state.js";
import {migrateLegacy5x5,migrateWorkforceState} from "./migrations.js";

function assert(x,m){if(!x)throw new Error(m)}
assert(SLOT_IDS.length===15,"expected 15 slots");
for(const id of CHAT_SLOTS)assert(SLOT_CLASS[id]==="chat_worker",id+" class");
for(const id of SUPERVISOR_SLOTS)assert(SLOT_CLASS[id]==="work_supervisor",id+" class");
for(const id of BUILDER_SLOTS)assert(SLOT_CLASS[id]==="codex_builder",id+" class");
for(const id of ORCHESTRATOR_SLOTS)assert(SLOT_CLASS[id]==="codex_orchestrator",id+" class");
const s=createWorkforceState();assert(validateWorkforceState(s),"fresh state invalid");
const m=migrateLegacy5x5({workerTabs:[11,12,13,14,15],missions:[{id:"m1"},null,null,null,null],auditLog:[{type:"legacy"}]});
assert(m.agents.A1.conversation.legacyTabId===11,"legacy tab not migrated");
assert(m.agents.A1.missionId==="m1","legacy mission not migrated");
assert(m.legacy.auditLog.length===1,"legacy audit lost");

const hardenedLegacy={
 enabled:true,armed:true,workerTabs:[101,102,103,104,105],counts:[5,10,15,20,25],lastSeen:[1001,1002,1003,1004,1005],
 missions:[{id:"legacy-active",title:"Active legacy",status:"working"},null,null,null,null],
 workerHealth:[{status:"ready"},{status:"busy"},null,null,null],
 reviewQueue:[{key:"rq-1",worker:0}],activeReview:{key:"active-review",worker:0},reviewHistory:[{key:"rh-1"}],reviewAttempts:{"rq-1":2},
 ownershipLeases:[{resource:"src/a.js",worker:0},{resource:"src/b.js",worker:1}],
 missionQueue:[{id:"queued-legacy",title:"Queued"}],missionHistory:[{id:"history-legacy",title:"History",status:"verified",assignedAgent:"W2"}],
 dispatch:{minGapMs:1500,maxConcurrent:3,pending:[{worker:1,kind:"next"}]},checkpoints:[{missionId:"legacy-active",pass:5},null,null,null,null],
 convergence:{round:3,history:[{round:2}]},auditLog:[{type:"legacy-audit"}],recovery:{unclean:true,reconciled:false},
 workerIdentity:[{origin:"https://chatgpt.com",conversationId:"abc",key:"https://chatgpt.com/c/abc",tabId:101},null,null,null,null],
 sendLedger:[{key:"legacy-send-1"}],approvals:[{id:"legacy-approval-1",type:"scope-expansion",approved:true}],
 reviewScheduler:{cursor:2},utilization:{target:3,grants:9}
};
const hardened=migrateLegacy5x5(hardenedLegacy);
assert(hardened.controls.armed===false&&hardened.recovery.migration.needsReconciliation===true,"migration must disarm and require reconciliation");
assert(hardened.legacy.rawState.workerIdentity[0].conversationId==="abc","raw legacy snapshot lost");
assert(hardened.agents.A1.conversation.key==="https://chatgpt.com/c/abc"&&hardened.agents.A1.checkpoint.pass===5,"identity/checkpoint mapping");
assert(hardened.legacy.compatibility.ownershipLeases[0].agentId==="A1"&&hardened.legacy.compatibility.ownershipLeases[1].agentId==="A2","zero-based lease ownership mapping");
assert(hardened.legacy.compatibility.review.active.key==="active-review"&&hardened.legacy.compatibility.review.attempts["rq-1"]===2,"review recovery evidence lost");
assert(hardened.legacy.compatibility.dispatch.maxConcurrent===3&&hardened.legacy.compatibility.convergence.round===3,"dispatch/convergence evidence lost");
assert(hardened.legacy.compatibility.recovery.unclean===true&&hardened.legacy.compatibility.utilization.target===3,"recovery/utilization evidence lost");
assert(hardened.legacy.compatibility.approvals[0].migrationId==="legacy-approval-1"&&hardened.legacy.compatibility.sendLedger[0].key==="legacy-send-1","approval/send evidence lost");
assert(hardened.missions["queued-legacy"].assignedAgent===null&&hardened.missions["history-legacy"].assignedAgent===null,"stale legacy assignment retained");
assert(validateWorkforceStateDetailed(hardened).ok,"lossless migration must produce valid v4 state");
const reloaded=migrateWorkforceState(hardened);
assert(reloaded.legacy.compatibility.ownershipLeases.length===2&&reloaded.legacy.rawState.sendLedger.length===1,"migration reload must be idempotent");

import {normalizeMissionContract} from "./mission-contract.js";
import {pathAllowed,verifyDiffScope,requireScopeExpansion,verifyApprovedExpansion} from "./scope-locks.js";
import {TitanProvenanceGraph,createProvenanceNode} from "./provenance.js";
import {TitanMissionControl} from "./mission-control.js";
const mc=new TitanMissionControl(s);
const mission=mc.upsert({id:"scope1",title:"Scoped mission",scope_paths:["src/titan-go/**","tests/*.test.js"],acceptance:["works"]});
assert(mission.scopePaths[0]==="src/titan-go/**","scope normalization");
assert(verifyDiffScope(["src/titan-go/a.js","tests/x.test.js"],mission.scopePaths).ok,"valid scope rejected");
const bad=verifyDiffScope(["src/titan-go/a.js","src/auth/x.js"],mission.scopePaths);assert(!bad.ok&&bad.violations[0]==="src/auth/x.js","scope violation missed");
assert(pathAllowed("src/pipeline/index.js",["src/pipeline"]),"plain directory subtree");
assert(pathAllowed("src\\pipeline\\deep\\file.js",["src\\pipeline"]),"Windows scope normalization");
assert(pathAllowed("tests/unit.test.js",["tests/*.test.js"]),"single glob");
assert(!pathAllowed("tests/nested/unit.test.js",["tests/*.test.js"]),"single glob crossed segment");
assert(pathAllowed("src/deep/nested/file.js",["src/**"]),"double glob");
assert(!pathAllowed("src-other/file.js",["src"]),"sibling escape");
const traversalScope=verifyDiffScope(["src/pipeline/../auth/x.js"],["src/pipeline"]);assert(!traversalScope.ok&&traversalScope.invalid.some(x=>x.kind==="changed-path"),"traversal fail closed");
const packetFixture={packet_id:"scope-packet",mission:{id:"scope1"},scope_paths:["src/titan-go"]},req=requireScopeExpansion(packetFixture,["src/auth/x.js"],{now:100});
let missing=false;try{verifyApprovedExpansion(packetFixture,["src/auth/x.js"],req,null,{now:150})}catch(e){missing=e.code==="SCOPE_EXPANSION_NOT_APPROVED"}assert(missing,"missing approval allowed");
let expired=false;try{verifyApprovedExpansion(packetFixture,["src/auth/x.js"],req,{approved:true,requestId:req.id,missionId:"scope1",expiresAt:149},{now:150})}catch(e){expired=e.code==="SCOPE_EXPANSION_APPROVAL_EXPIRED"}assert(expired,"expired approval allowed");
const applied=verifyApprovedExpansion(packetFixture,["src/auth/x.js"],req,{id:"approval-1",approved:true,requestId:req.id,missionId:"scope1",expiresAt:500},{now:150});assert(applied.verification.ok&&applied.target.scope_paths.includes("src/auth/x.js"),"approved expansion not applied");

const pg=new TitanProvenanceGraph(s);pg.add(createProvenanceNode({id:"p1",type:"chat-cycle",missionId:"scope1"}));pg.add(createProvenanceNode({id:"p2",type:"approved-delta",missionId:"scope1",parentIds:["p1"]}));
assert(pg.ancestry("p2").length===2,"provenance ancestry failed");


import {TitanExecutionServices} from "./execution-services.js";
import {classifyCIFailure,recoveryRoute} from "./ci-failures.js";
import {createVerificationState,recordGate,verificationDecision} from "./verification-plane.js";
const services=new TitanExecutionServices();services.register("github",{capabilities:["truth"]});assert(services.available("github"),"service registry");
assert(classifyCIFailure({message:"tenant isolation integration test failed"})==="TENANT_ISOLATION_FAILURE","CI taxonomy");
const vv=createVerificationState("scope1");recordGate(vv,"git",{status:"pass"});recordGate(vv,"ci",{status:"fail",details:{message:"typescript typecheck failed"}});
const vd=verificationDecision(vv);assert(vd.decision==="REPAIR"&&vd.failureType==="TYPE_FAILURE","verification recovery route");


const repairMissing=createWorkforceState();delete repairMissing.agents.A5;const repairedMissing=normalizeWorkforceState(repairMissing);assert(repairedMissing.agents.A5?.id==="A5","missing slot repair");assert(repairedMissing.recovery.stateRepair.issues.some(x=>x.code==="MISSING_SLOT"),"missing slot diagnostic");
const repairClass=createWorkforceState();repairClass.controls.armed=true;repairClass.agents.A1.executionClass="codex_builder";repairClass.agents.A1.squad="B";const repairedClass=normalizeWorkforceState(repairClass);assert(repairedClass.agents.A1.executionClass==="chat_worker"&&repairedClass.agents.A1.squad==="A","canonical class/squad repair");assert(repairedClass.agents.A1.control.quarantined&&repairedClass.controls.armed===false,"severe repair safety");
const repairMission=createWorkforceState();repairMission.missions=[];const repairedMission=normalizeWorkforceState(repairMission);assert(!Array.isArray(repairedMission.missions),"mission map repair");assert(repairedMission.recovery.stateRepair.rawSnapshot!=null,"severe repair snapshot");
const half=createWorkforceState();half.missions.hm={id:"hm",title:"half",status:"assigned",assignedAgent:"A3"};const repairedHalf=normalizeWorkforceState(half);assert(repairedHalf.agents.A3.missionId==="hm","mission reverse reference repair");assert(validateWorkforceStateDetailed(repairedHalf).ok,"half assignment validates");
const dup=createWorkforceState();dup.controls.armed=true;dup.missions.dm={id:"dm",title:"dup",status:"assigned",assignedAgent:"A1"};dup.agents.A1.missionId="dm";dup.agents.A1.status="assigned";dup.agents.A2.missionId="dm";dup.agents.A2.status="assigned";const repairedDup=normalizeWorkforceState(dup);assert(repairedDup.missions.dm.assignedAgent===null&&repairedDup.agents.A1.missionId===null&&repairedDup.agents.A2.missionId===null,"duplicate assignment cleared");assert(repairedDup.agents.A1.control.quarantined&&repairedDup.agents.A2.control.quarantined&&!repairedDup.controls.armed,"duplicate assignment quarantined");
const interrupted=createWorkforceState();interrupted.controls=null;interrupted.provenance=[];interrupted.agents.B2.missionId=99;const repairedInterrupted=normalizeWorkforceState(interrupted);assert(repairedInterrupted.controls&&repairedInterrupted.controls.armed===false,"controls recreated");assert(!Array.isArray(repairedInterrupted.provenance),"provenance repaired");assert(repairedInterrupted.agents.B2.missionId===null&&repairedInterrupted.agents.B2.control.quarantined,"invalid mission reference quarantined");

console.log("Titan Workforce Core self-test PASS");
