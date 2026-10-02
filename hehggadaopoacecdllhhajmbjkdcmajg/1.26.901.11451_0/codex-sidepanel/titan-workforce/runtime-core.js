import {createWorkforceState} from "./state.js";
import {migrateWorkforceState} from "./migrations.js";
import {TitanWorkforceController} from "./controller.js";
import {TitanMissionControl} from "./mission-control.js";
import {TitanExecutionServices} from "./execution-services.js";
import {TitanCapabilityBroker} from "./capability-broker.js";
import {TitanMcpRegistry,installMcpService} from "./mcp-registry.js";
import {installExecutionCapabilities} from "./execution-capabilities.js";
import {TitanWorkforceIntegration} from "./integration.js";
import {installLegacyNativeBridge,installConversationServices,installStockNativeEventBridge} from "./native-bridge.js";
import {installStockServiceFallbacks} from "./stock-service-fallbacks.js";
import {createConversationService,bindConversation as resolveConversationBinding} from "./conversation-service.js";
import {buildCockpitDiagnostics} from "./cockpit-diagnostics.js";
import {TitanWorkforceControls} from "./controls.js";
import {TitanMergeController} from "./merge-controller.js";
import {TitanApprovalStore,persistApprovedScopeExpansion} from "./approvals.js";
import {createHighImpactAuthorizer} from "./high-impact-policy.js";
import {TitanCredentialBroker} from "./credential-broker.js";
import {TitanRuntimeVerifierRegistry,verifyMissionRuntime} from "./runtime-verifiers.js";
import {createAuthoritativeChangedPathResolver} from "./changed-path-evidence.js";
import {enforceScopedCodexBuildCapability} from "./scoped-codex-capability.js";
import {TitanLiveChatRuntime} from "./live-chat-runtime.js";
import {TitanArchitectureIndex} from "./architecture-index.js";
import {TitanRepositoryIntelligence} from "./repository-intelligence.js";
import {TitanMissionCompiler} from "./mission-compiler.js";
import {TitanContextCompiler} from "./context-compiler.js";
import {TitanUsageGovernor} from "./usage-governor.js";
import {TitanLifecycleManager} from "./maintenance.js";
import {TitanWorkforceObservability} from "./observability.js";
import {TitanConversationLifecycle} from "./conversation-lifecycle.js";
import {TitanSingleTabTaskPump} from "./single-tab-task-pump.js";
import {ensureDurabilityState,TitanAuditLog,TitanSendLedger,beginRecoverySession,finishRecoverySession,reconcileBoundConversations,markRecoveryReconciled} from "./durability.js";

export const WORKFORCE_STORAGE_KEY="titanDeveloperWorkforceV4";
export const LEGACY_STORAGE_KEY="titan5x5.state.v2";

function emit(target,type,detail){
 try{
  if(typeof target?.dispatchEvent==="function"&&typeof CustomEvent==="function"){
   target.dispatchEvent(new CustomEvent(type,{detail}));
  }
 }catch{}
}
function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}

