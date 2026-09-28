import {CHAT_SLOTS,SUPERVISOR_SLOTS,BUILDER_SLOTS,ORCHESTRATOR_SLOTS,SLOT_IDS,SLOT_CLASS} from "./constants.js";
import {canonicalSlotId,canonicalSupervisorForSquad,canonicalizePipelineSlot} from "./slot-id-adapter.js";
import {createWorkforceState,normalizeWorkforceState,validateWorkforceState,validateWorkforceStateDetailed} from "./state.js";
import {migrateLegacy5x5,migrateWorkforceState} from "./migrations.js";

function assert(x,m){if(!x)throw new Error(m)}
assert(SLOT_IDS.length===15,"expected 15 slots");
for(const id of CHAT_SLOTS)assert(SLOT_CLASS[id]==="chat_worker",id+" class");
for(const id of SUPERVISOR_SLOTS)assert(SLOT_CLASS[id]==="work_supervisor",id+" class");
for(const id of BUILDER_SLOTS)assert(SLOT_CLASS[id]==="codex_builder",id+" class");
for(const id of ORCHESTRATOR_SLOTS)assert(SLOT_CLASS[id]==="codex_orchestrator",id+" class");
const s=createWorkforceState();assert(validateWorkforceState(s),"fresh state invalid");

const cleanForward=createWorkforceState();cleanForward.futureFeature={version:7,enabled:true};
const cleanForwardNormalized=normalizeWorkforceState(cleanForward);
assert(cleanForwardNormalized.futureFeature?.version===7,"unknown forward-compatible top-level field should be preserved");
assert(validateWorkforceStateDetailed(cleanForwardNormalized).ok,"normalized clean state should validate");

const truncated=migrateWorkforceState({schemaVersion:4});
assert(validateWorkforceState(truncated),"truncated current-schema state must be repaired to valid");
assert(Object.keys(truncated.agents).length===15,"truncated state must recreate 15 slots");
assert(truncated.controls.armed===false,"truncated state must be disarmed");
assert(truncated.recovery.stateRepair.repaired===true&&truncated.recovery.stateRepair.severe===true,"truncated state repair should be recorded as severe");
assert(truncated.recovery.stateRepair.rawSnapshot!=null,"severe repair must retain raw snapshot");

const missingSlotFixture=createWorkforceState();delete missingSlotFixture.agents.A5;
const repairedMissingSlot=normalizeWorkforceState(missingSlotFixture);
assert(repairedMissingSlot.agents.A5?.id==="A5","missing slot must be recreated");
assert(repairedMissingSlot.recovery.stateRepair.issues.some(x=>x.code==="MISSING_SLOT"&&x.slotId==="A5"),"missing slot repair should be diagnosed");

const wrongClassFixture=createWorkforceState();wrongClassFixture.controls.armed=true;wrongClassFixture.agents.A1.executionClass="codex_builder";wrongClassFixture.agents.A1.squad="B";
const repairedWrongClass=normalizeWorkforceState(wrongClassFixture);
assert(repairedWrongClass.agents.A1.executionClass==="chat_worker"&&repairedWrongClass.agents.A1.squad==="A","canonical slot class/squad must be restored");
assert(repairedWrongClass.agents.A1.control.quarantined===true,"repaired canonical slot corruption must quarantine affected slot");
assert(repairedWrongClass.controls.armed===false,"severe slot corruption must force DISARMED");

const malformedMissionFixture=createWorkforceState();malformedMissionFixture.missions=[];
const repairedMalformedMissions=normalizeWorkforceState(malformedMissionFixture);
assert(!Array.isArray(repairedMalformedMissions.missions)&&typeof repairedMalformedMissions.missions==="object","malformed mission map must be repaired");
assert(repairedMalformedMissions.recovery.stateRepair.issues.some(x=>x.code==="MALFORMED_MISSIONS"),"malformed mission repair should be diagnosed");

const halfAssignment=createWorkforceState();
halfAssignment.missions.mhalf={id:"mhalf",title:"half",status:"assigned",assignedAgent:"A3"};
const repairedHalf=normalizeWorkforceState(halfAssignment);
assert(repairedHalf.agents.A3.missionId==="mhalf","mission-side half assignment should repair slot reverse reference");
assert(validateWorkforceStateDetailed(repairedHalf).ok,"repaired half assignment must validate");

const reverseHalf=createWorkforceState();
reverseHalf.missions.mreverse={id:"mreverse",title:"reverse",status:"assigned",assignedAgent:null};
reverseHalf.agents.B1.missionId="mreverse";reverseHalf.agents.B1.status="assigned";
const repairedReverse=normalizeWorkforceState(reverseHalf);
assert(repairedReverse.missions.mreverse.assignedAgent==="B1","slot-side half assignment should repair mission reverse reference");
assert(validateWorkforceStateDetailed(repairedReverse).ok,"repaired reverse assignment must validate");

const duplicateAssignment=createWorkforceState();duplicateAssignment.controls.armed=true;
duplicateAssignment.missions.mdup={id:"mdup",title:"dup",status:"assigned",assignedAgent:"A1"};
duplicateAssignment.agents.A1.missionId="mdup";duplicateAssignment.agents.A1.status="assigned";
duplicateAssignment.agents.A2.missionId="mdup";duplicateAssignment.agents.A2.status="assigned";
const repairedDuplicate=normalizeWorkforceState(duplicateAssignment);
assert(repairedDuplicate.missions.mdup.assignedAgent===null,"ambiguous duplicate mission assignment must be cleared");
assert(repairedDuplicate.agents.A1.missionId===null&&repairedDuplicate.agents.A2.missionId===null,"duplicate slot mission references must be cleared");
assert(repairedDuplicate.agents.A1.control.quarantined&&repairedDuplicate.agents.A2.control.quarantined,"ambiguous duplicate assignment must quarantine affected slots");
assert(repairedDuplicate.controls.armed===false,"ambiguous duplicate assignment must force DISARMED");
assert(validateWorkforceStateDetailed(repairedDuplicate).ok,"post-quarantine duplicate repair must validate");

