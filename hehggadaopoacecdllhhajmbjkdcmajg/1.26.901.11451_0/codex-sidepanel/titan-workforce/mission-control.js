import {normalizeMissionContract,validateMissionContract} from "./mission-contract.js";

const TERMINAL=new Set(["complete","verified","cancelled","superseded"]);
function assignmentError(message){const e=new Error(message);e.code="MISSION_ASSIGNMENT_CONTROLLER_REQUIRED";return e}

export class TitanMissionControl{
 constructor(state,{assignmentHandler=null}={}){
  this.state=state;this.state.missions=this.state.missions||{};this.assignmentHandler=assignmentHandler;
 }
 setAssignmentHandler(handler){
  if(handler!=null&&typeof handler!=="function")throw new TypeError("assignment handler must be a function");
  this.assignmentHandler=handler;return this;
 }
 upsert(raw){
  const m=normalizeMissionContract(raw),v=validateMissionContract(m);if(!v.ok)throw new Error(v.errors.join("; "));
  const current=this.state.missions[m.id]||null;
  const assignedAgent=current?.assignedAgent||m.assignedAgent||null;
  const assignmentHistory=current?.assignmentHistory||m.assignmentHistory||[];
  const statusHistory=current?.statusHistory||m.statusHistory||[];
  this.state.missions[m.id]={...current,...m,assignedAgent,assignmentHistory,statusHistory};
  this.state.updatedAt=Date.now();return this.state.missions[m.id];
 }
 get(id){return this.state.missions[id]||null}
 list(){return Object.values(this.state.missions)}
 assign(id,agentId,options={}){
  if(!this.assignmentHandler)throw assignmentError("Mission assignment must use the Workforce Controller transaction");
  return this.assignmentHandler(id,agentId,options);
 }
 clearAssignment(id,reason="released"){
  const m=this.get(id);if(!m)return null;
  const agentId=m.assignedAgent,slot=agentId?this.state.agents?.[agentId]:null,at=Date.now();
  if(slot?.missionId===id){slot.missionId=null;slot.profileIds=[];slot.status="idle";slot.updatedAt=at}
  m.assignedAgent=null;m.updatedAt=at;
  m.assignmentHistory=[...(m.assignmentHistory||[]),{id:`release:${id}:${at}`,type:"released",from:agentId,to:null,at,source:"mission-control",reason}].slice(-100);
  this.state.updatedAt=at;return m;
 }
 transition(id,status,reason=null){
  const m=this.get(id);if(!m)throw new Error("Unknown mission "+id);
  const previous=m.status,at=Date.now();
  m.status=status;m.statusReason=reason;m.updatedAt=at;
  m.statusHistory=[...(m.statusHistory||[]),{from:previous,to:status,reason,at}].slice(-100);
  if(TERMINAL.has(status))this.clearAssignment(id,"terminal:"+status);
  this.state.updatedAt=at;return m;
 }
 cancel(id,reason="cancelled"){return this.transition(id,"cancelled",reason)}
 supersede(id,replacementId){const m=this.transition(id,"superseded","superseded by "+replacementId);m.supersededBy=replacementId;return m}
 complete(id,reason="complete"){return this.transition(id,"complete",reason)}
 verify(id,reason="verified"){return this.transition(id,"verified",reason)}
}
