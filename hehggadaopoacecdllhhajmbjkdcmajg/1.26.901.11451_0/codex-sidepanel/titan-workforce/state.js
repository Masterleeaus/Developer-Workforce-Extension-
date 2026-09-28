import {WORKFORCE_SCHEMA_VERSION,SLOT_IDS,SLOT_CLASS,SLOT_SQUAD} from "./constants.js";
const now=()=>Date.now();
const plain=x=>!!x&&typeof x==="object"&&!Array.isArray(x);
const clone=x=>x==null?x:JSON.parse(JSON.stringify(x));

export function createAgentControlState(){
 return {paused:false,pauseReason:null,quarantined:false,quarantineReason:null,emergencyStopped:false,emergencyReason:null};
}

export function ensureAgentControlState(slot){
 if(!slot||typeof slot!=="object")throw new Error("Agent slot required");
 if(!slot.control||typeof slot.control!=="object")slot.control=createAgentControlState();
 else slot.control={
  paused:slot.control.paused===true,
  pauseReason:slot.control.pauseReason||null,
  quarantined:slot.control.quarantined===true,
  quarantineReason:slot.control.quarantineReason||null,
  emergencyStopped:slot.control.emergencyStopped===true,
  emergencyReason:slot.control.emergencyReason||null
 };
 return slot.control;
}

export function createAgentSlot(id){
 if(!SLOT_IDS.includes(id))throw new Error("Unknown workforce slot: "+id);
 return {id,executionClass:SLOT_CLASS[id],squad:SLOT_SQUAD[id]||null,status:"idle",missionId:null,profileIds:[],conversation:null,health:"unknown",control:createAgentControlState(),createdAt:now(),updatedAt:now()};
}
export function createWorkforceState(){
 return {schemaVersion:WORKFORCE_SCHEMA_VERSION,agents:Object.fromEntries(SLOT_IDS.map(id=>[id,createAgentSlot(id)])),missions:{},squads:{A:{status:"idle"},B:{status:"idle"}},controls:{armed:false,emergencyStop:false,emergencyReason:null,preflightPassed:false,preflightAt:null},provenance:{},createdAt:now(),updatedAt:now()};
}

function rawRecoverySnapshot(raw){
 const snap=clone(raw)||{};
 if(plain(snap.recovery)&&plain(snap.recovery.stateRepair))delete snap.recovery.stateRepair.rawSnapshot;
 return snap;
}
function repairIssue(issues,code,details={},severe=false){issues.push({code,severe,...details})}
function quarantineSlot(slot,reason){
 const control=ensureAgentControlState(slot);control.quarantined=true;control.paused=true;control.pauseReason="state-repair";control.quarantineReason=reason;
}
function normalizeMissionMap(raw,issues){
 if(!plain(raw)){repairIssue(issues,"MALFORMED_MISSIONS",{actualType:Array.isArray(raw)?"array":typeof raw},true);return {}}
 const out={};
 for(const [id,value] of Object.entries(raw)){
  if(!plain(value)){repairIssue(issues,"MALFORMED_MISSION",{missionId:id},true);continue}
  const mission={...value,id:value.id||id};
  if(mission.id!==id){repairIssue(issues,"MISSION_ID_MISMATCH",{key:id,storedId:mission.id},true);mission.id=id}
  if(mission.assignedAgent!=null&&(!SLOT_IDS.includes(mission.assignedAgent))){
   repairIssue(issues,"INVALID_ASSIGNED_AGENT",{missionId:id,assignedAgent:mission.assignedAgent},true);mission.assignedAgent=null;
  }
  out[id]=mission;
 }
 return out;
}