const interruptedWrite=createWorkforceState();interruptedWrite.controls=null;interruptedWrite.provenance=[];interruptedWrite.agents.B2.missionId=99;
const repairedInterrupted=normalizeWorkforceState(interruptedWrite);
assert(repairedInterrupted.controls&&repairedInterrupted.controls.armed===false,"missing controls must be recreated");
assert(!Array.isArray(repairedInterrupted.provenance),"malformed provenance must be repaired");
assert(repairedInterrupted.agents.B2.missionId===null&&repairedInterrupted.agents.B2.control.quarantined,"invalid slot mission value must be cleared and quarantined");
assert(repairedInterrupted.recovery.stateRepair.rawSnapshot!=null,"interrupted severe write must retain raw snapshot");
assert(canonicalSlotId("supervisor-a")==="SUPERVISOR_A","supervisor-a mapping");
assert(canonicalSlotId("supervisor-b")==="SUPERVISOR_B","supervisor-b mapping");
assert(canonicalSlotId("builder-a",{expectedExecutionClass:"codex_builder"})==="BUILDER_A","builder-a mapping");
assert(canonicalSlotId("builder-b",{expectedExecutionClass:"codex_builder"})==="BUILDER_B","builder-b mapping");
assert(canonicalSupervisorForSquad("A")==="SUPERVISOR_A","squad A supervisor mapping");
assert(canonicalSupervisorForSquad("b")==="SUPERVISOR_B","squad B supervisor mapping");
let badSlot=false;try{canonicalSlotId("builder-z")}catch(e){badSlot=e.code==="INVALID_AGENT_SLOT"}assert(badSlot,"unknown slot must fail closed");
let wrongClass=false;try{canonicalizePipelineSlot("builder-a","work_supervisor")}catch(e){wrongClass=e.code==="INVALID_AGENT_SLOT"}assert(wrongClass,"execution class mismatch must fail closed");
const m=migrateLegacy5x5({workerTabs:[11,12,13,14,15],missions:[{id:"m1"},null,null,null,null],auditLog:[{type:"legacy"}]});
assert(m.agents.A1.conversation.legacyTabId===11,"legacy tab not migrated");
assert(m.agents.A1.missionId==="m1","legacy mission not migrated");
assert(m.legacy.auditLog.length===1,"legacy audit lost");

const hardenedLegacy={
 enabled:true,
 armed:true,
 emergencyStop:false,
 workerTabs:[101,102,103,104,105],
 counts:[5,10,15,20,25],
 lastSeen:[1001,1002,1003,1004,1005],
 missions:[
  {id:"legacy-active",title:"Active legacy mission",status:"working",acceptance:[{id:"a1",text:"works",done:false}]},
  null,null,null,null
 ],
 workerHealth:[{status:"ready"},{status:"busy"},null,null,null],
 reviewQueue:[{key:"rq-1",worker:0}],
 activeReview:{key:"active-review",worker:0},
 reviewHistory:[{key:"rh-1"}],
 reviewAttempts:{"rq-1":2},
 ownershipLeases:[{resource:"src/a.js",worker:0,claimedAt:10,expiresAt:999999}],
 missionQueue:[{id:"queued-legacy",title:"Queued legacy",dependsOn:["legacy-active"]}],
 missionHistory:[{id:"history-legacy",title:"Historical legacy",status:"verified",assignedAgent:"W2"}],
 dispatch:{minGapMs:1500,maxConcurrent:3,lastSendAt:500,pending:[{worker:1,kind:"next"}]},
 checkpoints:[{missionId:"legacy-active",pass:5,status:"working"},null,null,null,null],
 convergence:{round:3,lastCheckpointPasses:[5,5,5,5,5],history:[{round:2}]},
 auditLog:[{type:"legacy-audit",at:1}],
 recovery:{lastShutdownAt:10,lastStartupAt:20,unclean:true,reconciled:false},
 workerIdentity:[{origin:"https://chatgpt.com",conversationId:"abc",key:"https://chatgpt.com/c/abc",tabId:101,boundAt:5},null,null,null,null],
 sendLedger:[{key:"legacy-send-1",at:2}],
 approvals:[{id:"legacy-approval-1",type:"scope-expansion",approved:true}],
 reviewScheduler:{cursor:2,lastGrantedAt:[5,10,15,20,25]},
 utilization:{target:3,min:2,max:5,lastAdjustedAt:44,reason:"pressure",lastAdvanceAt:[1,2,3,4,5],grants:9}
};
const hardenedMigrated=migrateLegacy5x5(hardenedLegacy);
assert(hardenedMigrated.controls.armed===false,"legacy migration must always force v4 disarmed");
assert(hardenedMigrated.recovery.migration.needsReconciliation===true,"legacy migration must require reconciliation before re-arm");
assert(hardenedMigrated.recovery.migration.legacyWasArmed===true,"legacy armed state should be retained as evidence, not restored");
assert(hardenedMigrated.agents.A1.conversation.key==="https://chatgpt.com/c/abc","worker identity must map to A1 conversation");
assert(hardenedMigrated.agents.A1.conversation.legacyTabId===101,"legacy tab id must be retained with mapped identity");
assert(hardenedMigrated.agents.A1.checkpoint.pass===5,"legacy checkpoint must map to A1");
assert(hardenedMigrated.agents.A1.legacyRuntime.passCount===5&&hardenedMigrated.agents.A1.legacyRuntime.lastSeen===1001,"legacy pass/last-seen state must map to A1 runtime evidence");
assert(hardenedMigrated.agents.A1.control.paused===true&&hardenedMigrated.agents.A1.control.pauseReason==="legacy-migration-reconciliation","migrated active worker must remain paused pending reconciliation");
assert(hardenedMigrated.missions["legacy-active"].assignedAgent==="A1","active legacy mission must map to canonical A1 assignment");
assert(hardenedMigrated.missions["queued-legacy"].assignedAgent===null,"queued legacy mission must not keep stale assignment");
assert(hardenedMigrated.missions["history-legacy"].assignedAgent===null,"historical legacy mission must clear stale W-slot assignment");
assert(hardenedMigrated.legacy.compatibility.review.active.key==="active-review","active review must be retained");
assert(hardenedMigrated.legacy.compatibility.review.history.length===1,"review history must be retained");
assert(hardenedMigrated.legacy.compatibility.review.attempts["rq-1"]===2,"review attempts must be retained");
assert(hardenedMigrated.legacy.compatibility.ownershipLeases[0].agentId==="A1","legacy ownership lease worker must map to canonical A1");
assert(hardenedMigrated.legacy.compatibility.approvals[0].migrationId==="legacy-approval-1","legacy approval must be retained");
assert(hardenedMigrated.legacy.compatibility.dispatch.maxConcurrent===3,"legacy dispatch/backpressure state must be retained");
assert(hardenedMigrated.legacy.compatibility.convergence.round===3,"legacy convergence state must be retained");
assert(hardenedMigrated.legacy.compatibility.recovery.unclean===true,"legacy recovery state must be retained");
assert(hardenedMigrated.legacy.compatibility.reviewScheduler.cursor===2,"legacy review scheduler must be retained");
assert(hardenedMigrated.legacy.compatibility.utilization.target===3,"legacy utilization state must be retained");
assert(hardenedMigrated.legacy.compatibility.sendLedger[0].key==="legacy-send-1","legacy send ledger must be retained");
assert(hardenedMigrated.legacy.compatibility.auditLog[0].type==="legacy-audit","legacy audit log must be retained");
assert(hardenedMigrated.legacy.rawState.approvals[0].id==="legacy-approval-1","complete raw legacy snapshot must be retained");
assert(hardenedMigrated.legacy.rawState.workerIdentity[0].conversationId==="abc","raw worker identity must survive archive");
assert(hardenedMigrated.legacy.reviewQueue.length===1&&hardenedMigrated.legacy.sendLedger.length===1,"legacy compatibility accessors must remain available");
assert(validateWorkforceStateDetailed(hardenedMigrated).ok,"lossless legacy migration must produce valid canonical v4 state");

