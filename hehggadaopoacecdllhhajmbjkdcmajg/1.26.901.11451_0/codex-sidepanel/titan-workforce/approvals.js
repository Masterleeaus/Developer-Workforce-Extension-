import {ensureDurabilityState,validApprovalType} from "./durability.js";
function now(){return Date.now()}
function err(code,message){const e=new Error(message);e.code=code;return e}
export class TitanApprovalStore{
 constructor(state,{audit=()=>{},save=async()=>{}}={}){
  this.state=ensureDurabilityState(state);this.audit=audit;this.save=save;
 }
 persist(){return Promise.resolve(this.save()).catch(error=>{this.audit("approval-persist-failed",{message:String(error?.message||error)});throw error})}
 validateType(type){if(!validApprovalType(type))throw err("UNKNOWN_APPROVAL_TYPE","Unknown approval type: "+type);return type}
 create(request){
  this.validateType(request?.type);
  const existing=Object.values(this.state.approvals).find(x=>x.status==="pending"&&x.type===request.type&&x.missionId===request.missionId&&x.packetId===request.packetId);
  if(existing)return existing;
  const id=request.id||"approval-"+now()+"-"+Math.random().toString(36).slice(2,8);
  const record={...request,id,status:"pending",approved:false,createdAt:now(),updatedAt:now()};
  this.state.approvals[id]=record;this.state.updatedAt=record.updatedAt;
  this.audit("approval-created",{id,type:record.type,missionId:record.missionId,packetId:record.packetId||null});
  this.persist().catch(()=>{});
  return record;
 }
 decide(id,{approved=false,actor="human",reason=null}={}){
  const record=this.state.approvals[id];
  if(!record)throw err("UNKNOWN_APPROVAL","Unknown approval "+id);
  if(record.status!=="pending")throw err("APPROVAL_ALREADY_DECIDED","Approval already decided");
  record.status=approved?"approved":"rejected";record.approved=!!approved;record.actor=actor;record.reason=reason;record.updatedAt=now();this.state.updatedAt=record.updatedAt;
  this.audit("approval-decided",{id,approved:!!approved,actor,reason});
  this.persist().catch(()=>{});
  return record;
 }
 findDecision(request){
  this.validateType(request?.type);
  return Object.values(this.state.approvals).find(x=>x.type===request.type&&x.missionId===request.missionId&&x.packetId===request.packetId&&["approved","rejected"].includes(x.status))||null;
 }
 async request(request){
  const found=this.findDecision(request);if(found)return found;
  const created=this.create(request);await this.persist();return created;
 }
 list({status=null,type=null}={}){
  return Object.values(this.state.approvals).filter(x=>(!status||x.status===status)&&(!type||x.type===type));
 }
}
export function persistApprovedScopeExpansion({state,missionControl,audit=()=>{},save=async()=>{}}){
 return async ({request,approval,packet,builderId,changedPaths})=>{
  if(!approval?.approved)throw err("SCOPE_EXPANSION_NOT_APPROVED","Scope expansion not approved");
  const missionId=packet?.mission?.id||packet?.mission_id||request?.missionId;
  const mission=missionControl.get(missionId);if(!mission)throw new Error("Unknown mission "+missionId);
  const extra=request?.violations||changedPaths||[];
  mission.scopePaths=[...new Set([...(mission.scopePaths||[]),...extra])];
  mission.updatedAt=Date.now();state.updatedAt=mission.updatedAt;
  audit("scope-expansion-persisted",{missionId,builderId,approvalId:approval.id,scopePaths:mission.scopePaths});
  await save();return mission;
 };
}
