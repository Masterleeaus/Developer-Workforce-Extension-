import {staleMissionActions,conversationRotationNeeded,staleWorkItems} from "./lifecycle.js";
const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
const arr=v=>Array.isArray(v)?v:[];
export function deriveMergeMetrics({pullRequests=[],verificationStates=[],mainChurn=0}={}){
 const prs=arr(pullRequests),verification=arr(verificationStates);
 return {openPRs:prs.filter(x=>x&&x.state!=="closed"&&x.merged!==true).length,ciPending:prs.filter(x=>x&&["pending","queued","in_progress","in-progress"].includes(String(x.ciStatus||x.ci_status||"").toLowerCase())).length,conflicts:prs.filter(x=>x&&(x.mergeable===false||x.conflict===true||x.conflicts===true)).length,verificationBacklog:verification.filter(x=>x&&!["verified","complete","pass"].includes(String(x.status||"").toLowerCase())).length,mainChurn:Number(mainChurn)||0};
}
function maintenanceError(code,message,details={}){const e=new Error(message);e.code=code;Object.assign(e,details);return e}
export class TitanLifecycleManager{
 constructor({state,missionControl,registry,mergeController,audit=()=>{},save=async()=>true,workItemProvider=null,verificationProvider=null,mainChurnProvider=null,requestApproval=null,now=()=>Date.now(),missionStaleMs=24*3600000,workStaleMs=3*3600000}={}){
  if(!state)throw new Error("state required");Object.assign(this,{state,missionControl,registry,mergeController,audit,save,workItemProvider,verificationProvider,mainChurnProvider,requestApproval,now,missionStaleMs,workStaleMs});
 }
 async snapshotInputs(){
  const workItems=typeof this.workItemProvider==="function"?await this.workItemProvider():arr(this.state.workItems);
  const verificationStates=typeof this.verificationProvider==="function"?await this.verificationProvider():Object.values(this.state.verification||{});
  const mainChurn=typeof this.mainChurnProvider==="function"?await this.mainChurnProvider():Number(this.state.mergeMetrics?.mainChurn||0);
  return {workItems:arr(workItems),verificationStates:arr(verificationStates),mainChurn:Number(mainChurn)||0};
 }
 conversationActions(){
  const out=[];for(const slot of this.registry?.list?.()||[]){const verdict=conversationRotationNeeded(slot,{now:this.now()});if(verdict.rotate)out.push({type:"conversation",agentId:slot.id,action:"ROTATE",reasons:verdict.reasons,requiresApproval:false})}return out;
 }
 plan({workItems=[]}={}){const now=this.now();return [...staleMissionActions(this.state.missions,{now,staleMs:this.missionStaleMs}).map(x=>({type:"mission",...x})),...this.conversationActions(),...staleWorkItems(workItems,{now,staleMs:this.workStaleMs}).map(x=>({type:"work-item",...x}))]}
 async applySafeAction(item){
  if(!item||typeof item!=="object")return null;
  if(item.type==="mission"&&item.action==="REPLAN"){const mission=this.missionControl?.get?.(item.missionId);if(!mission)return null;if(["verified","complete","cancelled","superseded","archived"].includes(mission.status))return {skipped:true,reason:"terminal"};const previous=mission.status;mission.status="attention";mission.statusReason="stale-mission-replan";mission.updatedAt=this.now();mission.lifecycleHistory=[...(mission.lifecycleHistory||[]),{action:"REPLAN",from:previous,to:"attention",at:mission.updatedAt}].slice(-100);this.audit("lifecycle-mission-replan",{missionId:mission.id,ageMs:item.ageMs});return {applied:true,missionId:mission.id,action:"REPLAN"}}
  if(item.type==="mission"&&item.action==="ARCHIVE"){const mission=this.missionControl?.get?.(item.missionId);if(!mission)return null;mission.archivedAt=this.now();mission.lifecycleHistory=[...(mission.lifecycleHistory||[]),{action:"ARCHIVE",at:mission.archivedAt}].slice(-100);this.audit("lifecycle-mission-archived",{missionId:mission.id});return {applied:true,missionId:mission.id,action:"ARCHIVE"}}
  if(item.type==="conversation"&&item.action==="ROTATE"){const slot=this.registry?.get?.(item.agentId);if(!slot?.conversation)return null;if(slot.health==="busy"||slot.status==="busy")return {skipped:true,reason:"generating"};slot.conversation.rotationRequired=true;slot.conversation.rotationReasons=[...item.reasons];slot.updatedAt=this.now();this.audit("lifecycle-conversation-rotation-required",{agentId:slot.id,reasons:item.reasons});return {applied:true,agentId:slot.id,action:"ROTATE"}}
  return null;
 }
 async requestDestructiveAction(item){
  if(!item?.requiresApproval)return null;if(typeof this.requestApproval!=="function")throw maintenanceError("APPROVAL_REQUIRED","Lifecycle action requires approval",{item:clone(item)});
  const approval=await this.requestApproval({type:"lifecycle-action",action:item.action,workItemId:item.id||item.workItemId||null,missionId:item.missionId||null,evidence:clone(item),requestedAt:this.now()});
  if(!approval?.approved)throw maintenanceError("APPROVAL_REQUIRED","Lifecycle action was not approved",{item:clone(item),approval:clone(approval)});return approval;
 }
 async run(){
  const inputs=await this.snapshotInputs(),actions=this.plan({workItems:inputs.workItems}),applied=[];
  for(const item of actions){if(item.requiresApproval)continue;const result=await this.applySafeAction(item);if(result)applied.push(result)}
  const metrics=deriveMergeMetrics({pullRequests:inputs.workItems,verificationStates:inputs.verificationStates,mainChurn:inputs.mainChurn});
  const pressure=this.mergeController?.evaluate?.(metrics)||{state:"open",score:0};
  this.state.lifecycle={lastRunAt:this.now(),actions:clone(actions).slice(-200),applied:clone(applied).slice(-200),mergeMetrics:metrics,mergePressure:pressure};await this.save();this.audit("lifecycle-maintenance-complete",{actions:actions.length,applied:applied.length,mergePressure:pressure.state,metrics});return clone(this.state.lifecycle);
 }
 assertAutomaticMergeAllowed(context={}){if(!this.mergeController?.canMerge?.())throw maintenanceError("MERGE_BACKPRESSURE","Automatic merge blocked by integration pressure",{pressure:this.mergeController?.state||"unknown",context:clone(context)});return true}
}