import {WORKFORCE_SCHEMA_VERSION,SQUADS} from "./constants.js";
import {createWorkforceState,ensureAgentControlState,normalizeWorkforceState} from "./state.js";

const clone=x=>x==null?x:JSON.parse(JSON.stringify(x));
const arr=x=>Array.isArray(x)?x:[];
const plain=x=>!!x&&typeof x==="object"&&!Array.isArray(x);

function slotIdForLegacyWorker(worker){
 if(typeof worker==="string"&&/^W[1-5]$/.test(worker))return "A"+worker.slice(1);
 if(typeof worker==="string"&&/^A[1-5]$/.test(worker))return worker;
 const n=Number(worker);
 if(Number.isInteger(n)&&n>=0&&n<5)return SQUADS.A[n];
 return null;
}

function legacyIdentity(identity,tabId){
 if(!plain(identity)&&!tabId)return null;
 const out=plain(identity)?clone(identity):{};
 if(tabId&&!out.tabId)out.tabId=tabId;
 if(tabId&&!out.legacyTabId)out.legacyTabId=tabId;
 out.migratedFrom="titan-5x5-v3.0.34";
 return out;
}

function legacyMission(mission,{assignedAgent=undefined,status=null,source="legacy"}={}){
 if(!plain(mission)||!mission.id)return null;
 const m=clone(mission);
 m.id=String(m.id);
 if(assignedAgent!==undefined)m.assignedAgent=assignedAgent;
 else if(!Object.prototype.hasOwnProperty.call(m,"assignedAgent"))m.assignedAgent=null;
 if(status&&!m.status)m.status=status;
 if(!m.status)m.status="queued";
 m.migratedFrom="titan-5x5-v3.0.34";
 m.migrationSource=source;
 m.updatedAt=Number.isFinite(m.updatedAt)?m.updatedAt:Date.now();
 return m;
}

function mapOwnershipLeases(leases){
 return arr(leases).map((lease,index)=>{
  const worker=lease?.worker??lease?.workerIndex??null;
  const agentId=slotIdForLegacyWorker(worker);
  return {
   ...clone(lease),
   migrationId:`legacy-lease-${index+1}`,
   agentId,
   legacyWorker:worker,
   migratedFrom:"titan-5x5-v3.0.34"
  };
 });
}

function mapApprovals(approvals){
 return arr(approvals).map((approval,index)=>({
  ...clone(approval),
  migrationId:approval?.id||`legacy-approval-${index+1}`,
  migratedFrom:"titan-5x5-v3.0.34"
 }));
}

function addMissionIfUsable(next,raw,{status,source}){
 const m=legacyMission(raw,{assignedAgent:null,status,source});
 if(!m)return null;
 if(!next.missions[m.id])next.missions[m.id]=m;
 return next.missions[m.id];
}

export function migrateLegacy5x5(legacy={}){
 const source=plain(legacy)?clone(legacy):{};
 const next=createWorkforceState();
 const tabs=arr(source.workerTabs),missions=arr(source.missions),identities=arr(source.workerIdentity);
 const health=arr(source.workerHealth),checkpoints=arr(source.checkpoints),counts=arr(source.counts),lastSeen=arr(source.lastSeen);

 for(let i=0;i<5;i++){
   const id=SQUADS.A[i],slot=next.agents[id],mission=legacyMission(missions[i],{assignedAgent:id,status:"legacy-imported",source:"active-worker"});
   slot.conversation=legacyIdentity(identities[i],tabs[i]);
   slot.health=typeof health[i]?.status==="string"?health[i].status:typeof health[i]==="string"?health[i]:"migrated";
   slot.checkpoint=checkpoints[i]!=null?clone(checkpoints[i]):null;
   slot.legacyRuntime={
    passCount:Number.isFinite(counts[i])?counts[i]:0,
    lastSeen:Number.isFinite(lastSeen[i])?lastSeen[i]:0,
    health:health[i]!=null?clone(health[i]):null
   };
   if(mission){
    slot.missionId=mission.id;slot.status="legacy-imported";next.missions[mission.id]=mission;
   }
   if(slot.conversation||mission){
    const control=ensureAgentControlState(slot);
    control.paused=true;control.pauseReason="legacy-migration-reconciliation";
   }
 }

 for(const queued of arr(source.missionQueue))addMissionIfUsable(next,queued,{status:"queued",source:"mission-queue"});
 for(const historical of arr(source.missionHistory))addMissionIfUsable(next,historical,{status:historical?.status||"complete",source:"mission-history"});

 const migratedAt=Date.now();
 const compatibility={
  source:"titan-5x5-v3.0.34",
  migrationVersion:2,
  migratedAt,
  needsReconciliation:true,
  legacyWasArmed:source.armed===true,
  legacyWasEnabled:source.enabled===true,
  review:{
   queue:clone(arr(source.reviewQueue)),
   active:source.activeReview!=null?clone(source.activeReview):null,
   history:clone(arr(source.reviewHistory)),
   attempts:plain(source.reviewAttempts)?clone(source.reviewAttempts):{}
  },
  ownershipLeases:mapOwnershipLeases(source.ownershipLeases),
  approvals:mapApprovals(source.approvals),
  missionQueue:clone(arr(source.missionQueue)),
  missionHistory:clone(arr(source.missionHistory)),
  dispatch:plain(source.dispatch)?clone(source.dispatch):null,
  convergence:plain(source.convergence)?clone(source.convergence):null,
  recovery:plain(source.recovery)?clone(source.recovery):null,
  reviewScheduler:plain(source.reviewScheduler)?clone(source.reviewScheduler):null,
  utilization:plain(source.utilization)?clone(source.utilization):null,
  auditLog:clone(arr(source.auditLog)),
  sendLedger:clone(arr(source.sendLedger)),
  counts:clone(counts),
  lastSeen:clone(lastSeen),
  workerHealth:clone(health)
 };

 next.legacy={
  source:"titan-5x5-v3.0.34",
  migrationVersion:2,
  migratedAt,
  rawState:source,
  compatibility,
  reviewQueue:compatibility.review.queue,
  auditLog:compatibility.auditLog,
  sendLedger:compatibility.sendLedger
 };
 next.controls.armed=false;
 next.controls.emergencyStop=false;
 next.controls.emergencyReason=null;
 next.recovery={
  ...(plain(next.recovery)?next.recovery:{}),
  migration:{
   source:"titan-5x5-v3.0.34",
   migrationVersion:2,
   migratedAt,
   needsReconciliation:true,
   legacyWasArmed:source.armed===true,
   legacyWasEnabled:source.enabled===true
  }
 };
 next.schemaVersion=WORKFORCE_SCHEMA_VERSION;
 return normalizeWorkforceState(next);
}

export function migrateWorkforceState(raw){
 if(!raw)return createWorkforceState();
 if(raw.schemaVersion===WORKFORCE_SCHEMA_VERSION)return normalizeWorkforceState(raw);
 return migrateLegacy5x5(raw);
}