const remigrated=migrateWorkforceState(hardenedMigrated);
assert(remigrated.legacy.migrationVersion===2,"current-schema re-load must not re-run legacy migration");
assert(remigrated.legacy.compatibility.ownershipLeases.length===1,"idempotent migration must not duplicate ownership leases");
assert(remigrated.legacy.compatibility.approvals.length===1,"idempotent migration must not duplicate approvals");
assert(remigrated.legacy.rawState.sendLedger.length===1,"idempotent migration must preserve original raw snapshot");


import {normalizeMissionContract} from "./mission-contract.js";
import {pathAllowed,verifyDiffScope,requireScopeExpansion,verifyApprovedExpansion} from "./scope-locks.js";
import {TitanProvenanceGraph,createProvenanceNode} from "./provenance.js";
import {TitanMissionControl} from "./mission-control.js";
const mc=new TitanMissionControl(s);
const mission=mc.upsert({id:"scope1",title:"Scoped mission",scope_paths:["src/titan-go/**","tests/*.test.js"],acceptance:["works"]});
assert(mission.scopePaths[0]==="src/titan-go/**","scope normalization");
assert(verifyDiffScope(["src/titan-go/a.js","tests/x.test.js"],mission.scopePaths).ok,"valid scope rejected");
const bad=verifyDiffScope(["src/titan-go/a.js","src/auth/x.js"],mission.scopePaths);assert(!bad.ok&&bad.violations[0]==="src/auth/x.js","scope violation missed");

assert(pathAllowed("src/pipeline/index.js",["src/pipeline"]),"plain directory scope must allow descendants");
assert(pathAllowed("src\\pipeline\\deep\\file.js",["src\\pipeline"]),"scope matching must normalize Windows separators");
assert(pathAllowed("tests/unit.test.js",["tests/*.test.js"]),"single-star glob should match one path segment");
assert(!pathAllowed("tests/nested/unit.test.js",["tests/*.test.js"]),"single-star glob must not cross directory boundaries");
assert(pathAllowed("src/deep/nested/file.js",["src/**"]),"double-star glob should match nested descendants");
assert(!pathAllowed("src-other/file.js",["src"]),"plain directory scope must not allow sibling prefix escapes");
const traversalScope=verifyDiffScope(["src/pipeline/../auth/x.js"],["src/pipeline"]);
assert(!traversalScope.ok&&traversalScope.invalid.some(x=>x.kind==="changed-path"),"path traversal must fail closed");
const absoluteScope=verifyDiffScope(["/etc/passwd"],["src"]);
assert(!absoluteScope.ok&&absoluteScope.invalid.some(x=>x.kind==="changed-path"),"absolute changed path must fail closed");

const scopePacketFixture={packet_id:"scope-packet",mission:{id:"scope1"},scope_paths:["src/titan-go"]};
const expansionRequest=requireScopeExpansion(scopePacketFixture,["src/auth/x.js"],{now:100});
assert(expansionRequest?.proposedScope[0]==="src/auth/x.js","scope expansion should propose exact violating changed path");
let missingApprovalBlocked=false;try{verifyApprovedExpansion(scopePacketFixture,["src/auth/x.js"],expansionRequest,null,{now:150})}catch(e){missingApprovalBlocked=e.code==="SCOPE_EXPANSION_NOT_APPROVED"}assert(missingApprovalBlocked,"missing scope approval must fail closed");
let mismatchApprovalBlocked=false;try{verifyApprovedExpansion(scopePacketFixture,["src/auth/x.js"],expansionRequest,{approved:true,requestId:"wrong"},{now:150})}catch(e){mismatchApprovalBlocked=e.code==="SCOPE_EXPANSION_APPROVAL_MISMATCH"}assert(mismatchApprovalBlocked,"mismatched scope approval must fail closed");
let expiredApprovalBlocked=false;try{verifyApprovedExpansion(scopePacketFixture,["src/auth/x.js"],expansionRequest,{approved:true,requestId:expansionRequest.id,missionId:"scope1",expiresAt:149},{now:150})}catch(e){expiredApprovalBlocked=e.code==="SCOPE_EXPANSION_APPROVAL_EXPIRED"}assert(expiredApprovalBlocked,"expired scope approval must fail closed");
const approvedExpansion=verifyApprovedExpansion(scopePacketFixture,["src/auth/x.js"],expansionRequest,{id:"approval-1",approved:true,requestId:expansionRequest.id,missionId:"scope1",expiresAt:500,approvedAt:140},{now:150});
assert(approvedExpansion.verification.ok,"approved expanded scope must be reverified");
assert(approvedExpansion.target.scope_paths.includes("src/auth/x.js"),"approved packet must persist expanded scope");
assert(approvedExpansion.target.scope_approvals[0].approval_id==="approval-1","approved packet must retain approval evidence");
const pg=new TitanProvenanceGraph(s);pg.add(createProvenanceNode({id:"p1",type:"chat-cycle",missionId:"scope1"}));pg.add(createProvenanceNode({id:"p2",type:"approved-delta",missionId:"scope1",parentIds:["p1"]}));
assert(pg.ancestry("p2").length===2,"provenance ancestry failed");
pg.add(createProvenanceNode({id:"p3",type:"chat-cycle",missionId:"scope1",parentIds:["p1"],agentId:"A1"}));
pg.add(createProvenanceNode({id:"p4",type:"orchestrator-decision",missionId:"scope1",parentIds:["p2","p3"]}));
assert(pg.ancestry("p4").length===4,"shared provenance ancestor should be deduplicated");
assert(pg.integrityErrors({missionId:"scope1"}).length===0,"valid provenance graph integrity");

let missingParentBlocked=false;try{pg.add(createProvenanceNode({id:"p-missing",type:"bad",missionId:"scope1",parentIds:["does-not-exist"]}))}catch(e){missingParentBlocked=e.code==="PROVENANCE_PARENT_MISSING"}assert(missingParentBlocked,"missing provenance parent must fail closed");
let selfParentBlocked=false;try{pg.add(createProvenanceNode({id:"p-self",type:"bad",missionId:"scope1",parentIds:["p-self"]}))}catch(e){selfParentBlocked=e.code==="PROVENANCE_SELF_PARENT"}assert(selfParentBlocked,"self-parent provenance must fail closed");
mc.upsert({id:"scope2",title:"Other mission"});
let crossMissionBlocked=false;try{pg.add(createProvenanceNode({id:"p-cross",type:"bad",missionId:"scope2",parentIds:["p1"]}))}catch(e){crossMissionBlocked=e.code==="PROVENANCE_CROSS_MISSION"}assert(crossMissionBlocked,"cross-mission provenance parent must fail closed");
let unknownAgentBlocked=false;try{pg.add(createProvenanceNode({id:"p-agent",type:"bad",missionId:"scope1",agentId:"NOT_A_SLOT"}))}catch(e){unknownAgentBlocked=e.code==="UNKNOWN_PROVENANCE_AGENT"}assert(unknownAgentBlocked,"unknown provenance agent must fail closed");
let unknownMissionBlocked=false;try{pg.add(createProvenanceNode({id:"p-mission",type:"bad",missionId:"missing-mission"}))}catch(e){unknownMissionBlocked=e.code==="UNKNOWN_PROVENANCE_MISSION"}assert(unknownMissionBlocked,"unknown provenance mission must fail closed");

