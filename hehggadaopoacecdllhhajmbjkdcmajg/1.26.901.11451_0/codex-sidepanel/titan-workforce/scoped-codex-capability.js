import {verifyDiffScope,requireScopeExpansion} from "./scope-locks.js";
export function createScopedCodexBuildHandler(rawBuild,{getChangedPaths,audit=()=>{},requestApproval=()=>null,persistScopeExpansion=()=>null}={}){
 if(typeof rawBuild!=="function")throw new Error("Raw Codex build handler required");
 return async (args={},context={})=>{
  const {builderId,packet}=args;const result=await rawBuild(args,context);
  const changed=await getChangedPaths({builderId,packet,result,context});
  const scope=packet?.scope_paths||packet?.scopePaths||[];
  let check=verifyDiffScope(changed,scope);
  audit("scope-lock-checked",{packetId:packet?.id||null,builderId,missionId:packet?.mission?.id||packet?.mission_id,originalScope:scope,changedPaths:changed,violations:check.violations});
  if(!check.ok){
   const request=requireScopeExpansion({id:packet?.mission?.id||packet?.mission_id,scopePaths:scope},changed,{packetId:packet?.id||null,builderId});
   const approval=await requestApproval({...request,packetId:packet?.id||null,builderId});
   if(!approval?.approved&&approval?.status!=="approved"){const e=new Error(approval?.status==="pending"?"Scope expansion approval pending":"Codex diff violates mission scope");e.code=approval?.status==="pending"?"SCOPE_APPROVAL_PENDING":"SCOPE_LOCK_VIOLATION";e.approvalId=approval?.id||null;e.scope=check;throw e}
   await persistScopeExpansion({request,approval,packet,builderId,changedPaths:changed});
   const expanded=[...new Set([...scope,...check.violations])];check=verifyDiffScope(changed,expanded);
   audit("scope-expansion-approved",{packetId:packet?.id||null,builderId,missionId:packet?.mission?.id||packet?.mission_id,approvalId:approval.id||null,expandedScope:expanded,changedPaths:changed,recheck:check});
   if(!check.ok){const e=new Error("Approved scope expansion incomplete");e.code="SCOPE_EXPANSION_INCOMPLETE";throw e}
   return {...result,scopeVerification:check,scopeExpansion:{approvalId:approval.id||null,expandedScope:expanded}};
  }
  return {...result,scopeVerification:check};
 };
}
export function enforceScopedCodexBuildCapability(broker,options={}){
 const entry=broker.get("codex.build");if(!entry)return false;
 if(entry.metadata?.scopeLocked)return true;
 const guarded=createScopedCodexBuildHandler(entry.handler,options);
 broker.register("codex.build",guarded,{classification:entry.classification,source:(entry.source||"codex")+"+scope-lock",timeoutMs:entry.timeoutMs,description:entry.description,metadata:{...(entry.metadata||{}),scopeLocked:true}});
 return true;
}
