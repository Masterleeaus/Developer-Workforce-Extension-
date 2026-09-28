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
import {createConversationService} from "./conversation-service.js";
import {TitanWorkforceControls} from "./controls.js";
import {TitanMergeController} from "./merge-controller.js";
import {TitanApprovalStore,persistApprovedScopeExpansion} from "./approvals.js";
import {createAuthoritativeChangedPathResolver} from "./changed-path-evidence.js";
import {enforceScopedCodexBuildCapability} from "./scoped-codex-capability.js";
import {TitanLiveChatRuntime} from "./live-chat-runtime.js";
import {TitanArchitectureIndex} from "./architecture-index.js";
import {TitanRepositoryIntelligence} from "./repository-intelligence.js";
import {TitanMissionCompiler} from "./mission-compiler.js";
import {TitanContextCompiler} from "./context-compiler.js";
import {TitanWorkCodexRuntime} from "./work-codex-runtime.js";

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
 const installScopeGuard=()=>enforceScopedCodexBuildCapability(capabilities,{
  getChangedPaths:createAuthoritativeChangedPathResolver(capabilities,{audit}),
  audit,
  requestApproval:req=>approvals.request(req),
  persistScopeExpansion:persistApprovedScopeExpansion({state,missionControl:missions,audit})
 });
 installScopeGuard();
 const resyncCapabilities=()=>queueMicrotask(()=>{executionCapabilities.sync();installScopeGuard()});
 eventTarget?.addEventListener?.("titan:stock-native-service",resyncCapabilities);

 const architecture=new TitanArchitectureIndex({audit});
 const repositoryIntelligence=new TitanRepositoryIntelligence({state,audit});
 const integration=new TitanWorkforceIntegration({state,controller,missionControl:missions,services,capabilities,repositoryIntelligence,architectureIndex:architecture,audit});
 integration.bindGlobals();
 const missionCompiler=new TitanMissionCompiler({profiles:integration.profileApi,audit});
 const contextCompiler=new TitanContextCompiler({profiles:integration.profileApi,contextProvider:(missionId,opts)=>integration.contextForMission(missionId,opts),provenance:integration.provenance,audit});
 const save=async()=>{state.updatedAt=Date.now();await storage.set({[WORKFORCE_STORAGE_KEY]:state});return true};
 const workCodex=new TitanWorkCodexRuntime({state,integration,missionControl:missions,services,capabilities,audit,save});
 const liveChat=new TitanLiveChatRuntime({state,integration,missionControl:missions,services,pipelineRuntime:workCodex,audit,save,pollMs});
 if(startTimer)liveChat.start();
 const controls=new TitanWorkforceControls(controller,audit);
 const mergeController=new TitanMergeController({audit});
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
  state,controller,missions,services,capabilities,mcp,approvals,executionCapabilities,
  integration,architecture,repositoryIntelligence,missionCompiler,contextCompiler,workCodex,liveChat,controls,mergeController,
  stopNativeEventBridge,
  stopCapabilityResync:()=>eventTarget?.removeEventListener?.("titan:stock-native-service",resyncCapabilities),
  stopRepositoryIndexRefresh:()=>eventTarget?.removeEventListener?.("titan-workforce:merge-complete",onMergeIndex),
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
  readiness:api.integration.readiness()
 });
}