const corruptState=createWorkforceState(),corruptMc=new TitanMissionControl(corruptState);corruptMc.upsert({id:"cycle-mission",title:"Cycle"});
corruptState.provenance={
 ca:{id:"ca",type:"legacy",missionId:"cycle-mission",parentIds:["cb"],agentId:null,artifactId:null,metadata:{},at:1},
 cb:{id:"cb",type:"legacy",missionId:"cycle-mission",parentIds:["ca"],agentId:null,artifactId:null,metadata:{},at:2}
};
const corruptGraph=new TitanProvenanceGraph(corruptState);
assert(corruptGraph.integrityErrors({missionId:"cycle-mission"}).some(e=>e.code==="CYCLE"),"legacy provenance cycle must be detected");
let corruptReplayBlocked=false;try{corruptGraph.ancestry("ca")}catch(e){corruptReplayBlocked=e.code==="PROVENANCE_INTEGRITY_ERROR"}assert(corruptReplayBlocked,"ancestry/replay must fail closed on corrupt provenance");


import {TitanExecutionServices} from "./execution-services.js";
import {agentSummaryText} from "./cockpit.js";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {TitanWorkforceController,validateAssignmentInvariants} from "./controller.js";
import {TitanWorkforceControls} from "./controls.js";
import {TitanWorkforceIntegration} from "./integration.js";
import {installLegacyNativeBridge,createScopedCodexService} from "./native-bridge.js";
import {conversationIdentity,bindConversation,createConversationService} from "./conversation-service.js";
import {classifyCIFailure,recoveryRoute} from "./ci-failures.js";
import {createVerificationState,recordGate,verificationDecision} from "./verification-plane.js";
import {importLegacyVerification,evaluateBooleanEvidence} from "./verification-adapter.js";
const services=new TitanExecutionServices();services.register("github",{capabilities:["truth"]});assert(services.available("github"),"service registry");

const scopedAudit=[];
const scopedPacket={packet_id:"scope-service-packet",mission:{id:"scope-service-mission"},scope_paths:["src/core"]};
const scopedCodex=createScopedCodexService({
 capabilities:["build"],
 build:async()=>({files_changed:["src/feature/new.js"],ok:true})
},{
 audit:(type,data)=>scopedAudit.push({type,data}),
 requestApproval:async request=>({id:"scope-service-approval",approved:true,requestId:request.id,missionId:request.missionId,expiresAt:Date.now()+60000})
});
const scopedBuildResult=await scopedCodex.build({builderId:"BUILDER_A",packet:scopedPacket});
assert(scopedBuildResult.scopeVerification.ok,"scoped Codex service must reverify approved expansion");
assert(scopedPacket.scope_paths.includes("src/feature/new.js"),"scoped Codex service must persist approved scope into bounded packet");
assert(scopedPacket.scope_approvals?.[0]?.approval_id==="scope-service-approval","scoped Codex service must persist approval record into packet");
assert(scopedBuildResult.approvedPacket.scope_paths.includes("src/feature/new.js"),"scoped Codex result must return approved packet");
assert(scopedAudit.some(x=>x.type==="scope-expansion-approved"),"scope expansion approval must be audited");


const requireForProfiles=createRequire(import.meta.url);
const realProfileApi=requireForProfiles("../titan-agent-profiles.js");
const profileState=createWorkforceState();
const profileAudit=[];
const profileCalls=[];
const profileMissions=new TitanMissionControl(profileState);
const profileMission=profileMissions.upsert({
 id:"profile-mission",
 title:"Architecture boundary refactor",
 goal:"Preserve architecture invariants and verification boundaries",
 repository:"example/repo",
 acceptance:["specialist context reaches every execution class"]
});
const profileServices=new TitanExecutionServices();
profileServices.register("chat",{send:async x=>{profileCalls.push({kind:"chat",...x});return {ok:true}}});
profileServices.register("work",{review:async x=>{profileCalls.push({kind:"work",...x});return {ok:true}}});
profileServices.register("codex",{
 capabilities:["build","orchestrate"],
 build:async x=>{profileCalls.push({kind:"build",...x});return {ok:true}},
 orchestrate:async x=>{profileCalls.push({kind:"orchestrate",...x});return {ok:true}}
});
const profileController=new TitanWorkforceController(profileState,{missionControl:profileMissions,services:profileServices,audit:(type,data)=>profileAudit.push({type,data})});
const profileIntegration=new TitanWorkforceIntegration({state:profileState,controller:profileController,missionControl:profileMissions,services:profileServices,audit:(type,data)=>profileAudit.push({type,data})});
profileIntegration.profileApi=realProfileApi;

const profileCast=profileIntegration.castMission("profile-mission","A1");
assert(profileCast.compiled.profileIds.length>0,"profile cast must select at least one profile");
assert(profileController.registry.get("A1").profileIds.length===profileCast.compiled.profileIds.length,"selected profile IDs must persist on assigned slot");
assert(!Object.prototype.hasOwnProperty.call(profileController.registry.get("A1"),"profileContext"),"compiled profile definitions/text must not be persisted in slot state");

await profileIntegration.dispatchChatPass("A1",{instruction:"Inspect the boundary",key:"profile/chat/1"});
await profileIntegration.requestWorkReviewForPipelineSlot("supervisor-a",{mission:profileMission,review_id:"profile-review"});
await profileIntegration.dispatchCodexPacket("builder-a",{builder_slot:"builder-a",mission:profileMission,packet_id:"profile-build"});
await profileIntegration.orchestrate({mission:profileMission,builder_results:[]});

const chatProfileCall=profileCalls.find(x=>x.kind==="chat");
assert(chatProfileCall.instruction.includes("TITAN AGENT PROFILE CONTEXT"),"Chat instruction must include compiled WP1 profile context");
assert(chatProfileCall.instruction.includes("Execution class: chat_worker"),"Chat profile context must match chat execution class");
assert(Array.isArray(chatProfileCall.profileIds)&&chatProfileCall.profileIds.length>0,"Chat dispatch must preserve selected profile IDs");

const workProfileCall=profileCalls.find(x=>x.kind==="work");
assert(workProfileCall.payload?.profile_context?.text?.includes("TITAN AGENT PROFILE CONTEXT"),"Work review payload must include compiled profile context");
assert(workProfileCall.payload.profile_context.execution_class==="work_supervisor","Work profile context must match supervisor execution class");
assert(workProfileCall.profileIds.length>0,"Work audit/envelope profile IDs must be present");

const builderProfileCall=profileCalls.find(x=>x.kind==="build");
assert(builderProfileCall.packet?.profile_context?.text?.includes("TITAN AGENT PROFILE CONTEXT"),"Builder packet must include compiled profile context");
assert(builderProfileCall.packet.profile_context.execution_class==="codex_builder","Builder profile context must match builder execution class");
assert(builderProfileCall.profileIds.length>0,"Builder profile IDs must be preserved");

