const uniq=a=>[...new Set((a||[]).filter(Boolean))];
const normPath=p=>String(p||"").replace(/\\/g,"/").replace(/^\.\//,"").replace(/\/+/g,"/");

export function normalizeMissionContract(m={}){
 const acceptance=(m.acceptanceCriteria||m.acceptance||[]).map((x,i)=>typeof x==="string"?{id:`ac-${i+1}`,text:x,done:false}:{id:x.id||`ac-${i+1}`,text:x.text||"",done:!!x.done,...x});
 return {
   id:m.id||`mission-${Date.now()}`,
   title:m.title||"Untitled mission",
   goal:m.goal||"",
   priority:m.priority||"P2",
   risk:m.risk||"standard",
   policy:m.policy||"auto",
   repository:m.repository||m.repo||null,
   branch:m.branch||null,
   scopePaths:uniq(m.scopePaths||m.scope_paths||[]).map(normPath),
   protectedPaths:uniq(m.protectedPaths||m.protected_paths||[]).map(normPath),
   dependencies:uniq(m.dependencies||m.dependsOn||[]),
   constraints:uniq(m.constraints||[]),
   acceptanceCriteria:acceptance,
   verificationRequirements:uniq(m.verificationRequirements||m.verification_requirements||[]),
   runtimeRequirements:uniq(m.runtimeRequirements||m.runtime_requirements||[]),
   evidenceRequirements:uniq(m.evidenceRequirements||m.evidence_requirements||[]),
   testPlan:uniq(m.testPlan||m.test_plan||[]),
   requiredProfiles:uniq(m.requiredProfiles||m.required_profiles||[]),
   profileHints:uniq(m.profileHints||m.profile_hints||[]),
   assignedSquad:m.assignedSquad||m.assigned_squad||null,
   researchEpochLimit:Number(m.researchEpochLimit||m.research_epoch_limit||5),
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
 if(!Array.isArray(m?.protectedPaths))errors.push("protectedPaths must be array");
 if(!Array.isArray(m?.dependencies))errors.push("dependencies must be array");
 if(!Array.isArray(m?.acceptanceCriteria))errors.push("acceptanceCriteria must be array");
 if(!Array.isArray(m?.testPlan))errors.push("testPlan must be array");
 if(!Array.isArray(m?.runtimeRequirements))errors.push("runtimeRequirements must be array");
 if(!Array.isArray(m?.evidenceRequirements))errors.push("evidenceRequirements must be array");
 if(!Number.isFinite(Number(m?.researchEpochLimit))||Number(m.researchEpochLimit)<5||Number(m.researchEpochLimit)>15)errors.push("researchEpochLimit must be between 5 and 15");
 return {ok:errors.length===0,errors};
}
