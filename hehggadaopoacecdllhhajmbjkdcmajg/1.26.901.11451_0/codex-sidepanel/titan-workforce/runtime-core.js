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
 const state=stored[WORKFORCE_STORAGE_KEY]
  ?migrateWorkforceState(stored[WORKFORCE_STORAGE_KEY])
  :migrateWorkforceState(stored[LEGACY_STORAGE_KEY]||createWorkforceState());

 const audit=(type,data={})=>{
  state.auditLog=Array.isArray(state.auditLog)?state.auditLog:[];
  state.auditLog.push({type,data:clone(data),at:Date.now(),owner:"background"});
  state.auditLog=state.auditLog.slice(-1000);
  emit(eventTarget,"titan-workforce:audit",{type,data,at:Date.now(),owner:"background"});
 };

 const services=new TitanExecutionServices();
 const capabilities=new TitanCapabilityBroker({audit});
 const mcp=new TitanMcpRegistry({broker:capabilities,audit});
 installMcpService(services,mcp,audit);
 const controller=new TitanWorkforceController(state,{audit,services});
 const missions=new TitanMissionControl(state);
 const stopNativeEventBridge=installStockNativeEventBridge(services,audit,eventTarget);
 installLegacyNativeBridge(services,audit);
 const conversations=createConversationService();
 installConversationServices(services,{chat:conversations,work:conversations},audit);
 installStockServiceFallbacks(services,{registry:controller.registry,conversationService:conversations,fetchImpl,audit});
 const executionCapabilities=installExecutionCapabilities({services,broker:capabilities,audit});
 executionCapabilities.sync();
 const approvals=new TitanApprovalStore(state,{audit});
 const credentials=new TitanCredentialBroker(state,{audit,approvalStore:approvals});
 const runtimeVerifiers=new TitanRuntimeVerifierRegistry({audit});
 capabilities.authorize=createHighImpactAuthorizer({approvalStore:approvals,audit});
 const installScopeGuard=()=>enforceScopedCodexBuildCapability(capabilities,{
  getChangedPaths:createAuthoritativeChangedPathResolver(capabilities,{audit}),
  audit,
  requestApproval:req=>approvals.request(req),
  persistScopeExpansion:persistApprovedScopeExpansion({state,missionControl:missions,audit})
 });
 installScopeGuard();
 const resyncCapabilities=()=>queueMicrotask(()=>{executionCapabilities.sync();installScopeGuard()});
 eventTarget?.addEventListener?.("titan:stock-native-service",resyncCapabilities);

 const usageGovernor=new TitanUsageGovernor(state,{audit});
 const architecture=new TitanArchitectureIndex({audit});
 const repositoryIntelligence=new TitanRepositoryIntelligence({state,audit});
 const integration=new TitanWorkforceIntegration({state,controller,missionControl:missions,services,capabilities,repositoryIntelligence,architectureIndex:architecture,usageGovernor,audit});
 integration.bindGlobals();
 const missionCompiler=new TitanMissionCompiler({profiles:integration.profileApi,audit});
 const contextCompiler=new TitanContextCompiler({profiles:integration.profileApi,contextProvider:(missionId,opts)=>integration.contextForMission(missionId,opts),provenance:integration.provenance,usageGovernor,audit});
 const save=async()=>{state.updatedAt=Date.now();await storage.set({[WORKFORCE_STORAGE_KEY]:state});return true};
 const liveChat=new TitanLiveChatRuntime({state,integration,missionControl:missions,services,usageGovernor,audit,save,pollMs,eventTarget});
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

 const api={
  state,controller,missions,services,capabilities,mcp,approvals,credentials,runtimeVerifiers,executionCapabilities,
  integration,architecture,repositoryIntelligence,missionCompiler,contextCompiler,usageGovernor,liveChat,controls,mergeController,lifecycle,
  bindAgentConversation,
  diagnostics:()=>buildCockpitDiagnostics(api),
  stopNativeEventBridge,
  stopCapabilityResync:()=>eventTarget?.removeEventListener?.("titan:stock-native-service",resyncCapabilities),
  stopRepositoryIndexRefresh:()=>eventTarget?.removeEventListener?.("titan-workforce:merge-complete",onMergeIndex),
  verifyMissionRuntime:async missionId=>{const mission=missions.get(missionId);if(!mission)throw new Error("Unknown mission "+missionId);return verifyMissionRuntime(mission,{services,registry:runtimeVerifiers,audit})},
  save,
  dispose(){
   liveChat.stop();
   stopNativeEventBridge?.();
   eventTarget?.removeEventListener?.("titan:stock-native-service",resyncCapabilities);
   eventTarget?.removeEventListener?.("titan-workforce:merge-complete",onMergeIndex);
  }
 };
 globalThis.TitanCapabilityBroker=capabilities;
 globalThis.TitanMcpRegistry=mcp;
 globalThis.TitanDeveloperWorkforce=api;
 await save();
 emit(eventTarget,"titan-workforce:ready",{schemaVersion:state.schemaVersion,readiness:integration.readiness(),owner:"background"});
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
  lifecycle:clone(api.state.lifecycle||null),
  mergePressure:api.mergeController?.state||null,
  readiness:api.integration.readiness()
 });
}