const orchestratorProfileCall=profileCalls.find(x=>x.kind==="orchestrate");
assert(orchestratorProfileCall.bundle?.profile_context?.text?.includes("TITAN AGENT PROFILE CONTEXT"),"Orchestrator bundle must include compiled profile context");
assert(orchestratorProfileCall.bundle.profile_context.execution_class==="codex_orchestrator","Orchestrator profile context must match orchestrator execution class");
assert(orchestratorProfileCall.profileIds.length>0,"Orchestrator profile IDs must be preserved");

assert(profileAudit.filter(x=>x.type==="profile-context-compiled").length>=4,"profile selection/context compilation must be auditable");
profileController.registry.get("A2").profileIds=["directadmin"];
let incompatibleProfileBlocked=false;
try{profileIntegration.compileProfileForSlot("A2",{mission:profileMission})}catch(e){incompatibleProfileBlocked=e.code==="PROFILE_EXECUTION_CLASS_MISMATCH"}
assert(incompatibleProfileBlocked,"stored profile incompatible with execution class must fail closed");


const hostileMissionId='<img src=x onerror="globalThis.__cockpitPwned=true">';
const hostileSummary=agentSummaryText({executionClass:"chat_worker",status:"assigned",missionId:hostileMissionId});
assert(hostileSummary.includes(hostileMissionId),"hostile mission id must remain literal text in summary");
const cockpitSource=readFileSync(new URL("./cockpit.js",import.meta.url),"utf8");
assert(!cockpitSource.includes(".innerHTML"),"cockpit must not render runtime data through innerHTML");
assert(cockpitSource.includes(".textContent"),"cockpit should render runtime data through textContent");


assert(conversationIdentity("https://chatgpt.com/c/abc-123")?.conversationId==="abc-123","supported ChatGPT conversation identity");
assert(conversationIdentity("https://chatgpt.com/c/abc-123?model=test")?.key==="https://chatgpt.com/c/abc-123","conversation key should ignore query parameters");
assert(conversationIdentity("https://chatgpt.com/")===null,"ChatGPT homepage must not be autonomously bindable");
assert(conversationIdentity("https://chatgpt.com/g/g-example")===null,"custom GPT route without stable /c identity must not be bindable");
assert(conversationIdentity("https://example.com/c/abc-123")===null,"non-ChatGPT origin must not be bindable");

const priorChrome=globalThis.chrome;
let mockTabUrl="https://chatgpt.com/c/abc-123",scriptResponses=[],scriptCalls=0;
globalThis.chrome={
 tabs:{get:async tabId=>({id:tabId,url:mockTabUrl,title:"Mock conversation"})},
 scripting:{executeScript:async()=>{scriptCalls++;return [{result:scriptResponses.shift()}]}}
};
const boundConversation=await bindConversation(77);
assert(boundConversation.key==="https://chatgpt.com/c/abc-123"&&boundConversation.tabId===77,"supported conversation should bind");

const safeConversationService=createConversationService();
scriptResponses=[
 {identityMatches:true,generating:false,composerReady:true,assistantCount:1,lastText:"ready"},
 {ok:true}
];
const safeSend=await safeConversationService.send({conversation:boundConversation,instruction:"NEXT",idempotencyKey:"safe-1"});
assert(safeSend.ok===true&&scriptCalls===2,"verified conversation send should succeed");

mockTabUrl="https://example.com/form";
const callsBeforeWrongSite=scriptCalls;
let wrongSiteBlocked=false;try{await bindConversation(78)}catch(e){wrongSiteBlocked=e.code==="CONVERSATION_IDENTITY_MISMATCH"}assert(wrongSiteBlocked,"arbitrary website binding must fail");
let wrongSiteSendBlocked=false;try{await safeConversationService.send({conversation:boundConversation,instruction:"DO NOT SEND"})}catch(e){wrongSiteSendBlocked=e.code==="CONVERSATION_IDENTITY_MISMATCH"}assert(wrongSiteSendBlocked,"navigation to unrelated site must block send");
assert(scriptCalls===callsBeforeWrongSite,"wrong-site send must fail before page script execution");

mockTabUrl="https://chatgpt.com/";
let homepageBlocked=false;try{await bindConversation(79)}catch(e){homepageBlocked=e.code==="CONVERSATION_IDENTITY_MISMATCH"}assert(homepageBlocked,"new-chat/homepage binding must fail until stable conversation exists");

mockTabUrl="https://chatgpt.com/c/different";
let reusedTabBlocked=false;try{await safeConversationService.assertConversation(boundConversation)}catch(e){reusedTabBlocked=e.code==="CONVERSATION_IDENTITY_MISMATCH"}assert(reusedTabBlocked,"tab reuse/navigation to different conversation must fail closed");

mockTabUrl="https://chatgpt.com/c/abc-123";
scriptResponses=[{identityMatches:false,generating:false,composerReady:true}];
let pageIdentityBlocked=false;try{await safeConversationService.send({conversation:boundConversation,instruction:"DO NOT SEND"})}catch(e){pageIdentityBlocked=e.code==="CONVERSATION_IDENTITY_MISMATCH"}assert(pageIdentityBlocked,"in-page identity mismatch must block send");

globalThis.chrome=priorChrome;


const assignmentState=createWorkforceState();
const assignmentEvents=[];
const assignmentMissions=new TitanMissionControl(assignmentState);
assignmentMissions.upsert({id:"dep-ready",title:"Dependency",status:"verified"});
assignmentMissions.upsert({id:"assign-target",title:"Target",dependencies:["dep-ready"]});
assignmentMissions.upsert({id:"slot-old",title:"Old slot mission"});
assignmentMissions.upsert({id:"slot-next",title:"Next slot mission"});
assignmentMissions.upsert({id:"blocked-target",title:"Blocked",dependencies:["missing-dep"]});
const assignmentController=new TitanWorkforceController(assignmentState,{missionControl:assignmentMissions,audit:(type,data)=>assignmentEvents.push({type,data})});
const firstAssignment=assignmentMissions.assign("assign-target","A1",{expectedExecutionClass:"chat_worker",profileIds:["architecture"]});
assert(firstAssignment.mission.assignedAgent==="A1"&&firstAssignment.slot.missionId==="assign-target","Mission Control assignment must update both sides");
assert(validateAssignmentInvariants(assignmentState).ok,"assignment invariants after initial assignment");

assignmentController.assignMission("slot-old","A2",{expectedExecutionClass:"chat_worker"});
let doubleMissionBlocked=false;try{assignmentController.assignMission("assign-target","A2",{expectedExecutionClass:"chat_worker"})}catch(e){doubleMissionBlocked=e.code==="MISSION_ALREADY_ASSIGNED"}assert(doubleMissionBlocked,"mission double-assignment must fail closed");
let occupiedSlotBlocked=false;try{assignmentController.assignMission("slot-next","A2",{expectedExecutionClass:"chat_worker"})}catch(e){occupiedSlotBlocked=e.code==="AGENT_ALREADY_ASSIGNED"}assert(occupiedSlotBlocked,"active slot replacement must require transfer");

