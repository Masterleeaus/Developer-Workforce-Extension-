function now(){return Date.now()}
export class TitanApprovalStore{
 constructor(state,{audit=()=>{}}={}){this.state=state;this.audit=audit;this.state.approvals=this.state.approvals||{}}
 create(request){const id=request.id||`approval-${now()}-${Math.random().toString(36).slice(2,8)}`;const r={...request,id,status:"pending",createdAt:now(),updatedAt:now()};this.state.approvals[id]=r;this.audit("approval-created",{id,type:r.type,missionId:r.missionId});return r}
 decide(id,{approved=false,actor="human",reason=null}={}){const r=this.state.approvals[id];if(!r)throw new Error("Unknown approval "+id);if(r.status!=="pending")throw new Error("Approval already decided");r.status=approved?"approved":"rejected";r.approved=!!approved;r.actor=actor;r.reason=reason;r.updatedAt=now();this.audit("approval-decided",{id,approved:!!approved,actor,reason});return r}
 get(id){return this.state.approvals[id]||null}
 pending(type=null){return Object.values(this.state.approvals).filter(x=>x.status==="pending"&&(!type||x.type===type))}
 async request(request){const r=this.create(request);return r}
}
export function persistApprovedScopeExpansion({state,missionControl,audit=()=>{}}){
 return async ({request,approval,packet,builderId,changedPaths})=>{
  if(!approval?.approved&&approval?.status!=="approved")throw new Error("Scope expansion not approved");
  const missionId=packet?.mission?.id||packet?.mission_id||request?.missionId;
  const m=missionControl.get(missionId);if(!m)throw new Error("Unknown mission "+missionId);
  const extra=request?.violations||changedPaths||[];
  m.scopePaths=[...new Set([...(m.scopePaths||[]),...extra])];m.updatedAt=Date.now();
  state.updatedAt=m.updatedAt;
  audit("scope-expansion-persisted",{missionId,builderId,approvalId:approval.id||null,scopePaths:m.scopePaths});
  return m;
 };
}
