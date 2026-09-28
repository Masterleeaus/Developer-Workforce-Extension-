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
import {TitanWorkforceControls} from "./controls.js";
import {TitanWorkforceIntegration} from "./integration.js";
import {installLegacyNativeBridge} from "./native-bridge.js";
import {classifyCIFailure,recoveryRoute} from "./ci-failures.js";
import {createVerificationState,recordGate,verificationDecision} from "./verification-plane.js";
import {importLegacyVerification,evaluateBooleanEvidence} from "./verification-adapter.js";
const services=new TitanExecutionServices();services.register("github",{capabilities:["truth"]});assert(services.available("github"),"service registry");

const controlState=createWorkforceState();
const controlEvents=[];
const controlController=new TitanWorkforceController(controlState,{audit:(type,data)=>controlEvents.push({type,data})});
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

console.log("Titan Workforce Core self-test PASS");