assignmentController.assignMission("assign-target","A2",{expectedExecutionClass:"chat_worker",transfer:true,source:"test-transfer"});
assert(assignmentController.registry.get("A1").missionId===null,"transfer must clear previous slot");
assert(assignmentMissions.get("slot-old").assignedAgent===null&&assignmentMissions.get("slot-old").status==="queued","transfer must release previous slot mission");
assert(assignmentMissions.get("assign-target").assignedAgent==="A2"&&assignmentController.registry.get("A2").missionId==="assign-target","transfer must set new reverse references");
assert(assignmentMissions.get("assign-target").assignmentHistory.some(x=>x.type==="transferred"),"transfer history must be recorded");
assert(validateAssignmentInvariants(assignmentState).ok,"assignment invariants after transfer");

let dependencyBlocked=false;try{assignmentController.assignMission("blocked-target","A3",{expectedExecutionClass:"chat_worker"})}catch(e){dependencyBlocked=e.code==="MISSION_DEPENDENCY_BLOCKED"}assert(dependencyBlocked,"unresolved mission dependency must block assignment");
let classBlocked=false;try{assignmentController.assignMission("slot-next","BUILDER_A",{expectedExecutionClass:"chat_worker"})}catch(e){classBlocked=e.code==="EXECUTION_CLASS_MISMATCH"}assert(classBlocked,"execution-class mismatch must fail closed");

assignmentMissions.cancel("assign-target","test cancel");
assert(assignmentController.registry.get("A2").missionId===null&&assignmentMissions.get("assign-target").assignedAgent===null,"terminal mission transition must clear reverse assignment");
assert(validateAssignmentInvariants(assignmentState).ok,"assignment invariants after terminal cleanup");

assignmentMissions.upsert({id:"complete-target",title:"Complete target"});
assignmentController.assignMission("complete-target","A4",{expectedExecutionClass:"chat_worker"});
assignmentMissions.complete("complete-target");
assert(assignmentController.registry.get("A4").missionId===null,"complete mission must release slot");
assignmentMissions.upsert({id:"verify-target",title:"Verify target"});
assignmentController.assignMission("verify-target","A5",{expectedExecutionClass:"chat_worker"});
assignmentMissions.verify("verify-target");
assert(assignmentController.registry.get("A5").missionId===null,"verified mission must release slot");

const controlState=createWorkforceState();
const controlEvents=[];
const controlMissions=new TitanMissionControl(controlState);
for(const id of ["control-m1","control-m3","control-b1","control-b2","other"])controlMissions.upsert({id,title:id});
const controlController=new TitanWorkforceController(controlState,{missionControl:controlMissions,audit:(type,data)=>controlEvents.push({type,data})});
const controlApi=new TitanWorkforceControls(controlController,(type,data)=>controlEvents.push({type,data}));
controlController.assign("A1",{missionId:"control-m1"});
const a1=controlController.registry.get("A1");
assert(a1.status==="assigned","control fixture assignment");
controlApi.pauseAgent("A1","test");
assert(a1.status==="assigned"&&a1.control.paused===true,"pause must preserve agent status");
controlApi.resumeAgent("A1");
assert(a1.status==="assigned"&&a1.control.paused===false,"resume must preserve agent status");

controlApi.quarantine("A1","suspect");
assert(a1.status==="assigned"&&a1.control.quarantined===true&&a1.control.paused===true,"quarantine must be orthogonal and paused");
let quarantineResumeBlocked=false;try{controlApi.resumeAgent("A1")}catch(e){quarantineResumeBlocked=e.code==="INVALID_CONTROL_TRANSITION"}assert(quarantineResumeBlocked,"resume must not bypass quarantine");
let quarantinePauseBlocked=false;try{controlApi.pauseAgent("A1")}catch(e){quarantinePauseBlocked=e.code==="INVALID_CONTROL_TRANSITION"}assert(quarantinePauseBlocked,"pause must not overwrite quarantine");
controlApi.unquarantine("A1","reviewed");
assert(a1.control.quarantined===false&&a1.control.paused===true,"unquarantine must leave agent paused");
controlApi.resumeAgent("A1");
assert(a1.control.paused===false,"explicit resume required after unquarantine");

controlController.assign("A3",{missionId:"control-m3"});
controlApi.quarantine("A3","isolate");
controlApi.pauseSquad("A","squad-pause");
assert(controlController.registry.get("A3").control.quarantined===true,"squad pause must preserve quarantine");
assert(controlController.registry.get("A3").control.pauseReason==="quarantine","squad pause must not overwrite quarantine pause reason");

controlController.assign("B1",{missionId:"control-b1"});
controlApi.pauseAgent("B1","pre-stop");
const b1=controlController.registry.get("B1");
const b1Status=b1.status;
controlController.emergencyStop("test-stop");
assert(b1.status===b1Status&&b1.control.paused===true&&b1.control.emergencyStopped===true,"E-STOP must preserve status and pause state");
let estopResumeBlocked=false;try{controlApi.resumeAgent("B1")}catch(e){estopResumeBlocked=e.code==="INVALID_CONTROL_TRANSITION"}assert(estopResumeBlocked,"E-STOP must block resume");
let prematureClearBlocked=false;try{controlController.clearEmergencyStop()}catch(e){prematureClearBlocked=e.code==="RECOVERY_RECONCILIATION_REQUIRED"}assert(prematureClearBlocked,"E-STOP clear requires reconciliation");
controlController.clearEmergencyStop({reconciled:true});
assert(controlState.controls.armed===false&&controlState.controls.emergencyStop===false,"E-STOP clear must remain disarmed");
assert(b1.control.emergencyStopped===false&&b1.control.paused===true,"E-STOP clear must preserve prior pause state");
controlApi.resumeAgent("B1");
assert(b1.control.paused===false,"agent may resume only after E-STOP reconciliation");

controlController.assign("B2",{missionId:"control-b2"});
controlApi.pauseAgent("B2","hold");
let pausedAssignBlocked=false;try{controlController.assign("B2",{missionId:"other"})}catch(e){pausedAssignBlocked=e.code==="AGENT_NOT_AVAILABLE"}assert(pausedAssignBlocked,"assignment must fail for paused agent");
controlApi.resumeAgent("B2");
controlApi.quarantine("B2","hold");
let quarantineAssignBlocked=false;try{controlController.assign("B2",{missionId:"other"})}catch(e){quarantineAssignBlocked=e.code==="AGENT_NOT_AVAILABLE"}assert(quarantineAssignBlocked,"assignment must fail for quarantined agent");

const terminalSlot=controlController.registry.get("B3");terminalSlot.status="verified";
controlController.emergencyStop("terminal-test");
assert(terminalSlot.control.emergencyStopped===false,"terminal agents must not be marked emergency-stopped");
controlController.clearEmergencyStop({reconciled:true});
let terminalPauseBlocked=false;try{controlApi.pauseAgent("B3")}catch(e){terminalPauseBlocked=e.code==="INVALID_CONTROL_TRANSITION"}assert(terminalPauseBlocked,"terminal agent pause must fail closed");

