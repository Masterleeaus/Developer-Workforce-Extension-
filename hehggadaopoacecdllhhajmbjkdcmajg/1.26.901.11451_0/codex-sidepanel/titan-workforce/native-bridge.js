import {verifyDiffScope,requireScopeExpansion} from "./scope-locks.js";

function legacyServices(){
 const src=globalThis.TitanNativeServices?.services;
 return src instanceof Map?src:new Map();
}
export function installLegacyNativeBridge(services,audit=()=>{}){
 const legacy=legacyServices();
 for(const kind of ["github","repository","runtime"]){
  const s=legacy.get(kind);if(s)services.register(kind,s);
 }
 const codex=legacy.get("codex");
 if(codex){
  services.register("codex",{
   capabilities:["review","build","orchestrate"],
   review:codex.review?.bind(codex),
   build:codex.build?.bind(codex)||codex.execute?.bind(codex)||null,
   orchestrate:codex.orchestrate?.bind(codex)||codex.review?.bind(codex)
  });
 }
 audit("native-services-bridged",{available:services.status()});
 return services.status();
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