function repairAssignments(state,issues){
 const claims=new Map();
 for(const slot of Object.values(state.agents)){
  if(!slot.missionId)continue;
  if(!state.missions[slot.missionId]){
   repairIssue(issues,"SLOT_MISSING_MISSION",{slotId:slot.id,missionId:slot.missionId},true);
   quarantineSlot(slot,"state-repair:missing-mission");slot.missionId=null;slot.profileIds=[];if(slot.status==="assigned")slot.status="idle";continue;
  }
  const a=claims.get(slot.missionId)||[];a.push(slot.id);claims.set(slot.missionId,a);
 }
 for(const [missionId,slotIds] of claims){
  const mission=state.missions[missionId];
  if(slotIds.length>1){
   repairIssue(issues,"DUPLICATE_MISSION_ASSIGNMENT",{missionId,slotIds:[...slotIds]},true);
   for(const slotId of slotIds){const slot=state.agents[slotId];quarantineSlot(slot,"state-repair:duplicate-mission-assignment");slot.missionId=null;slot.profileIds=[];if(slot.status==="assigned")slot.status="idle"}
   mission.assignedAgent=null;continue;
  }
  const slotId=slotIds[0],slot=state.agents[slotId];
  if(!mission.assignedAgent){
   mission.assignedAgent=slotId;repairIssue(issues,"REPAIRED_MISSION_REVERSE_REFERENCE",{missionId,slotId},false);
  }else if(mission.assignedAgent!==slotId){
   const claimed=state.agents[mission.assignedAgent];
   repairIssue(issues,"ASSIGNMENT_REFERENCE_CONFLICT",{missionId,slotId,assignedAgent:mission.assignedAgent},true);
   quarantineSlot(slot,"state-repair:assignment-conflict");slot.missionId=null;slot.profileIds=[];if(slot.status==="assigned")slot.status="idle";
   if(claimed){quarantineSlot(claimed,"state-repair:assignment-conflict");if(claimed.missionId===missionId){claimed.missionId=null;claimed.profileIds=[];if(claimed.status==="assigned")claimed.status="idle"}}
   mission.assignedAgent=null;
  }
 }
 for(const mission of Object.values(state.missions)){
  const slotId=mission.assignedAgent;if(!slotId)continue;
  const slot=state.agents[slotId];
  if(!slot){repairIssue(issues,"MISSION_MISSING_SLOT",{missionId:mission.id,slotId},true);mission.assignedAgent=null;continue}
  if(!slot.missionId){
   slot.missionId=mission.id;if(slot.status==="idle")slot.status="assigned";
   repairIssue(issues,"REPAIRED_SLOT_REVERSE_REFERENCE",{missionId:mission.id,slotId},false);
  }else if(slot.missionId!==mission.id){
   const otherMission=state.missions[slot.missionId];
   repairIssue(issues,"SLOT_MULTI_MISSION_CONFLICT",{slotId,missionId:mission.id,otherMissionId:slot.missionId},true);
   quarantineSlot(slot,"state-repair:multi-mission-conflict");
   if(otherMission?.assignedAgent===slotId)otherMission.assignedAgent=null;
   mission.assignedAgent=null;slot.missionId=null;slot.profileIds=[];if(slot.status==="assigned")slot.status="idle";
  }
 }
}

export function normalizeWorkforceState(raw={}){
 const issues=[],defaults=createWorkforceState(),source=plain(raw)?clone(raw):{};
 if(!plain(raw))repairIssue(issues,"MALFORMED_STATE",{actualType:Array.isArray(raw)?"array":typeof raw},true);
 const next={...source};
 next.schemaVersion=WORKFORCE_SCHEMA_VERSION;

 const rawControls=plain(source.controls)?source.controls:null;
 if(!rawControls)repairIssue(issues,"MISSING_OR_MALFORMED_CONTROLS",{},true);
 next.controls={...defaults.controls,...(rawControls||{})};
 next.controls.armed=next.controls.armed===true;
 next.controls.emergencyStop=next.controls.emergencyStop===true;
 next.controls.emergencyReason=next.controls.emergencyReason||null;

 const rawAgents=plain(source.agents)?source.agents:{};
 if(!plain(source.agents))repairIssue(issues,"MISSING_OR_MALFORMED_AGENTS",{},true);
 next.agents={};
 for(const id of SLOT_IDS){
  const base=createAgentSlot(id),candidate=plain(rawAgents[id])?rawAgents[id]:null,slot={...base,...(candidate||{})};
  const slotIssues=[];
  if(!candidate){repairIssue(issues,"MISSING_SLOT",{slotId:id},false)}
  else{
   if(candidate.id!=null&&candidate.id!==id)slotIssues.push("id");
   if(candidate.executionClass!=null&&candidate.executionClass!==SLOT_CLASS[id])slotIssues.push("executionClass");
   const expectedSquad=SLOT_SQUAD[id]||null;
   if(Object.prototype.hasOwnProperty.call(candidate,"squad")&&(candidate.squad||null)!==expectedSquad)slotIssues.push("squad");
  }
  slot.id=id;slot.executionClass=SLOT_CLASS[id];slot.squad=SLOT_SQUAD[id]||null;
  if(slot.missionId!=null&&typeof slot.missionId!=="string"){repairIssue(issues,"INVALID_SLOT_MISSION",{slotId:id},true);slotIssues.push("missionId");slot.missionId=null}
  slot.profileIds=Array.isArray(slot.profileIds)?slot.profileIds.filter(x=>typeof x==="string"):[];
  if(slot.conversation!=null&&!plain(slot.conversation)){repairIssue(issues,"INVALID_SLOT_CONVERSATION",{slotId:id},true);slotIssues.push("conversation");slot.conversation=null}
  slot.status=typeof slot.status==="string"&&slot.status?slot.status:"idle";
  slot.health=typeof slot.health==="string"&&slot.health?slot.health:"unknown";
  slot.createdAt=Number.isFinite(slot.createdAt)?slot.createdAt:now();
  slot.updatedAt=Number.isFinite(slot.updatedAt)?slot.updatedAt:now();
  ensureAgentControlState(slot);
  if(slotIssues.length){
   repairIssue(issues,"CANONICAL_SLOT_REPAIRED",{slotId:id,fields:slotIssues},true);
   quarantineSlot(slot,"state-repair:"+slotIssues.join(","));
  }
  next.agents[id]=slot;
 }
 const orphanedAgentIds=Object.keys(rawAgents).filter(id=>!SLOT_IDS.includes(id));
 if(orphanedAgentIds.length)repairIssue(issues,"ORPHANED_AGENT_SLOTS",{slotIds:orphanedAgentIds},true);

 next.missions=normalizeMissionMap(source.missions,issues);
 const rawSquads=plain(source.squads)?source.squads:{};
 if(!plain(source.squads))repairIssue(issues,"MISSING_OR_MALFORMED_SQUADS",{},false);
 next.squads={
  A:{...defaults.squads.A,...(plain(rawSquads.A)?rawSquads.A:{})},
  B:{...defaults.squads.B,...(plain(rawSquads.B)?rawSquads.B:{})}
 };
 if(!plain(source.provenance)){repairIssue(issues,"MALFORMED_PROVENANCE",{},true);next.provenance={}}else next.provenance=source.provenance;
 next.createdAt=Number.isFinite(source.createdAt)?source.createdAt:now();
 next.updatedAt=now();

 repairAssignments(next,issues);
 const severe=issues.some(x=>x.severe);
 if(severe)next.controls.armed=false;

 const priorRecovery=plain(source.recovery)?source.recovery:{};
 next.recovery={...priorRecovery,stateRepair:{
  repaired:issues.length>0,
  severe,
  at:now(),
  issues,
  rawSnapshot:severe?rawRecoverySnapshot(source):null
 }};
 return next;
}

