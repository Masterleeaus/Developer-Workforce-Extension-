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

 const integration=new TitanWorkforceIntegration({state,controller,missionControl:missions,services,capabilities,audit});
 integration.bindGlobals();
 const save=async()=>{state.updatedAt=Date.now();await storage.set({[WORKFORCE_STORAGE_KEY]:state});return true};
 const liveChat=new TitanLiveChatRuntime({state,integration,missionControl:missions,services,audit,save,pollMs});
 if(startTimer)liveChat.start();
 const controls=new TitanWorkforceControls(controller,audit);
 const mergeController=new TitanMergeController({audit});

 const api={
  state,controller,missions,services,capabilities,mcp,approvals,executionCapabilities,
  integration,liveChat,controls,mergeController,
  stopNativeEventBridge,
  stopCapabilityResync:()=>eventTarget?.removeEventListener?.("titan:stock-native-service",resyncCapabilities),
  save,
  dispose(){
   liveChat.stop();
   stopNativeEventBridge?.();
   eventTarget?.removeEventListener?.("titan:stock-native-service",resyncCapabilities);
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
