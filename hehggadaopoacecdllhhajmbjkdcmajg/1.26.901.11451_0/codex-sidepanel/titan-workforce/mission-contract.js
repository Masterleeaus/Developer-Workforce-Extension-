import {normalizeScopePattern} from "./scope-locks.js";
const uniq=a=>[...new Set((a||[]).filter(Boolean))];

export function normalizeMissionContract(m={}){
 const acceptance=(m.acceptanceCriteria||m.acceptance||[]).map((x,i)=>typeof x==="string"?{id:`ac-${i+1}`,text:x,done:false}:{id:x.id||`ac-${i+1}`,text:x.text||"",done:!!x.done,...x});
 return {
   id:m.id||`mission-${Date.now()}`,
   title:m.title||"Untitled mission",
   goal:m.goal||"",
   priority:m.priority||"P2",
   policy:m.policy||"auto",
   repository:m.repository||m.repo||null,
   branch:m.branch||null,
   scopePaths:uniq(m.scopePaths||m.scope_paths||[]).map(normalizeScopePattern),
   dependencies:uniq(m.dependencies||m.dependsOn||[]),
   constraints:uniq(m.constraints||[]),
   acceptanceCriteria:acceptance,
   verificationRequirements:uniq(m.verificationRequirements||m.verification_requirements||[]),
   profileHints:uniq(m.profileHints||m.profile_hints||[]),
   status:m.status||"queued",
   assignedAgent:m.assignedAgent||m.worker||null,
   provenance:m.provenance||{source:"mission-control",parents:[]},
   createdAt:m.createdAt||Date.now(),
   updatedAt:Date.now()
 };
}

export function validateMissionContract(m){
 const errors=[];
 if(!m?.id)errors.push("id required");
 if(!m?.title)errors.push("title required");
 if(!Array.isArray(m?.scopePaths))errors.push("scopePaths must be array");
 if(!Array.isArray(m?.dependencies))errors.push("dependencies must be array");
 if(!Array.isArray(m?.acceptanceCriteria))errors.push("acceptanceCriteria must be array");
 return {ok:errors.length===0,errors};
}
