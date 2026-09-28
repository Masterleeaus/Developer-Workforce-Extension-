import {CHAT_SLOTS,SUPERVISOR_SLOTS,BUILDER_SLOTS,ORCHESTRATOR_SLOTS,SLOT_IDS,SLOT_CLASS} from "./constants.js";
import {createWorkforceState,validateWorkforceState} from "./state.js";
import {migrateLegacy5x5} from "./migrations.js";

function assert(x,m){if(!x)throw new Error(m)}
assert(SLOT_IDS.length===15,"expected 15 slots");
for(const id of CHAT_SLOTS)assert(SLOT_CLASS[id]==="chat_worker",id+" class");
for(const id of SUPERVISOR_SLOTS)assert(SLOT_CLASS[id]==="work_supervisor",id+" class");
for(const id of BUILDER_SLOTS)assert(SLOT_CLASS[id]==="codex_builder",id+" class");
for(const id of ORCHESTRATOR_SLOTS)assert(SLOT_CLASS[id]==="codex_orchestrator",id+" class");
const s=createWorkforceState();assert(validateWorkforceState(s),"fresh state invalid");
const hardenedLegacy={
 enabled:true,armed:true,emergencyStop:true,lastArmAt:900,
 workerTabs:[101,102,103,104,105],
 workerIdentity:[{origin:"https://chatgpt.com",conversationId:"abc",key:"https://chatgpt.com/c/abc",tabId:101},null,null,null,null],
 missions:[{id:"m1",title:"Legacy active"},null,null,null,null],
 counts:[5,0,0,0,0],lastSeen:[1001,0,0,0,0],
 workerHealth:[{status:"ready"},null,null,null,null],
 reviewQueue:[{key:"rq1"}],activeReview:{key:"active1"},reviewHistory:[{key:"rh1"}],reviewAttempts:{rq1:2},
 ownershipLeases:[{resource:"src/a.js",worker:0}],approvals:[{id:"ap1",approved:true}],
 missionQueue:[{id:"queued1",title:"Queued"}],missionHistory:[{id:"history1",title:"History",status:"verified"}],
 dispatch:{maxConcurrent:3,pending:[{id:"p1"}]},checkpoints:[{missionId:"m1",pass:5},null,null,null,null],
 convergence:{round:3},recovery:{unclean:true,reconciled:false},reviewScheduler:{cursor:2,lastGrantedAt:[5,0,0,0,0]},
 utilization:{target:3,lastAdvanceAt:[1,0,0,0,0]},auditLog:[{type:"legacy"}],sendLedger:[{key:"send1"}]
};
const m=migrateLegacy5x5(hardenedLegacy);
assert(m.agents.A1.conversation.key==="https://chatgpt.com/c/abc","legacy identity not migrated");
assert(m.agents.A1.conversation.legacyTabId===101,"legacy tab not retained");
assert(m.agents.A1.missionId==="m1","legacy mission not migrated");
assert(m.agents.A1.checkpoint.pass===5,"legacy checkpoint not mapped");
assert(m.agents.A1.health==="ready","legacy health not mapped");
assert(m.agents.A1.legacyRuntime.passCount===5&&m.agents.A1.legacyRuntime.lastSeen===1001,"legacy counters not mapped");
assert(m.agents.A1.control.paused===true,"legacy active slot must be paused for reconciliation");
assert(m.missions.queued1?.assignedAgent===null&&m.missions.history1?.assignedAgent===null,"legacy queue/history not imported safely");
assert(m.legacy.compatibility.review.active.key==="active1","legacy active review lost");
assert(m.legacy.compatibility.review.history.length===1&&m.legacy.compatibility.review.attempts.rq1===2,"legacy review history/attempts lost");
assert(m.legacy.compatibility.ownershipLeases[0].agentId==="A1","legacy lease worker not canonicalized");
assert(m.legacy.compatibility.approvals[0].migrationId==="ap1","legacy approval lost");
assert(m.legacy.compatibility.dispatch.maxConcurrent===3,"legacy dispatch state lost");
assert(m.legacy.compatibility.convergence.round===3,"legacy convergence lost");
assert(m.legacy.compatibility.recovery.unclean===true,"legacy recovery lost");
assert(m.legacy.compatibility.reviewScheduler.cursor===2,"legacy review scheduler lost");
assert(m.legacy.compatibility.utilization.target===3,"legacy utilization lost");
assert(m.legacy.auditLog.length===1&&m.legacy.sendLedger.length===1,"legacy audit/send ledger lost");
assert(m.legacy.rawState.workerIdentity[0].conversationId==="abc","complete raw legacy snapshot not retained");
assert(m.controls.armed===false&&m.controls.emergencyStop===false&&m.controls.requiresReconciliation===true,"v4 must force disarmed reconciliation");
const remigrated=migrateWorkforceState(m);
assert(remigrated===m,"current-schema migrated state must be idempotent");

import {normalizeMissionContract} from "./mission-contract.js";
import {verifyDiffScope} from "./scope-locks.js";
import {TitanProvenanceGraph,createProvenanceNode} from "./provenance.js";
import {TitanMissionControl} from "./mission-control.js";
const mc=new TitanMissionControl(s);
const mission=mc.upsert({id:"scope1",title:"Scoped mission",scope_paths:["src/titan-go/**","tests/*.test.js"],acceptance:["works"]});
assert(mission.scopePaths[0]==="src/titan-go/**","scope normalization");
assert(verifyDiffScope(["src/titan-go/a.js","tests/x.test.js"],mission.scopePaths).ok,"valid scope rejected");
const bad=verifyDiffScope(["src/titan-go/a.js","src/auth/x.js"],mission.scopePaths);assert(!bad.ok&&bad.violations[0]==="src/auth/x.js","scope violation missed");
const pg=new TitanProvenanceGraph(s);pg.add(createProvenanceNode({id:"p1",type:"chat-cycle",missionId:"scope1"}));pg.add(createProvenanceNode({id:"p2",type:"approved-delta",missionId:"scope1",parentIds:["p1"]}));
assert(pg.ancestry("p2").length===2,"provenance ancestry failed");


import {TitanExecutionServices} from "./execution-services.js";
import {classifyCIFailure,recoveryRoute} from "./ci-failures.js";
import {createVerificationState,recordGate,verificationDecision} from "./verification-plane.js";
const services=new TitanExecutionServices();services.register("github",{capabilities:["truth"]});assert(services.available("github"),"service registry");
assert(classifyCIFailure({message:"tenant isolation integration test failed"})==="TENANT_ISOLATION_FAILURE","CI taxonomy");
const vv=createVerificationState("scope1");recordGate(vv,"git",{status:"pass"});recordGate(vv,"ci",{status:"fail",details:{message:"typescript typecheck failed"}});
const vd=verificationDecision(vv);assert(vd.decision==="REPAIR"&&vd.failureType==="TYPE_FAILURE","verification recovery route");

console.log("Titan Workforce Core self-test PASS");