const routingState=createWorkforceState();
const routingServices=new TitanExecutionServices();
const calls=[];
routingServices.register("work",{review:async x=>{calls.push({kind:"work",...x});return {ok:true}}});
routingServices.register("codex",{capabilities:["build"],build:async x=>{calls.push({kind:"codex",...x});return {ok:true}}});
const routingController=new TitanWorkforceController(routingState,{services:routingServices});
const routingMissions=new TitanMissionControl(routingState);
const routingIntegration=new TitanWorkforceIntegration({state:routingState,controller:routingController,missionControl:routingMissions,services:routingServices});
routingIntegration.profileApi=realProfileApi;
await routingIntegration.requestWorkReviewForPipelineSlot("supervisor-a",{mission:{id:"mA"}});
await routingIntegration.requestWorkReviewForPipelineSlot("supervisor-b",{mission:{id:"mB"}});
await routingIntegration.dispatchCodexPacket("builder-a",{builder_slot:"builder-a",mission:{id:"mA"},packet_id:"pA"});
await routingIntegration.dispatchCodexPacket("builder-b",{builder_slot:"builder-b",mission:{id:"mB"},packet_id:"pB"});
assert(calls[0].supervisorId==="SUPERVISOR_A","WP3 Supervisor A must route to canonical supervisor");
assert(calls[1].supervisorId==="SUPERVISOR_B","WP3 Supervisor B must route to canonical supervisor");
assert(calls[2].builderId==="BUILDER_A","WP3 Builder A must route to canonical builder");
assert(calls[3].builderId==="BUILDER_B","WP3 Builder B must route to canonical builder");

const priorNativeServices=globalThis.TitanNativeServices;
globalThis.TitanNativeServices={services:new Map([["codex",{review:async()=>({instruction:"review"})}]])};
const reviewOnlyServices=new TitanExecutionServices();
installLegacyNativeBridge(reviewOnlyServices);
assert(reviewOnlyServices.status().codex.capabilities.length===1&&reviewOnlyServices.status().codex.capabilities[0]==="review","review-only provider must not advertise build/orchestrate");
assert(!reviewOnlyServices.capabilityAvailable("codex","build"),"review-only provider build capability must be unavailable");
assert(!reviewOnlyServices.capabilityAvailable("codex","orchestrate"),"review-only provider orchestrate capability must be unavailable");
let buildUnavailable=false;try{reviewOnlyServices.requireCapability("codex","build")}catch(e){buildUnavailable=e.code==="CAPABILITY_UNAVAILABLE"}assert(buildUnavailable,"missing build must fail with CAPABILITY_UNAVAILABLE");
let orchestrateUnavailable=false;try{reviewOnlyServices.requireCapability("codex","orchestrate")}catch(e){orchestrateUnavailable=e.code==="CAPABILITY_UNAVAILABLE"}assert(orchestrateUnavailable,"missing orchestrate must fail with CAPABILITY_UNAVAILABLE");

const reviewOnlyState=createWorkforceState();
const reviewOnlyIntegration=new TitanWorkforceIntegration({state:reviewOnlyState,controller:new TitanWorkforceController(reviewOnlyState,{services:reviewOnlyServices}),missionControl:new TitanMissionControl(reviewOnlyState),services:reviewOnlyServices});
reviewOnlyIntegration.profileApi=realProfileApi;
let dispatchUnavailable=false;try{await reviewOnlyIntegration.dispatchCodexPacket("builder-a",{builder_slot:"builder-a",mission:{id:"cap-test"}})}catch(e){dispatchUnavailable=e.code==="CAPABILITY_UNAVAILABLE"}assert(dispatchUnavailable,"Builder dispatch must surface CAPABILITY_UNAVAILABLE");
let qaUnavailable=false;try{await reviewOnlyIntegration.orchestrate({mission:{id:"cap-test"}})}catch(e){qaUnavailable=e.code==="CAPABILITY_UNAVAILABLE"}assert(qaUnavailable,"Orchestrator dispatch must surface CAPABILITY_UNAVAILABLE");

globalThis.TitanNativeServices={services:new Map([["codex",{execute:async()=>({ok:true})}]])};
const executeServices=new TitanExecutionServices();
installLegacyNativeBridge(executeServices);
assert(executeServices.capabilityAvailable("codex","build"),"execute provider should expose real build capability");
assert(!executeServices.capabilityAvailable("codex","orchestrate"),"execute provider must not imply orchestrate");

globalThis.TitanNativeServices={services:new Map([["codex",{review:async()=>({}),build:async()=>({}),orchestrate:async()=>({})}]])};
const fullCodexServices=new TitanExecutionServices();
installLegacyNativeBridge(fullCodexServices);
assert(fullCodexServices.capabilityAvailable("codex","review"),"full provider review capability");
assert(fullCodexServices.capabilityAvailable("codex","build"),"full provider build capability");
assert(fullCodexServices.capabilityAvailable("codex","orchestrate"),"full provider orchestrate capability");
globalThis.TitanNativeServices=priorNativeServices;
let mismatch=false;try{await routingIntegration.dispatchCodexPacket("builder-a",{builder_slot:"builder-b",mission:{id:"mX"}})}catch(e){mismatch=e.code==="BUILDER_SLOT_MISMATCH"}assert(mismatch,"builder packet mismatch must fail closed");
assert(classifyCIFailure({message:"tenant isolation integration test failed"})==="TENANT_ISOLATION_FAILURE","CI taxonomy");
const vv=createVerificationState("scope1");recordGate(vv,"git",{status:"pass"});recordGate(vv,"ci",{status:"fail",details:{message:"typescript typecheck failed"}});
const vd=verificationDecision(vv);assert(vd.decision==="REPAIR"&&vd.failureType==="TYPE_FAILURE","verification recovery route");

const partialGit=importLegacyVerification({id:"partial-git",truth:{commitExists:true}});
assert(partialGit.gates.git.status==="pending","partial Git truth must remain pending");
assert(partialGit.gates.git.details.evaluation.missingFields.includes("merged"),"missing merged evidence should be explicit");
assert(partialGit.gates.ci.status==="pending","missing CI evidence must remain pending");

const failedGit=importLegacyVerification({id:"failed-git",truth:{commitExists:true,merged:false,presentOnMain:true,ciPassed:true}});
assert(failedGit.gates.git.status==="fail","explicit false Git evidence must fail");

const completeGit=importLegacyVerification({id:"complete-git",truth:{commitExists:true,merged:true,presentOnMain:true,ciPassed:true}});
assert(completeGit.gates.git.status==="pass","complete Git truth should pass");
assert(completeGit.gates.ci.status==="pass","complete CI truth should pass");

const partialRuntime=importLegacyVerification({id:"partial-runtime",runtime:{deployed:true}});
assert(partialRuntime.gates.runtime.status==="pending","partial runtime evidence must remain pending");
assert(partialRuntime.gates.runtime.details.evaluation.missingFields.includes("browserPassed"),"missing browser evidence should be explicit");

const completeRuntime=importLegacyVerification({id:"complete-runtime",runtime:{deployed:true,browserPassed:true,consoleClean:true,networkPassed:true,acceptancePassed:true}});
assert(completeRuntime.gates.runtime.status==="pass","complete runtime evidence should pass");

