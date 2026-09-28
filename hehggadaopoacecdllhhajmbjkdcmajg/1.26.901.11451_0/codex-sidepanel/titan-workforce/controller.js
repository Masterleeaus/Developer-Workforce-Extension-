import {TitanAgentRegistry} from "./registry.js";

function control(a){
 return a.control||(a.control={paused:false,pauseReason:null,quarantined:false,quarantineReason:null,emergencyStopped:false,preEmergency:null});
}
function error(code,message,details={}){
 const e=new Error(message);e.code=code;Object.assign(e,details);return e;
}
function terminal(status){return ["complete","verified","cancelled","superseded"].includes(status)}
function clone(x){return x==null?x:JSON.parse(JSON.stringify(x))}
function restore(target,snapshot){for(const k of Object.keys(target))delete target[k];Object.assign(target,clone(snapshot))}
function activeMission(m){return !!m&&!terminal(m.status)}

export function assignmentInvariantErrors(state){
 const errors=[],agents=state?.agents||{},missions=state?.missions||{};
 for(const [slotId,slot] of Object.entries(agents)){
  if(!slot?.missionId)continue;
  const mission=missions[slot.missionId];
  if(!mission)errors.push(`slot ${slotId} references missing mission ${slot.missionId}`);
  else if(mission.assignedAgent!==slotId)errors.push(`slot ${slotId} -> ${slot.missionId} but mission points to ${mission.assignedAgent||"none"}`);
 }
 for(const [missionId,mission] of Object.entries(missions)){
  if(!mission?.assignedAgent)continue;
  const slot=agents[mission.assignedAgent];
  if(!slot)errors.push(`mission ${missionId} references missing agent ${mission.assignedAgent}`);
  else if(slot.missionId!==missionId)errors.push(`mission ${missionId} -> ${mission.assignedAgent} but slot points to ${slot.missionId||"none"}`);
 }
 return errors;
}
export function validateAssignmentInvariants(state){const errors=assignmentInvariantErrors(state);return {ok:errors.length===0,errors}}

