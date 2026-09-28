import {normalizeMissionContract,validateMissionContract} from "./mission-contract.js";
import {classifyCIFailure,recoveryRoute} from "./ci-failures.js";

const uniq=a=>[...new Set((a||[]).filter(Boolean))];
const normPath=p=>String(p||"").replace(/\\/g,"/").replace(/^\.\//,"").replace(/\/+/g,"/");
const text=x=>String(x||"").trim();
function slug(s){return text(s).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,60)||"mission"}
function checksum(s){let h=2166136261;for(const ch of String(s)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}return (h>>>0).toString(36)}
function stableId(source,input){
 if(input?.id)return String(input.id);
 const repo=input?.repository||input?.repo||input?.repository_full_name||"";
 const issue=input?.issueNumber||input?.issue_number||input?.number;
 if(source==="github_issue"&&issue!=null)return "gh-"+slug(repo)+"-"+issue;
 const seed=[source,repo,input?.title,input?.goal,input?.body,input?.prompt,input?.message].filter(Boolean).join("|");
 return source+"-"+slug(input?.title||input?.goal||"mission")+"-"+checksum(seed);
}
function lines(body){return text(body).split(/\r?\n/)}
function checklist(body){
 return uniq(lines(body).map(x=>x.match(/^\s*[-*]\s*\[[ xX]\]\s+(.+)$/)?.[1]).filter(Boolean));
}
function sectionItems(body,heading){
 const all=lines(body);let active=false,out=[];
 for(const line of all){
  const h=line.match(/^#{1,6}\s+(.+)$/);
  if(h){active=h[1].trim().toLowerCase().includes(heading);continue}
  if(active){
   const m=line.match(/^\s*[-*]\s+(?:\[[ xX]\]\s*)?(.+)$/);
   if(m)out.push(m[1].trim());
  }
 }
 return uniq(out);
}
function issueRefs(body){return uniq([...text(body).matchAll(/(?:depends\s+on|blocked\s+by|requires)\s+#(\d+)/gi)].map(m=>"#"+m[1]))}
function codePaths(body){
 const out=[];
 for(const m of text(body).matchAll(/\x60([^\x60]+)\x60/g)){
  const v=m[1].trim();
  if(/[\/\\]/.test(v)&&!v.includes(" ")&&!/^https?:/.test(v))out.push(normPath(v));
 }
 return uniq(out);
}
function labelNames(input){return (input?.labels||[]).map(x=>typeof x==="string"?x:x?.name).filter(Boolean).map(x=>x.toLowerCase())}
function priority(input){
 const labels=labelNames(input);
 for(const p of ["p0","p1","p2","p3"])if(labels.some(x=>x===p||x.includes("priority:"+p)))return p.toUpperCase();
 return input?.priority||"P2";
}
function risk(input){
 if(input?.risk)return input.risk;
 const t=[input?.title,input?.body,input?.goal,...labelNames(input)].join(" ").toLowerCase();
 if(/production|tenant isolation|security|secret|credential|destructive|migration/.test(t))return "high";
 if(/server|deploy|payment|auth|database|runtime/.test(t))return "elevated";
 return "standard";
}
function epoch(input,r){
 if(input?.researchEpochLimit||input?.research_epoch_limit)return Number(input.researchEpochLimit||input.research_epoch_limit);
 const t=[input?.title,input?.body,input?.goal].join(" ").toLowerCase();
 if(r==="high"||/architecture|migration|cross-package|deep scan|refactor/.test(t))return 15;
 if(r==="elevated"||/integration|runtime|server|offline/.test(t))return 10;
 return 5;
}
function squad(id,input){
 if(input?.assignedSquad||input?.assigned_squad)return input.assignedSquad||input.assigned_squad;
 return parseInt(checksum(id).slice(-4),36)%2===0?"A":"B";
}
function defaultVerification(r){
 const out=["git","ci","acceptance"];
 if(["elevated","high"].includes(r))out.push("runtime");
 if(r==="high")out.push("security_review");
 return out;
}

export class TitanMissionCompiler{
 constructor({profiles=null,audit=()=>{}}={}){this.profiles=profiles;this.audit=audit}
 compile(input={},options={}){
  if(typeof input==="string")input={prompt:input,title:input.slice(0,100),goal:input};
  const source=options.sourceType||input.sourceType||input.source_type||(input.issueNumber!=null||input.issue_number!=null||input.number!=null?"github_issue":"operator_prompt");
  const body=text(input.body||input.description||input.prompt||input.message||"");
  const id=stableId(source,input);
  const r=risk(input);
  const acceptance=uniq([...(input.acceptance||input.acceptanceCriteria||[]),...checklist(body),...sectionItems(body,"acceptance")].map(x=>typeof x==="string"?x:x?.text).filter(Boolean));
  const scope=uniq([...(input.scopePaths||input.scope_paths||[]),...sectionItems(body,"scope"),...codePaths(body)].map(normPath).filter(x=>x&&!/^#/.test(x)));
  const dependencies=uniq([...(input.dependencies||input.dependsOn||[]),...issueRefs(body)]);
  const protectedPaths=uniq((input.protectedPaths||input.protected_paths||sectionItems(body,"protected")).map(normPath));
  const testPlan=uniq([...(input.testPlan||input.test_plan||[]),...sectionItems(body,"test")]);
  const runtimeRequirements=uniq([...(input.runtimeRequirements||input.runtime_requirements||[]),...sectionItems(body,"runtime")]);
  const evidenceRequirements=uniq([...(input.evidenceRequirements||input.evidence_requirements||[]),...sectionItems(body,"evidence")]);
  let verificationRequirements=uniq(input.verificationRequirements||input.verification_requirements||defaultVerification(r));
  let failure=null;
  if(source==="ci_failure"){
   failure=classifyCIFailure(input);
   const route=recoveryRoute(failure);
   verificationRequirements=uniq([...verificationRequirements,"ci_repair"]);
   if(route)testPlan.push("Route repair through "+route);
  }
  const raw={
   ...input,
   id,
   title:input.title||input.summary||"Compiled mission",
   goal:input.goal||input.prompt||input.message||input.title||"",
   priority:priority(input),
   risk:r,
   repository:input.repository||input.repo||input.repository_full_name||null,
   branch:input.branch||null,
   scopePaths:scope,
   protectedPaths,
   dependencies,
   constraints:uniq(input.constraints||[]),
   acceptanceCriteria:acceptance.length?acceptance:["Mission goal is demonstrably satisfied"],
   verificationRequirements,
   runtimeRequirements,
   evidenceRequirements,
   testPlan,
   assignedSquad:squad(id,input),
   researchEpochLimit:Math.max(5,Math.min(15,epoch(input,r))),
   profileHints:uniq(input.profileHints||input.profile_hints||[]),
   provenance:{source,sourceId:input.url||input.html_url||input.issueNumber||input.issue_number||input.number||null,parents:uniq(input.parentIds||input.parents||[])},
   compiler:{sourceType:source,failureType:failure,compiledAt:Date.now()}
  };
  let mission=normalizeMissionContract(raw);
  if(this.profiles?.selectProfilesForMission){
   const cast=this.profiles.selectProfilesForMission(mission,{executionClass:"chat_worker"});
   mission={...mission,requiredProfiles:uniq([cast?.primary?.id,...(cast?.secondary||[]).map(x=>x.id),...(mission.requiredProfiles||[])])};
  }
  const valid=validateMissionContract(mission);if(!valid.ok)throw new Error(valid.errors.join("; "));
  this.audit("mission-compiled",{missionId:mission.id,sourceType:source,priority:mission.priority,risk:mission.risk,squad:mission.assignedSquad,scopePaths:mission.scopePaths});
  return mission;
 }
 fromGitHubIssue(issue,options={}){return this.compile(issue,{...options,sourceType:"github_issue"})}
 fromRepairRequest(request,options={}){return this.compile(request,{...options,sourceType:"repair_request"})}
 fromCIFailure(failure,options={}){return this.compile(failure,{...options,sourceType:"ci_failure"})}
 fromOperator(input,options={}){return this.compile(input,{...options,sourceType:"operator_prompt"})}
}
