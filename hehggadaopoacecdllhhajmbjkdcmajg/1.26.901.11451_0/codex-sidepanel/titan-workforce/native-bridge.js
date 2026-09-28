import {verifyDiffScope,requireScopeExpansion} from "./scope-locks.js";

function legacyServices(){
 const src=globalThis.TitanNativeServices?.services;
 return src instanceof Map?src:new Map();
}
function normalizeCodex(codex){
 if(!codex)return null;
 const request=typeof codex.request==="function"?codex.request.bind(codex):null;
 const review=typeof codex.review==="function"?codex.review.bind(codex):null;
 const build=typeof codex.build==="function"?codex.build.bind(codex):typeof codex.execute==="function"?codex.execute.bind(codex):null;
 const orchestrate=typeof codex.orchestrate==="function"?codex.orchestrate.bind(codex):review;
 if(!request&&!review&&!build&&!orchestrate)return null;
 return {source:codex.source||"native",capabilities:["request","review","build","orchestrate"].filter(k=>typeof ({request,review,build,orchestrate})[k]==="function"),request,review,build,orchestrate};
}
export function registerNativeService(services,kind,service,audit=()=>{}){
 if(!service)return false;
 const normalized=kind==="codex"?normalizeCodex(service):service;
 if(!normalized)return false;
 services.register(kind,normalized);
 audit("native-service-registered",{kind,source:normalized.source||service.source||"native",capabilities:normalized.capabilities||[]});
 return true;
}
export function installLegacyNativeBridge(services,audit=()=>{}){
 const legacy=legacyServices();
 for(const kind of ["codex","git","github","repository","runtime","terminal","browser","server"])registerNativeService(services,kind,legacy.get(kind),audit);
 audit("native-services-bridged",{available:services.status()});
 return services.status();
}
export function installStockNativeEventBridge(services,audit=()=>{},target=globalThis){
 if(!target?.addEventListener)return ()=>{};
 const handler=e=>{
  const d=e?.detail||{},kind=d.kind||d.name,service=d.service;
  if(!["codex","git","github","repository","runtime","terminal","browser","server"].includes(kind)||!service)return;
  registerNativeService(services,kind,service,audit);
 };
 target.addEventListener("titan:stock-native-service",handler);
 audit("stock-native-event-bridge-installed",{});
 return ()=>target.removeEventListener?.("titan:stock-native-service",handler);
}
export function installConversationServices(services,{chat=null,work=null}={},audit=()=>{}){
 if(chat)services.register("chat",chat);
 if(work)services.register("work",work);
 audit("conversation-services-installed",{chat:!!chat,work:!!work});
 return services.status();
}
export function createScopedCodexService(codex,{getChangedPaths,audit=()=>{},requestApproval=()=>null}={}){
 if(!codex)throw new Error("Codex service required");
 return {
  ...codex,
  async build({builderId,packet,...rest}){
   if(typeof codex.build!=="function")throw new Error("Codex build capability unavailable");
   const result=await codex.build({builderId,packet,...rest});
   const changed=typeof getChangedPaths==="function"?await getChangedPaths({builderId,packet,result}):(result?.files_changed||result?.filesChanged||[]);
   const scope=packet?.scope_paths||packet?.scopePaths||[];
   const check=verifyDiffScope(changed,scope);
   audit("scope-lock-checked",{builderId,missionId:packet?.mission?.id||packet?.mission_id,check});
   if(!check.ok){
    const request=requireScopeExpansion({id:packet?.mission?.id||packet?.mission_id,scopePaths:scope},changed);
    const approval=await requestApproval(request);
    if(!approval?.approved){
     const e=new Error("Codex diff violates mission scope: "+check.violations.join(", "));e.code="SCOPE_LOCK_VIOLATION";e.scope=check;throw e;
    }
   }
   return {...result,scopeVerification:check};
  }
 };
}
