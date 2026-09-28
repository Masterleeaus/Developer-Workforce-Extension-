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
import {classifyCIFailure,recoveryRoute} from "./ci-failures.js";
import {createVerificationState,recordGate,verificationDecision} from "./verification-plane.js";
const services=new TitanExecutionServices();services.register("github",{capabilities:["truth"]});assert(services.available("github"),"service registry");
assert(classifyCIFailure({message:"tenant isolation integration test failed"})==="TENANT_ISOLATION_FAILURE","CI taxonomy");
const vv=createVerificationState("scope1");recordGate(vv,"git",{status:"pass"});recordGate(vv,"ci",{status:"fail",details:{message:"typescript typecheck failed"}});
const vd=verificationDecision(vv);assert(vd.decision==="REPAIR"&&vd.failureType==="TYPE_FAILURE","verification recovery route");

console.log("Titan Workforce Core self-test PASS");
