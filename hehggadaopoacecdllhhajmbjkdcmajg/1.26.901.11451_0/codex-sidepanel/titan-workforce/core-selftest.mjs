import {CHAT_SLOTS,SUPERVISOR_SLOTS,BUILDER_SLOTS,ORCHESTRATOR_SLOTS,SLOT_IDS,SLOT_CLASS} from "./constants.js";
import {canonicalSlotId,canonicalSupervisorForSquad,canonicalizePipelineSlot} from "./slot-id-adapter.js";
import {createWorkforceState,validateWorkforceState} from "./state.js";
import {migrateLegacy5x5} from "./migrations.js";

function assert(x,m){if(!x)throw new Error(m)}
assert(SLOT_IDS.length===15,"expected 15 slots");
for(const id of CHAT_SLOTS)assert(SLOT_CLASS[id]==="chat_worker",id+" class");
for(const id of SUPERVISOR_SLOTS)assert(SLOT_CLASS[id]==="work_supervisor",id+" class");
for(const id of BUILDER_SLOTS)assert(SLOT_CLASS[id]==="codex_builder",id+" class");
for(const id of ORCHESTRATOR_SLOTS)assert(SLOT_CLASS[id]==="codex_orchestrator",id+" class");
const s=createWorkforceState();assert(validateWorkforceState(s),"fresh state invalid");
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
import {TitanWorkforceController} from "./controller.js";
import {TitanWorkforceIntegration} from "./integration.js";
import {classifyCIFailure,recoveryRoute} from "./ci-failures.js";
import {createVerificationState,recordGate,verificationDecision} from "./verification-plane.js";
const services=new TitanExecutionServices();services.register("github",{capabilities:["truth"]});assert(services.available("github"),"service registry");

const routingState=createWorkforceState();
const routingServices=new TitanExecutionServices();
const calls=[];
routingServices.register("work",{review:async x=>{calls.push({kind:"work",...x});return {ok:true}}});
routingServices.register("codex",{build:async x=>{calls.push({kind:"codex",...x});return {ok:true}}});
const routingController=new TitanWorkforceController(routingState,{services:routingServices});
const routingMissions=new TitanMissionControl(routingState);
const routingIntegration=new TitanWorkforceIntegration({state:routingState,controller:routingController,missionControl:routingMissions,services:routingServices});
await routingIntegration.requestWorkReviewForPipelineSlot("supervisor-a",{mission:{id:"mA"}});
await routingIntegration.requestWorkReviewForPipelineSlot("supervisor-b",{mission:{id:"mB"}});
await routingIntegration.dispatchCodexPacket("builder-a",{builder_slot:"builder-a",mission:{id:"mA"},packet_id:"pA"});
await routingIntegration.dispatchCodexPacket("builder-b",{builder_slot:"builder-b",mission:{id:"mB"},packet_id:"pB"});
assert(calls[0].supervisorId==="SUPERVISOR_A","WP3 Supervisor A must route to canonical supervisor");
assert(calls[1].supervisorId==="SUPERVISOR_B","WP3 Supervisor B must route to canonical supervisor");
assert(calls[2].builderId==="BUILDER_A","WP3 Builder A must route to canonical builder");
assert(calls[3].builderId==="BUILDER_B","WP3 Builder B must route to canonical builder");
let mismatch=false;try{await routingIntegration.dispatchCodexPacket("builder-a",{builder_slot:"builder-b",mission:{id:"mX"}})}catch(e){mismatch=e.code==="BUILDER_SLOT_MISMATCH"}assert(mismatch,"builder packet mismatch must fail closed");
assert(classifyCIFailure({message:"tenant isolation integration test failed"})==="TENANT_ISOLATION_FAILURE","CI taxonomy");
const vv=createVerificationState("scope1");recordGate(vv,"git",{status:"pass"});recordGate(vv,"ci",{status:"fail",details:{message:"typescript typecheck failed"}});
const vd=verificationDecision(vv);assert(vd.decision==="REPAIR"&&vd.failureType==="TYPE_FAILURE","verification recovery route");

console.log("Titan Workforce Core self-test PASS");
