import {createVerificationState,recordGate} from "./verification-plane.js";

const DEFAULT_GIT_FIELDS=Object.freeze(["commitExists","merged","presentOnMain"]);
const DEFAULT_RUNTIME_FIELDS=Object.freeze(["deployed","browserPassed","consoleClean","networkPassed","acceptancePassed"]);

function list(v){return Array.isArray(v)?v:[]}
function requirements(mission={}){
 return list(mission.verificationRequirements||mission.verification_requirements).map(x=>String(x).toLowerCase());
}
function hasRequirement(reqs,...terms){return terms.some(term=>reqs.some(x=>x===term||x.includes(term)))}

export function evaluateBooleanEvidence(source={},requiredFields=[]){
 const missing=[],failed=[],passed=[];
 for(const field of requiredFields){
  const value=source?.[field];
  if(value===true)passed.push(field);
  else if(value===false)failed.push(field);
  else missing.push(field);
 }
 const status=failed.length?"fail":missing.length?"pending":"pass";
 return {status,requiredFields:[...requiredFields],passedFields:passed,failedFields:failed,missingFields:missing};
}

export function requiredGitFields(mission={}){
 const reqs=requirements(mission),fields=[...DEFAULT_GIT_FIELDS];
 if(mission.requireBranch===true||hasRequirement(reqs,"branch","branch_exists"))fields.push("branchExists");
 if(mission.requirePr===true||mission.requirePR===true||hasRequirement(reqs,"pr","pull request","pull_request"))fields.push("prExists");
 return [...new Set(fields)];
}

export function requiredRuntimeFields(mission={},runtime={}){
 const reqs=requirements(mission),fields=[...DEFAULT_RUNTIME_FIELDS];
 if(runtime.serverRequired===true||mission.requireServer===true||hasRequirement(reqs,"server","vps","directadmin","direct admin"))fields.push("serverPassed");
 return [...new Set(fields)];
}

export function importLegacyVerification(mission={}){
 const v=createVerificationState(mission.id);
 const t=mission.truth||{},r=mission.runtime||{};

 if(Object.keys(t).length){
   const git=evaluateBooleanEvidence(t,requiredGitFields(mission));
   recordGate(v,"git",{status:git.status,evidence:[t.commit,t.pr].filter(Boolean),details:{...t,evaluation:git}});
   const ci=evaluateBooleanEvidence(t,["ciPassed"]);
   recordGate(v,"ci",{status:ci.status,evidence:[],details:{...t,evaluation:ci}});
 }

 const runtimeExplicitlyWaived=mission.runtimeRequired===false||mission.requireRuntime===false;
 if(runtimeExplicitlyWaived){
   recordGate(v,"runtime",{status:"pass",evidence:[],details:{waived:true,reason:"runtime-not-required"}});
 }else if(Object.keys(r).length){
   const runtime=evaluateBooleanEvidence(r,requiredRuntimeFields(mission,r));
   recordGate(v,"runtime",{status:runtime.status,evidence:r.evidence||[],details:{...r,evaluation:runtime}});
 }

 const ac=mission.acceptanceCriteria||mission.acceptance||[];
 if(ac.length){
   const done=ac.filter(x=>typeof x!=="string"&&x?.done===true);
   const failed=ac.filter(x=>typeof x!=="string"&&(x?.failed===true||x?.status==="fail"));
   const status=failed.length?"fail":done.length===ac.length?"pass":"pending";
   recordGate(v,"acceptance",{status,evidence:done.flatMap(x=>x.evidence||[]),details:{total:ac.length,done:done.length,failed:failed.length}});
 }else{
   recordGate(v,"acceptance",{status:"pass",evidence:[],details:{total:0,done:0,policy:"no-acceptance-criteria"}});
 }
 return v;
}