export function validateWorkforceStateDetailed(s){
 const errors=[];
 if(!plain(s))return {ok:false,errors:[{code:"STATE_NOT_OBJECT"}]};
 if(s.schemaVersion!==WORKFORCE_SCHEMA_VERSION)errors.push({code:"SCHEMA_VERSION",actual:s.schemaVersion});
 if(!plain(s.agents))errors.push({code:"AGENTS_NOT_OBJECT"});
 else for(const id of SLOT_IDS){
  const slot=s.agents[id];
  if(!plain(slot))errors.push({code:"MISSING_SLOT",slotId:id});
  else{
   if(slot.id!==id)errors.push({code:"SLOT_ID",slotId:id});
   if(slot.executionClass!==SLOT_CLASS[id])errors.push({code:"SLOT_CLASS",slotId:id});
   if((slot.squad||null)!==(SLOT_SQUAD[id]||null))errors.push({code:"SLOT_SQUAD",slotId:id});
   if(!plain(slot.control))errors.push({code:"SLOT_CONTROL",slotId:id});
  }
 }
 if(!plain(s.missions))errors.push({code:"MISSIONS_NOT_OBJECT"});
 if(!plain(s.squads))errors.push({code:"SQUADS_NOT_OBJECT"});
 if(!plain(s.controls))errors.push({code:"CONTROLS_NOT_OBJECT"});
 if(!plain(s.provenance))errors.push({code:"PROVENANCE_NOT_OBJECT"});
 if(plain(s.agents)&&plain(s.missions)){
  const seen=new Map();
  for(const id of SLOT_IDS){
   const slot=s.agents[id];if(!slot?.missionId)continue;
   const mission=s.missions[slot.missionId];
   if(!mission)errors.push({code:"SLOT_MISSING_MISSION",slotId:id,missionId:slot.missionId});
   else if(mission.assignedAgent!==id)errors.push({code:"ASSIGNMENT_REVERSE_MISMATCH",slotId:id,missionId:slot.missionId,assignedAgent:mission.assignedAgent||null});
   if(seen.has(slot.missionId))errors.push({code:"DUPLICATE_MISSION_ASSIGNMENT",missionId:slot.missionId,slotIds:[seen.get(slot.missionId),id]});
   else seen.set(slot.missionId,id);
  }
  for(const [missionId,mission] of Object.entries(s.missions)){
   if(!mission?.assignedAgent)continue;
   const slot=s.agents[mission.assignedAgent];
   if(!slot||slot.missionId!==missionId)errors.push({code:"MISSION_REVERSE_MISMATCH",missionId,assignedAgent:mission.assignedAgent});
  }
 }
 return {ok:errors.length===0,errors};
}
export function validateWorkforceState(s){return validateWorkforceStateDetailed(s).ok}