const serverRuntime=importLegacyVerification({id:"server-runtime",verificationRequirements:["server"],runtime:{deployed:true,browserPassed:true,consoleClean:true,networkPassed:true,acceptancePassed:true}});
assert(serverRuntime.gates.runtime.status==="pending","required server evidence must remain pending when absent");
assert(serverRuntime.gates.runtime.details.evaluation.missingFields.includes("serverPassed"),"serverPassed should be required");

const noAcceptance=importLegacyVerification({id:"no-acceptance"});
assert(noAcceptance.gates.acceptance.status==="pass","zero acceptance criteria should follow explicit no-criteria policy");
assert(noAcceptance.gates.acceptance.details.policy==="no-acceptance-criteria","no-criteria policy should be recorded");

const waivedRuntime=importLegacyVerification({id:"waived-runtime",runtimeRequired:false});
assert(waivedRuntime.gates.runtime.status==="pass"&&waivedRuntime.gates.runtime.details.waived===true,"explicit runtime waiver should be recorded");

const evalMixed=evaluateBooleanEvidence({a:true,b:false},["a","b","c"]);
assert(evalMixed.status==="fail"&&evalMixed.failedFields[0]==="b"&&evalMixed.missingFields[0]==="c","boolean evidence evaluation should distinguish false from missing");


import {OBJECTIVE_STAGES,recordWorkerCheckpoint,computeSquadConvergence,deriveObjectiveProgress,recordObjectiveProgress,finalMissionConvergence} from "./convergence.js";

const convergenceState=createWorkforceState();
for(const id of ["dep-a","dep-b"]){
 convergenceState.missions[id]={id,title:id,status:"verified",dependencies:[],assignedAgent:null};
}
convergenceState.missions["unlock-me"]={id:"unlock-me",title:"Unlocked mission",status:"dependency-wait",dependencies:["dep-a","dep-b"],assignedAgent:null};
convergenceState.missions["conv-mission"]={id:"conv-mission",title:"Convergence mission",status:"working",dependencies:[],assignedAgent:null};

recordWorkerCheckpoint(convergenceState,{workerId:"A1",cycle:1,missionId:"conv-mission",reviewed:true,scopePaths:["src/shared"],dependencies:["dep-a"],approvedFindings:["a1"]});
let squadPartial=computeSquadConvergence(convergenceState,"A",1);
assert(squadPartial.ready===false&&squadPartial.missingWorkers.length===4,"squad convergence must wait for all five reviewed checkpoints");

recordWorkerCheckpoint(convergenceState,{workerId:"A2",cycle:1,missionId:"conv-mission",reviewed:true,scopePaths:["src/shared/file.js"],dependencies:["dep-b"],approvedFindings:["a2"]});
recordWorkerCheckpoint(convergenceState,{workerId:"A3",cycle:1,missionId:"conv-mission",reviewed:true,scopePaths:["src/a3"],blockers:["needs-review"]});
recordWorkerCheckpoint(convergenceState,{workerId:"A4",cycle:1,missionId:"conv-mission",reviewed:true,scopePaths:["src/a4"]});
recordWorkerCheckpoint(convergenceState,{workerId:"A5",cycle:1,missionId:"conv-mission",reviewed:true,scopePaths:["src/a5"]});
const squadReady=computeSquadConvergence(convergenceState,"A",1);
assert(squadReady.ready===true,"all five reviewed checkpoints should converge");
assert(squadReady.overlaps.some(x=>x.workers.includes("A1")&&x.workers.includes("A2")),"overlapping worker scopes must be surfaced");
assert(squadReady.blockers.some(x=>x.workerId==="A3"),"worker blockers must survive squad convergence");
assert(squadReady.dependencies.includes("dep-a")&&squadReady.dependencies.includes("dep-b"),"dependency changes must be aggregated");
assert(squadReady.newlyUnlockedMissionIds.includes("unlock-me"),"newly unlocked dependent missions must be surfaced");
assert(convergenceState.convergence.squads.A.last.id===squadReady.id,"squad convergence must persist latest checkpoint");
assert(convergenceState.convergence.squads.A.history.length>=2,"squad convergence history must be persisted");

const verificationFixture=createVerificationState("conv-mission");
for(const gate of ["git","ci","runtime","acceptance","orchestrator"])recordGate(verificationFixture,gate,{status:"pass",evidence:[gate+"-evidence"]});
const builderResults=[
 {result_id:"br-a",builder_slot:"builder-a",blockers:[],remaining_implementation:[]},
 {result_id:"br-b",builder_slot:"builder-b",blockers:[],remaining_implementation:[]}
];
const progress=recordObjectiveProgress(convergenceState,"conv-mission",{
 research:{complete:true,evidence:["chat-cycle"]},
 work:{approved:true,evidence:["delta"]},
 build:{results:builderResults,evidence:["builder-results"]},
 orchestrator:{state:"COMPLETE",evidence:["orchestrator-decision"]},
 verification:verificationFixture
});
assert(OBJECTIVE_STAGES.length===7,"objective progress should cover seven canonical stages");
assert(progress.status==="complete"&&progress.percent===100&&progress.currentStage==="complete","fully verified mission should reach 100% objective progress");
assert(convergenceState.objectiveProgress["conv-mission"].percent===100,"objective progress must persist");

const incompleteProgress=deriveObjectiveProgress("partial-progress",{
 research:{complete:true},
 work:{approved:true},
 build:{results:[{blockers:["blocked"],remaining_implementation:[]}]},
 orchestrator:{state:"REPAIR"},
 verification:createVerificationState("partial-progress")
});
assert(incompleteProgress.status==="attention","blocked build/orchestrator state should require attention");
assert(incompleteProgress.currentStage==="build","objective progress should stop at first incomplete stage");

const finalReady=finalMissionConvergence(convergenceState,"conv-mission",{
 builderResults,
 orchestratorDecision:{decision_id:"orch-1",state:"COMPLETE"},
 verification:verificationFixture
});
assert(finalReady.verified===true&&finalReady.missingGates.length===0,"final mission convergence requires builders, orchestrator and all verification gates");
assert(convergenceState.convergence.missions["conv-mission"].verified===true,"final mission convergence must persist");

const verificationMissingRuntime=createVerificationState("conv-mission");
for(const gate of ["git","ci","acceptance","orchestrator"])recordGate(verificationMissingRuntime,gate,{status:"pass"});
const finalBlocked=finalMissionConvergence(convergenceState,"conv-mission",{
 builderResults,
 orchestratorDecision:{state:"COMPLETE"},
 verification:verificationMissingRuntime
});
assert(finalBlocked.verified===false&&finalBlocked.missingGates.includes("runtime"),"missing runtime verification must block final convergence");

const finalBuilderBlocked=finalMissionConvergence(convergenceState,"conv-mission",{
 builderResults:[{result_id:"bad",blockers:["merge conflict"],remaining_implementation:[]}],
 orchestratorDecision:{state:"COMPLETE"},
 verification:verificationFixture
});
assert(finalBuilderBlocked.verified===false&&finalBuilderBlocked.buildersComplete===false,"builder blockers must block final convergence");

console.log("Titan Workforce Core self-test PASS");
