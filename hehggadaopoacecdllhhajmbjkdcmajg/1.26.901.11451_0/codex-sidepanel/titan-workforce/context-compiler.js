import {EXECUTION_CLASSES} from "./constants.js";
import {verifyDiffScope} from "./scope-locks.js";

const clone=x=>x==null?x:structuredClone(x);
const DEFAULT_LIMITS=Object.freeze({
 chat_worker:12000,
 work_supervisor:18000,
 codex_builder:22000,
 codex_orchestrator:26000
});
function stringify(x){return typeof x==="string"?x:JSON.stringify(x,null,2)}
function uniq(a){return [...new Set((a||[]).filter(Boolean))]}
function compactText(value,max){
 const s=stringify(value||"").trim();
 if(s.length<=max)return s;
 return s.slice(0,Math.max(0,max-80))+"\n...[context compacted "+(s.length-max)+" chars]...";
}
function stableBlockKey(title,text){
 let h=2166136261;const s=title+"|"+text;
 for(const ch of s){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}
 return (h>>>0).toString(36);
}
function acceptance(mission){
 return (mission.acceptanceCriteria||[]).map(x=>typeof x==="string"?x:x.text).filter(Boolean);
}
function missionSummary(m){
 return {
  id:m.id,title:m.title,goal:m.goal,priority:m.priority,risk:m.risk,
  repository:m.repository,branch:m.branch,scopePaths:m.scopePaths||[],
  protectedPaths:m.protectedPaths||[],dependencies:m.dependencies||[],
  acceptanceCriteria:acceptance(m),verificationRequirements:m.verificationRequirements||[],
  runtimeRequirements:m.runtimeRequirements||[],evidenceRequirements:m.evidenceRequirements||[],
  testPlan:m.testPlan||[],researchEpochLimit:m.researchEpochLimit,assignedSquad:m.assignedSquad
 };
}
function ensureScope(mission,artifact,label){
 const paths=artifact?.scope_paths||artifact?.scopePaths||[];
 if(!paths.length)return;
 const result=verifyDiffScope(paths,mission.scopePaths||[]);
 if(!result.ok){
  const e=new Error(label+" expands mission scope: "+result.violations.join(", "));
  e.code="CONTEXT_SCOPE_EXPANSION";
  e.violations=result.violations;
  throw e;
 }
}
function addSection(sections,seen,title,value,max=6000){
 if(value==null)return;
 const body=compactText(value,max);if(!body)return;
 const key=stableBlockKey(title,body);if(seen.has(key))return;
 seen.add(key);sections.push({title,text:body,key});
}
function render(sections,limit){
 let out="",truncated=false;
 for(const s of sections){
  const block=(out?"\n\n":"")+"## "+s.title+"\n"+s.text;
  if(out.length+block.length>limit){
   const remain=limit-out.length;
   if(remain>120)out+=block.slice(0,remain-80)+"\n...[context limit reached]...";
   truncated=true;break;
  }
  out+=block;
 }
 return{text:out,characters:out.length,truncated};
}