export class TitanWorkforceController{
 constructor(state,{audit=()=>{},services={},missionControl=null}={}){
  this.state=state;this.registry=new TitanAgentRegistry(state);this.audit=audit;this.services=services;this.missionControl=missionControl;
  if(this.missionControl?.setAssignmentHandler)this.missionControl.setAssignmentHandler((missionId,slotId,options)=>this.assignMission(missionId,slotId,options));
 }
 setMissionControl(missionControl){
  this.missionControl=missionControl;
  if(missionControl?.setAssignmentHandler)missionControl.setAssignmentHandler((missionId,slotId,options)=>this.assignMission(missionId,slotId,options));
  return this;
 }
 arm(){
  if(this.state.controls.emergencyStop)throw error("EMERGENCY_STOP_ACTIVE","Cannot arm during emergency stop");
  if(this.state.controls.requiresReconciliation)throw error("RECOVERY_RECONCILIATION_REQUIRED","Cannot arm before readiness/reconciliation");
  if(this.registry.list().some(a=>control(a).emergencyStopped))throw error("AGENT_EMERGENCY_STOPPED","Cannot arm while agent emergency-stop flags remain");
  this.state.controls.armed=true;this.audit("workforce-armed",{});return true;
 }
 disarm(reason="manual"){this.state.controls.armed=false;this.audit("workforce-disarmed",{reason});return true}
 emergencyStop(reason="manual"){
  this.state.controls.armed=false;this.state.controls.emergencyStop=true;this.state.controls.requiresReconciliation=true;this.state.controls.lastEmergencyAt=Date.now();
  for(const a of this.registry.list()){const c=control(a);if(!c.emergencyStopped)c.preEmergency={status:a.status,paused:c.paused,quarantined:c.quarantined,at:Date.now()};c.emergencyStopped=true}
  this.audit("workforce-emergency-stop",{reason,agents:this.registry.list().map(a=>a.id)});return true;
 }
 clearEmergencyStop({reconciled=false}={}){
  if(!this.state.controls.emergencyStop)throw error("EMERGENCY_STOP_NOT_ACTIVE","E-STOP is not active");
  this.state.controls.emergencyStop=false;this.state.controls.armed=false;this.state.controls.requiresReconciliation=!reconciled;
  for(const a of this.registry.list()){const c=control(a);c.emergencyStopped=false;if(c.preEmergency){c.paused=!!c.preEmergency.paused;c.quarantined=!!c.preEmergency.quarantined;c.preEmergency=null}}
  this.audit("workforce-emergency-cleared",{reconciled,armed:false});return true;
 }
 markReconciled(evidence={}){if(this.state.controls.emergencyStop)throw error("EMERGENCY_STOP_ACTIVE","Cannot reconcile while E-STOP active");this.state.controls.requiresReconciliation=false;this.audit("workforce-reconciled",{evidence});return true}
 dependencyBlockers(mission){
  return (mission?.dependencies||[]).filter(id=>{const dep=this.missionControl?.get(id);return !dep||!["complete","verified"].includes(dep.status)});
 }
 assignMission(missionId,slotId,{profileIds=[],expectedExecutionClass=null,transfer=false,source="controller"}={}){
  if(!this.missionControl)throw error("MISSION_CONTROL_REQUIRED","Mission Control is required for mission assignment");
  const mission=this.missionControl.get(missionId);if(!mission)throw error("UNKNOWN_MISSION","Unknown mission "+missionId,{missionId});
  const slot=this.registry.get(slotId);if(!slot)throw error("UNKNOWN_AGENT_SLOT","Unknown agent slot "+slotId,{slotId});
  const c=control(slot);
  if(this.state.controls.emergencyStop||c.emergencyStopped||c.quarantined||c.paused)throw error("AGENT_NOT_AVAILABLE","Agent slot is not available for assignment",{slotId});
  if(expectedExecutionClass&&slot.executionClass!==expectedExecutionClass)throw error("EXECUTION_CLASS_MISMATCH","Agent execution class does not match assignment",{slotId,actual:slot.executionClass,expected:expectedExecutionClass});
  const blockers=this.dependencyBlockers(mission);if(blockers.length)throw error("MISSION_DEPENDENCY_BLOCKED","Mission dependencies are not complete",{missionId,blockers});

  const oldSlotId=mission.assignedAgent||null,oldMissionId=slot.missionId||null;
  if(oldSlotId&&oldSlotId!==slotId&&!transfer)throw error("MISSION_ALREADY_ASSIGNED","Mission is already assigned",{missionId,assignedAgent:oldSlotId});
  if(oldMissionId&&oldMissionId!==missionId){
   const oldMission=this.missionControl.get(oldMissionId);
   if(activeMission(oldMission)&&!transfer)throw error("AGENT_ALREADY_ASSIGNED","Agent slot already has an active mission",{slotId,missionId:oldMissionId});
  }

  const slots=new Map(),missions=new Map();
  const rememberSlot=id=>{const x=id&&this.registry.get(id);if(x&&!slots.has(id))slots.set(id,clone(x));return x};
  const rememberMission=id=>{const x=id&&this.missionControl.get(id);if(x&&!missions.has(id))missions.set(id,clone(x));return x};
  const previousSlot=rememberSlot(oldSlotId),previousMission=rememberMission(oldMissionId);rememberSlot(slotId);rememberMission(missionId);
  const at=Date.now(),eventId=`assignment:${missionId}:${at}:${slotId}`;
  try{
   if(previousSlot&&previousSlot.id!==slotId&&previousSlot.missionId===missionId){previousSlot.missionId=null;previousSlot.profileIds=[];previousSlot.status="idle";previousSlot.updatedAt=at}
   if(previousMission&&previousMission.id!==missionId&&previousMission.assignedAgent===slotId){
    previousMission.assignedAgent=null;if(!terminal(previousMission.status)){previousMission.status="queued";previousMission.statusReason="assignment transferred from "+slotId}
    previousMission.updatedAt=at;previousMission.assignmentHistory=[...(previousMission.assignmentHistory||[]),{id:eventId,type:"released-for-transfer",slotId,at,source}].slice(-100);
   }
   slot.missionId=missionId;slot.profileIds=[...profileIds];slot.status="assigned";slot.updatedAt=at;
   mission.assignedAgent=slotId;mission.status="assigned";mission.statusReason=null;mission.updatedAt=at;
   mission.assignmentHistory=[...(mission.assignmentHistory||[]),{id:eventId,type:oldSlotId&&oldSlotId!==slotId?"transferred":"assigned",from:oldSlotId,to:slotId,at,source}].slice(-100);
   this.state.updatedAt=at;
   const inv=validateAssignmentInvariants(this.state);if(!inv.ok)throw error("ASSIGNMENT_INVARIANT_VIOLATION","Assignment invariants failed",{errors:inv.errors});
   this.audit("mission-assigned",{eventId,missionId,slotId,from:oldSlotId,profileIds:[...profileIds],transfer,source});return {mission,slot};
  }catch(e){
   for(const [id,snapshot] of slots){const target=this.registry.get(id);if(target)restore(target,snapshot)}
   for(const [id,snapshot] of missions){const target=this.missionControl.get(id);if(target)restore(target,snapshot)}
   throw e;
  }
 }
 releaseSlot(slotId,reason="released"){
  if(!this.missionControl)throw error("MISSION_CONTROL_REQUIRED","Mission Control is required for assignment release");
  const slot=this.registry.get(slotId);if(!slot)throw error("UNKNOWN_AGENT_SLOT","Unknown agent slot "+slotId,{slotId});
  const missionId=slot.missionId;if(!missionId)return slot;const mission=this.missionControl.get(missionId),at=Date.now();
  slot.missionId=null;slot.profileIds=[];slot.status="idle";slot.updatedAt=at;
  if(mission?.assignedAgent===slotId){mission.assignedAgent=null;if(!terminal(mission.status)){mission.status="queued";mission.statusReason=reason}mission.updatedAt=at}
  this.state.updatedAt=at;this.audit("mission-released",{missionId,slotId,reason});return slot;
 }
 assign(slotId,assignment={}){
  if(Object.prototype.hasOwnProperty.call(assignment,"missionId")){
   if(assignment.missionId)return this.assignMission(assignment.missionId,slotId,assignment);
   return this.releaseSlot(slotId,assignment.reason||"released");
  }
  const slot=this.registry.get(slotId);if(!slot)throw error("UNKNOWN_AGENT_SLOT","Unknown agent slot "+slotId,{slotId});
  const c=control(slot);if(this.state.controls.emergencyStop||c.emergencyStopped||c.quarantined||c.paused)throw error("AGENT_NOT_AVAILABLE","Agent unavailable for assignment",{slotId});
  return this.registry.assign(slotId,assignment);
 }
}
