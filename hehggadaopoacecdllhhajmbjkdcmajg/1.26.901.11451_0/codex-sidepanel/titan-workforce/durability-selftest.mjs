import {createWorkforceState} from "./state.js";
import {
 TitanAuditLog,TitanSendLedger,ensureDurabilityState,beginRecoverySession,finishRecoverySession,
 reconcileBoundConversations,markRecoveryReconciled,durableActionKey,validApprovalType
} from "./durability.js";
import {TitanApprovalStore} from "./approvals.js";
import {TitanExecutionServices} from "./execution-services.js";
import {TitanWorkforceController} from "./controller.js";
import {TitanMissionControl} from "./mission-control.js";
import {TitanWorkforceIntegration} from "./integration.js";
import {TitanRuntimeOwner} from "./runtime-owner.js";

function assert(x,m){if(!x)throw new Error(m)}
function expectCode(fn,code){return Promise.resolve().then(fn).then(()=>false,e=>e?.code===code)}

const state=ensureDurabilityState(createWorkforceState());
const audit=new TitanAuditLog(state,{maxEntries:100});
for(let i=0;i<120;i++)audit.append("test",{i});
assert(state.auditLog.length===100,"audit log not bounded");
assert(state.auditLog[0].data.i===20,"audit log did not retain newest entries");

const ledger=new TitanSendLedger(state,{maxEntries:200});
const chatKey="m1/c1/A1/1";
assert(ledger.begin({key:chatKey,kind:"chat-pass",missionId:"m1",agentId:"A1"}).ok,"first Chat action claim failed");
assert(ledger.begin({key:chatKey,kind:"chat-pass",missionId:"m1",agentId:"A1"}).duplicate,"duplicate Chat claim not suppressed");
ledger.markSent(chatKey);ledger.complete(chatKey);
assert(ledger.get(chatKey).status==="completed","Chat ledger completion failed");

const crashKey=durableActionKey("codex-build","m2","BUILDER_A","p1");
ledger.begin({key:crashKey,kind:"codex-build",missionId:"m2",agentId:"BUILDER_A"});ledger.markSent(crashKey);
const recovered=ledger.recoverAmbiguous();
assert(recovered.some(x=>x.key===crashKey&&x.status==="recovery-required"),"ambiguous sent action not recovered");
assert(!state.controls.armed&&state.controls.requiresReconciliation,"ambiguous action did not fail closed");

const sessionState=ensureDurabilityState(createWorkforceState());
beginRecoverySession(sessionState,{sessionId:"s1"});
const restart=beginRecoverySession(sessionState,{sessionId:"s2"});
assert(restart.unclean===true,"unclean session was not detected");
assert(sessionState.controls.requiresReconciliation&&!sessionState.controls.armed,"unclean session did not force reconciliation");
finishRecoverySession(sessionState);
assert(sessionState.recovery.session.active===false,"clean shutdown not recorded");

state.agents.A1.conversation={key:"https://chatgpt.com/c/good",tabId:1};
state.agents.A2.conversation={key:"https://chatgpt.com/c/bad",tabId:2};
const conv=await reconcileBoundConversations(state,{assertConversation:async c=>{if(c.tabId===2){const e=new Error("bad");e.code="CONVERSATION_IDENTITY_MISMATCH";throw e}return c}});
assert(!conv.ok,"bad conversation identity did not fail reconciliation");
assert(state.agents.A2.control.paused&&state.agents.A2.health==="identity-mismatch","bad conversation was not paused");
let reconcileBlocked=false;try{markRecoveryReconciled(state)}catch(e){reconcileBlocked=["PENDING_ACTIONS_UNRESOLVED","CONVERSATION_RECONCILIATION_FAILED"].includes(e.code)}
assert(reconcileBlocked,"reconciliation passed with unresolved state");
ledger.reconcile(crashKey,{resolvedStatus:"completed",note:"verified externally"});
state.agents.A2.conversation=null;
await reconcileBoundConversations(state,{assertConversation:async c=>c});
markRecoveryReconciled(state,{evidence:{operator:"test"}});
assert(!state.controls.requiresReconciliation&&!state.controls.armed,"reconciliation must remain disarmed");