export class TitanContextCompiler{
 constructor({profiles=null,contextProvider=null,provenance=null,usageGovernor=null,audit=()=>{},limits={}}={}){
  this.profiles=profiles;this.contextProvider=contextProvider;this.provenance=provenance;this.usageGovernor=usageGovernor;this.audit=audit;
  this.limits={...DEFAULT_LIMITS,...limits};
 }
 profileContext(mission,executionClass){
  if(!this.profiles?.selectProfilesForMission||!this.profiles?.compileProfileContext)return null;
  const cast=this.profiles.selectProfilesForMission(mission,{executionClass});
  return this.profiles.compileProfileContext(cast,{executionClass});
 }
 baseContext(mission,executionClass,options={}){
  const context=options.repositoryContext||this.contextProvider?.(mission.id,{commit:options.commit,changedPaths:options.changedPaths||[],maxFiles:options.maxFiles||12})||null;
  const profile=options.profileContext||this.profileContext(mission,executionClass);
  return{context,profile};
 }
 compile(executionClass,input={}){
  if(!EXECUTION_CLASSES.includes(executionClass))throw new Error("Unknown execution class "+executionClass);
  const mission=input.mission;if(!mission?.id)throw new Error("Mission is required");
  const baseLimit=Math.max(2000,Number(input.limit||this.limits[executionClass]||12000));
  const limit=Math.max(2000,Number(this.usageGovernor?.contextLimit?.(baseLimit)||baseLimit));
  const seen=new Set(),sections=[];
  const {context,profile}=this.baseContext(mission,executionClass,input);
  addSection(sections,seen,"Mission",missionSummary(mission),4500);
  addSection(sections,seen,"Profile Context",profile?.text||profile,3500);
  addSection(sections,seen,"Architecture",context?.architecture?.text||context?.architecture,4000);
  addSection(sections,seen,"Repository Slice",context?.repository,5000);
  if(context?.impact)addSection(sections,seen,"Changed-Path Impact",context.impact,3000);

  if(executionClass==="chat_worker"){
   addSection(sections,seen,"Latest Checkpoint",input.checkpoint,2500);
   addSection(sections,seen,"Specific Pass Instruction",input.instruction,2500);
  }

  if(executionClass==="work_supervisor"){
   const results=(input.workerResults||[]).slice(0,5).map((x,i)=>({
    workerId:x.workerId||x.id||"worker-"+(i+1),
    pass:x.pass||x.passNumber||null,
    summary:compactText(x.summary||x.result||x.text||x,2200)
   }));
   addSection(sections,seen,"Five-Pass Worker Results",results,9000);
   addSection(sections,seen,"Prior Supervisor Checkpoint",input.checkpoint,3000);
  }

  if(executionClass==="codex_builder"){
   const delta=input.approvedDelta||input.delta;if(!delta)throw new Error("ApprovedImplementationDelta is required");
   ensureScope(mission,delta,"ApprovedImplementationDelta");
   addSection(sections,seen,"Approved Implementation Delta",delta,9000);
   addSection(sections,seen,"Relevant Tests",context?.repository?.tests||input.tests,2500);
  }

  if(executionClass==="codex_orchestrator"){
   for(const delta of input.deltas||[])ensureScope(mission,delta,"ApprovedImplementationDelta");
   addSection(sections,seen,"Approved Deltas",(input.deltas||[]).slice(0,4),9000);
   addSection(sections,seen,"Builder Results",(input.builderResults||[]).slice(0,4),8000);
   addSection(sections,seen,"Verification Evidence",input.verificationEvidence||input.verification,6000);
  }

  const provenance=input.provenance||this.provenance?.forMission?.(mission.id)||mission.provenance||null;
  addSection(sections,seen,"Provenance",provenance,3500);

  const rendered=render(sections,limit);
  const result={
   executionClass,missionId:mission.id,scopePaths:clone(mission.scopePaths||[]),
   provenance:clone(provenance),sections:sections.map(x=>({title:x.title,key:x.key})),
   ...rendered,limit
  };
  this.usageGovernor?.record?.("context",{missionId:mission.id,characters:result.characters});
  this.audit("context-compiled",{missionId:mission.id,executionClass,characters:result.characters,truncated:result.truncated,sections:result.sections.map(x=>x.title),baseLimit,governedLimit:limit});
  return result;
 }
 forChat(mission,input={}){return this.compile("chat_worker",{...input,mission})}
 forSupervisor(mission,input={}){return this.compile("work_supervisor",{...input,mission})}
 forBuilder(mission,input={}){return this.compile("codex_builder",{...input,mission})}
 forOrchestrator(mission,input={}){return this.compile("codex_orchestrator",{...input,mission})}
}

export {DEFAULT_LIMITS};