export async function createTitanWorkforceRuntime({
 storage=globalThis.chrome?.storage?.local,
 eventTarget=globalThis,
 fetchImpl=globalThis.fetch,
 startTimer=false,
 pollMs=6000
}={}){
 if(!storage?.get||!storage?.set)throw new Error("Workforce runtime requires chrome.storage.local");
 const stored=await storage.get([WORKFORCE_STORAGE_KEY,LEGACY_STORAGE_KEY]);
 const state=ensureDurabilityState(stored[WORKFORCE_STORAGE_KEY]
  ?migrateWorkforceState(stored[WORKFORCE_STORAGE_KEY])
  :migrateWorkforceState(stored[LEGACY_STORAGE_KEY]||createWorkforceState()));
 const save=async()=>{state.updatedAt=Date.now();await storage.set({[WORKFORCE_STORAGE_KEY]:state});return true};

 let observability=null;
 let conversationLifecycle=null;
 const auditLog=new TitanAuditLog(state,{maxEntries:2000});
 const audit=(type,data={})=>{
  const entry=auditLog.append(type,{...clone(data),owner:"background"});
  const at=entry.at;
  try{observability?.recordAudit(type,data,{at})}catch(error){
   state.observabilityErrors=Array.isArray(state.observabilityErrors)?state.observabilityErrors:[];
   state.observabilityErrors.push({at,type,message:String(error?.message||error)});
   state.observabilityErrors=state.observabilityErrors.slice(-100);
  }
  try{
   if(conversationLifecycle){
    if(type==="chat-pass-completed"&&data.workerId)conversationLifecycle.note(data.workerId,{contextCharacters:Number(data.characters||0),cycleCompleted:data.cycleCompleted===true});
    else if(type==="chat-runtime-error"&&data.workerId)conversationLifecycle.note(data.workerId,{failure:true});
    else if(type==="supervisor-review-requested"&&data.supervisorId)conversationLifecycle.note(data.supervisorId,{cycleCompleted:true});
   }
  }catch{}
  emit(eventTarget,"titan-workforce:audit",{type,data,at,id:entry.id,owner:"background"});
 };
 observability=new TitanWorkforceObservability(state);
 const recoverySession=beginRecoverySession(state,{audit});
 const sendLedger=new TitanSendLedger(state,{audit});
 const ambiguousActions=sendLedger.recoverAmbiguous();
 if(recoverySession.unclean||ambiguousActions.length){state.controls.armed=false;state.controls.requiresReconciliation=true}

 const services=new TitanExecutionServices();
 const capabilities=new TitanCapabilityBroker({audit});
 const mcp=new TitanMcpRegistry({broker:capabilities,audit});
 installMcpService(services,mcp,audit);
 const missions=new TitanMissionControl(state,{audit});
 const controller=new TitanWorkforceController(state,{audit,services,missionControl:missions});
 const stopNativeEventBridge=installStockNativeEventBridge(services,audit,eventTarget);
 installLegacyNativeBridge(services,audit);
 const conversations=createConversationService();
 const singleTabTasks=new TitanSingleTabTaskPump({state,conversationService:conversations,save,audit});
 installConversationServices(services,{chat:conversations,work:conversations},audit);
 const conversationRecovery=await reconcileBoundConversations(state,conversations,{audit});
 installStockServiceFallbacks(services,{registry:controller.registry,conversationService:conversations,fetchImpl,audit});
 const executionCapabilities=installExecutionCapabilities({services,broker:capabilities,audit});
 executionCapabilities.sync();
 const approvals=new TitanApprovalStore(state,{audit,save});
 const credentials=new TitanCredentialBroker(state,{audit,approvalStore:approvals});
 const runtimeVerifiers=new TitanRuntimeVerifierRegistry({audit});
 capabilities.authorize=createHighImpactAuthorizer({approvalStore:approvals,audit});
 const installScopeGuard=()=>enforceScopedCodexBuildCapability(capabilities,{
  getChangedPaths:createAuthoritativeChangedPathResolver(capabilities,{audit}),
  audit,
  requestApproval:req=>approvals.request(req),
  persistScopeExpansion:persistApprovedScopeExpansion({state,missionControl:missions,audit,save})
 });
 installScopeGuard();
 const resyncCapabilities=()=>queueMicrotask(()=>{executionCapabilities.sync();installScopeGuard()});
 eventTarget?.addEventListener?.("titan:stock-native-service",resyncCapabilities);

 const usageGovernor=new TitanUsageGovernor(state,{audit});
 const architecture=new TitanArchitectureIndex({audit});
 const repositoryIntelligence=new TitanRepositoryIntelligence({state,audit});
 const integration=new TitanWorkforceIntegration({state,controller,missionControl:missions,services,capabilities,repositoryIntelligence,architectureIndex:architecture,usageGovernor,sendLedger,save,audit});
 integration.bindGlobals();
 const missionCompiler=new TitanMissionCompiler({profiles:integration.profileApi,audit});
 const contextCompiler=new TitanContextCompiler({profiles:integration.profileApi,contextProvider:(missionId,opts)=>integration.contextForMission(missionId,opts),provenance:integration.provenance,usageGovernor,audit});
 const liveChat=new TitanLiveChatRuntime({state,integration,missionControl:missions,services,usageGovernor,sendLedger,audit,save,pollMs,eventTarget});
 const replaceAgentConversation=async(agentId,conversation,{checkpoint=null}={})=>{
  const slot=controller.registry.get(agentId);if(!slot)throw new Error("Unknown agent "+agentId);
  if(!["chat_worker","work_supervisor"].includes(slot.executionClass))throw new Error("Conversation replacement is only supported for Chat workers and Work supervisors");
  if(slot.executionClass==="chat_worker")return liveChat.replaceConversation(agentId,conversation,{checkpointId:checkpoint?.id||null});
  const work=services.require("work");
  await work.assertConversation?.(conversation);
  slot.conversation=clone(conversation);slot.health="ready";slot.updatedAt=Date.now();
  audit("work-conversation-rotated",{agentId,missionId:slot.missionId||null,toKey:conversation.key,checkpointId:checkpoint?.id||null});
  return clone(slot);
 };
 conversationLifecycle=new TitanConversationLifecycle({
  state,registry:controller.registry,missionControl:missions,provenance:integration.provenance,
  conversationService:conversations,bindReplacement:replaceAgentConversation,audit,save
 });

 const bindAgentConversation=async(agentId,conversationOrTabId)=>{
  const slot=controller.registry.get(agentId);
  if(!slot)throw new Error("Unknown agent "+agentId);
  if(!["chat_worker","work_supervisor"].includes(slot.executionClass))throw new Error("Conversation binding is only supported for Chat workers and Work supervisors");
  const conversation=conversationOrTabId&&typeof conversationOrTabId==="object"&&conversationOrTabId.key
   ?clone(conversationOrTabId)
   :await resolveConversationBinding(Number(conversationOrTabId));
  if(slot.executionClass==="chat_worker")return liveChat.bindConversation(agentId,conversation);
  if(slot.conversation?.key&&slot.conversation.key!==conversation.key)throw new Error("Conversation identity lock mismatch for "+agentId);
  slot.conversation=clone(conversation);slot.health="ready";slot.updatedAt=Date.now();
  audit("work-conversation-bound",{agentId,key:conversation.key,tabId:conversation.tabId});
  await save();return clone(slot);
 };
 if(startTimer)liveChat.start();
 const controls=new TitanWorkforceControls(controller,audit);
 const mergeController=new TitanMergeController({audit});
 const lifecycle=new TitanLifecycleManager({
  state,
  missionControl:missions,
  registry:controller.registry,
  mergeController,
  audit,
  save,
  requestApproval:req=>approvals.request(req)
 });
 const onMergeIndex=event=>{
  const d=event?.detail||{};
  if(!d.repository||!d.nextCommit||!Array.isArray(d.changes))return;
  try{
   repositoryIntelligence.applyChanges({
    repository:d.repository,
    baseCommit:d.baseCommit,
    nextCommit:d.nextCommit,
    changes:d.changes
   });
   save().catch(()=>{});
  }catch(error){
   audit("repository-index-refresh-failed",{repository:d.repository,nextCommit:d.nextCommit,message:String(error?.message||error)});
  }
 };
 eventTarget?.addEventListener?.("titan-workforce:merge-complete",onMergeIndex);

 const reconcileRecovery=async({evidence={}}={})=>{
  await reconcileBoundConversations(state,conversations,{audit});
  markRecoveryReconciled(state,{audit,evidence});
  controller.markReconciled?.(evidence);
  await save();
  return {ok:true,pendingActions:sendLedger.pending(),conversationReconciliation:clone(state.recovery.conversationReconciliation||null)};
 };
 const finishSession=async()=>{finishRecoverySession(state,{audit});await save();return true};
 const api={
  state,controller,missions,services,capabilities,mcp,approvals,credentials,runtimeVerifiers,auditLog,sendLedger,executionCapabilities,
  integration,architecture,repositoryIntelligence,missionCompiler,contextCompiler,usageGovernor,liveChat,controls,mergeController,lifecycle,observability,conversationLifecycle,singleTabTasks,
  bindAgentConversation,reconcileRecovery,finishSession,
  reconcileAction:(key,result)=>{const out=sendLedger.reconcile(key,result);save().catch(()=>{});return out},
  diagnostics:()=>buildCockpitDiagnostics(api),
  metrics:()=>observability.metrics({agents:controller.registry.list()}),
  replayEvents:options=>observability.replay(options),
  exportDiagnostics:options=>observability.exportBundle({agents:controller.registry.list(),...(options||{})}),
  stopNativeEventBridge,
  stopCapabilityResync:()=>eventTarget?.removeEventListener?.("titan:stock-native-service",resyncCapabilities),
  stopRepositoryIndexRefresh:()=>eventTarget?.removeEventListener?.("titan-workforce:merge-complete",onMergeIndex),
  verifyMissionRuntime:async missionId=>{const mission=missions.get(missionId);if(!mission)throw new Error("Unknown mission "+missionId);return verifyMissionRuntime(mission,{services,registry:runtimeVerifiers,audit})},
  save,
  dispose(){
   liveChat.stop();
   finishRecoverySession(state,{audit});
   stopNativeEventBridge?.();
   eventTarget?.removeEventListener?.("titan:stock-native-service",resyncCapabilities);
   eventTarget?.removeEventListener?.("titan-workforce:merge-complete",onMergeIndex);
  }
 };
 globalThis.TitanCapabilityBroker=capabilities;
 globalThis.TitanMcpRegistry=mcp;
 globalThis.TitanDeveloperWorkforce=api;
 await save();
 emit(eventTarget,"titan-workforce:ready",{schemaVersion:state.schemaVersion,readiness:integration.readiness(),owner:"background",recovery:{unclean:recoverySession.unclean,ambiguousActions:ambiguousActions.length,conversationsOk:conversationRecovery.ok}});
 return api;
}

export function workforceRuntimeSnapshot(api){
 if(!api)return null;
 const agents=api.controller.registry.list();
 return clone({
  owner:"background-service-worker",
  state:api.state,
  agents,
  missions:api.missions.list(),
  services:api.services.status(),
  mcp:api.mcp?.status?.()||null,
  capabilities:api.capabilities?.status?.()||null,
  usage:api.usageGovernor?.status?.()||null,
  recovery:clone(api.state.recovery||null),
  lifecycle:clone(api.state.lifecycle||null),
  mergePressure:api.mergeController?.state||null,
  readiness:api.integration.readiness(),
  observability:{
   eventCount:api.state.eventLog?.length||0,
   metrics:api.observability?.metrics?.({agents})||null,
   replay:api.observability?.replay?.()||null
  }
 });
}