let saves=0;
const approvalState=ensureDurabilityState(createWorkforceState());
const approvals=new TitanApprovalStore(approvalState,{save:async()=>{saves++}});
for(const type of ["force-merge","verification-override","scope-expansion","lifecycle-action","high-impact:production-deploy:server.deploy","secret-access:github-token"]){
 assert(validApprovalType(type),"expected approval type rejected: "+type);
 const pending=await approvals.request({type,missionId:"m3",packetId:type});
 approvals.decide(pending.id,{approved:true,actor:"tester"});
}
await Promise.resolve();
assert(saves>=6,"approval mutations did not request persistence");
let badType=false;try{approvals.create({type:"made-up",missionId:"m3"})}catch(e){badType=e.code==="UNKNOWN_APPROVAL_TYPE"}
assert(badType,"unknown approval type not rejected");

const execState=ensureDurabilityState(createWorkforceState());
let persistCount=0,workCalls=0,buildCalls=0,orchCalls=0;
const execLedger=new TitanSendLedger(execState);
const services=new TitanExecutionServices();
services.register("work",{review:async()=>{assert(execLedger.pending().some(x=>x.kind==="work-review"),"Work claim not persisted before side effect");workCalls++;return{ok:true}}});
services.register("codex",{
 build:async()=>{assert(execLedger.pending().some(x=>x.kind==="codex-build"),"Codex claim missing before side effect");buildCalls++;return{ok:true}},
 orchestrate:async()=>{assert(execLedger.pending().some(x=>x.kind==="codex-orchestrate"),"Orchestrator claim missing before side effect");orchCalls++;return{ok:true}}
});
const missions=new TitanMissionControl(execState);
const controller=new TitanWorkforceController(execState,{services,missionControl:missions});
const integration=new TitanWorkforceIntegration({state:execState,controller,missionControl:missions,services,sendLedger:execLedger,save:async()=>{persistCount++}});
await integration.requestWorkReview("A",{mission:{id:"mw"},chat_cycle:{cycle_id:"c1"},review_id:"r1"});
assert(await expectCode(()=>integration.requestWorkReview("A",{mission:{id:"mw"},chat_cycle:{cycle_id:"c1"},review_id:"r1"}),"DUPLICATE_ACTION_SUPPRESSED"),"duplicate Work review was not suppressed");
assert(workCalls===1,"duplicate Work side effect occurred");
execState.agents.BUILDER_A.missionId="mb";
await integration.dispatchCodexPacket("BUILDER_A",{mission:{id:"mb"},packet_id:"packet-1"});
assert(await expectCode(()=>integration.dispatchCodexPacket("BUILDER_A",{mission:{id:"mb"},packet_id:"packet-1"}),"DUPLICATE_ACTION_SUPPRESSED"),"duplicate Codex build was not suppressed");
assert(buildCalls===1,"duplicate Codex side effect occurred");
await integration.orchestrate({mission:{id:"mo"},bundle_id:"bundle-1"});
assert(await expectCode(()=>integration.orchestrate({mission:{id:"mo"},bundle_id:"bundle-1"}),"DUPLICATE_ACTION_SUPPRESSED"),"duplicate Orchestrator action was not suppressed");
assert(orchCalls===1,"duplicate Orchestrator side effect occurred");
assert(persistCount>=9,"durable actions were not persisted around side effects");

const ambiguousState=ensureDurabilityState(createWorkforceState());
const ambiguousLedger=new TitanSendLedger(ambiguousState);
const ambiguousServices=new TitanExecutionServices();
ambiguousServices.register("work",{review:async()=>{throw new Error("transport disconnected after request")}});
const ambiguousMissions=new TitanMissionControl(ambiguousState);
const ambiguousController=new TitanWorkforceController(ambiguousState,{services:ambiguousServices,missionControl:ambiguousMissions});
const ambiguousIntegration=new TitanWorkforceIntegration({state:ambiguousState,controller:ambiguousController,missionControl:ambiguousMissions,services:ambiguousServices,sendLedger:ambiguousLedger,save:async()=>{}});
let ambiguous=false;try{await ambiguousIntegration.requestWorkReview("A",{mission:{id:"ma"},chat_cycle:{cycle_id:"c9"},review_id:"r9"})}catch{ambiguous=ambiguousLedger.pending().some(x=>x.status==="recovery-required")}
assert(ambiguous,"unknown external failure was not made recovery-required");
assert(ambiguousState.controls.requiresReconciliation,"ambiguous external failure did not require reconciliation");

class FakeScheduler{
 constructor(){this.worker={id:"A1",missionId:"chat-m",cycleId:"cycle-1",currentPass:0,completedPasses:[],state:"WAITING_GATE",health:"ready",lastDispatchAt:null};this.confirmed=false}
 snapshot(){return{workers:{A1:this.worker}}}
 getWorker(){return this.worker}
 bindConversation(){}
 inspectGate(){return this.confirmed?{action:"none"}:{action:"dispatch",key:"chat-m/cycle-1/A1/1",missionId:"chat-m",cycleId:"cycle-1",passNumber:1,instruction:"Do pass 1"}}
 confirmDispatch(){this.confirmed=true;this.worker.currentPass=1;this.worker.lastDispatchAt=Date.now()}
 setSlowdown(){}
}
globalThis.TitanChatFivePass={ChatFivePassScheduler:FakeScheduler};
const {TitanLiveChatRuntime}=await import("./live-chat-runtime.js?durability-test=1");
const chatState=ensureDurabilityState(createWorkforceState());
chatState.controls.armed=true;
chatState.agents.A1.conversation={key:"https://chatgpt.com/c/test",tabId:1};
chatState.missions["chat-m"]={id:"chat-m",status:"assigned",assignedAgent:"A1"};
chatState.agents.A1.missionId="chat-m";
let chatSaves=0,chatSends=0;
const chatLedger=new TitanSendLedger(chatState);
const chatService={assertConversation:async()=>true,observe:async()=>({assistantCount:0,generating:false,lastText:""}),send:async()=>{assert(chatLedger.get("chat-m/cycle-1/A1/1")?.status==="claimed","Chat claim missing before send");assert(chatSaves>0,"Chat claim not persisted before send");chatSends++;return{ok:true}}};
const chatIntegration={
 controller:{registry:{get:id=>chatState.agents[id]||null,list:cls=>Object.values(chatState.agents).filter(x=>x.executionClass===cls)}},
 dispatchChatPass:async(_id,action)=>chatService.send({instruction:action.instruction}),
 pipelineApi:null
};
const chatRuntime=new TitanLiveChatRuntime({state:chatState,integration:chatIntegration,missionControl:{get:id=>chatState.missions[id]||null},services:{require:()=>chatService},sendLedger:chatLedger,save:async()=>{chatSaves++}});
await chatRuntime.tickWorker("A1");
assert(chatLedger.get("chat-m/cycle-1/A1/1").status==="completed","Chat durable action did not complete");
chatRuntime.scheduler.confirmed=false;chatRuntime.scheduler.worker.currentPass=0;
const duplicateChat=await chatRuntime.tickWorker("A1");
assert(duplicateChat.action==="duplicate-suppressed"&&chatSends===1,"duplicate five-pass Chat send was not suppressed");

let finishCalls=0,saveCalls=0;
const fakeApi={state:createWorkforceState(),liveChat:{tick:async()=>{},stop:()=>{}},lifecycle:{run:async()=>{}},save:async()=>{saveCalls++},finishSession:async()=>{finishCalls++},controller:{},missions:{},controls:{}};
const owner=new TitanRuntimeOwner({createRuntime:async()=>fakeApi,alarms:null,runtime:null,tabs:null});
await owner.ensure();await owner.suspend();
assert(finishCalls===1&&saveCalls===1,"MV3 suspend did not record clean session before save");

console.log("Titan durability/restart recovery self-test PASS");
