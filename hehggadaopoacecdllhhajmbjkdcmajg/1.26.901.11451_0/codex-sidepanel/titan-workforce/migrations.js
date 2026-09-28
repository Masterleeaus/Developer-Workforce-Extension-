import {WORKFORCE_SCHEMA_VERSION,SQUADS} from "./constants.js";
import {createWorkforceState} from "./state.js";

const clone=x=>x==null?x:JSON.parse(JSON.stringify(x));
const arr=x=>Array.isArray(x)?x:[];
const plain=x=>!!x&&typeof x==="object"&&!Array.isArray(x);

function legacyIdentity(identity,tabId){
 const out=plain(identity)?clone(identity):{};
 if(tabId!=null){
  if(out.tabId==null)out.tabId=tabId;
  if(out.legacyTabId==null)out.legacyTabId=tabId;
 }
 if(!Object.keys(out).length)return null;
 out.migratedFrom="titan-5x5-v3.0.34";
 return out;
}
function legacyMission(mission,{assignedAgent=null,status=null,source="legacy"}={}){
 if(!plain(mission)||!mission.id)return null;
 const out={...clone(mission),id:String(mission.id),assignedAgent,migratedFrom:"titan-5x5-v3.0.34",migrationSource:source};
 if(status&&!out.status)out.status=status;
 if(!out.status)out.status="queued";
 return out;
}
function addMission(next,mission,options){
 const out=legacyMission(mission,options);if(!out)return null;
 if(!next.missions[out.id])next.missions[out.id]=out;
 return next.missions[out.id];
}
function workerSlotId(worker){
 const n=Number(worker);
 if(Number.isInteger(n)&&n>=0&&n<5)return SQUADS.A[n];
 if(typeof worker==="string"&&/^W[1-5]$/.test(worker))return "A"+worker.slice(1);
 if(typeof worker==="string"&&/^A[1-5]$/.test(worker))return worker;
 return null;
}
function compatibilityArchive(source){
 return {
  source:"titan-5x5-v3.0.34",
  migrationVersion:2,
  review:{
   queue:clone(arr(source.reviewQueue)),
   active:clone(source.activeReview||null),
   history:clone(arr(source.reviewHistory)),
   attempts:plain(source.reviewAttempts)?clone(source.reviewAttempts):{}
  },
  ownershipLeases:arr(source.ownershipLeases).map((x,i)=>({...clone(x),migrationId:`legacy-lease-${i+1}`,agentId:workerSlotId(x?.worker??x?.workerIndex)})),
  approvals:arr(source.approvals).map((x,i)=>({...clone(x),migrationId:x?.id||`legacy-approval-${i+1}`})),
  missionQueue:clone(arr(source.missionQueue)),
  missionHistory:clone(arr(source.missionHistory)),
  dispatch:plain(source.dispatch)?clone(source.dispatch):null,
  convergence:plain(source.convergence)?clone(source.convergence):null,
  recovery:plain(source.recovery)?clone(source.recovery):null,
  reviewScheduler:plain(source.reviewScheduler)?clone(source.reviewScheduler):null,
  utilization:plain(source.utilization)?clone(source.utilization):null,
  auditLog:clone(arr(source.auditLog)),
  sendLedger:clone(arr(source.sendLedger)),
  counts:clone(arr(source.counts)),
  lastSeen:clone(arr(source.lastSeen)),
  workerHealth:clone(arr(source.workerHealth)),
  workerIdentity:clone(arr(source.workerIdentity)),
  checkpoints:clone(arr(source.checkpoints)),
  priorControls:{
   enabled:source.enabled===true,
   armed:source.armed===true,
   emergencyStop:source.emergencyStop===true,
   lastArmAt:source.lastArmAt||null
  }
 };
}

export function migrateLegacy5x5(legacy={}){
 const source=plain(legacy)?clone(legacy):{};
 const next=createWorkforceState();
 const tabs=arr(source.workerTabs),missions=arr(source.missions),identities=arr(source.workerIdentity);
 const health=arr(source.workerHealth),checkpoints=arr(source.checkpoints),counts=arr(source.counts),lastSeen=arr(source.lastSeen);

 for(let i=0;i<5;i++){
  const id=SQUADS.A[i],slot=next.agents[id];
  const mission=legacyMission(missions[i],{assignedAgent:id,status:"legacy-imported",source:"active-worker"});
  slot.conversation=legacyIdentity(identities[i],tabs[i]);
  slot.health=typeof health[i]?.status==="string"?health[i].status:typeof health[i]==="string"?health[i]:"migrated";
  slot.checkpoint=checkpoints[i]!=null?clone(checkpoints[i]):null;
  slot.legacyRuntime={
   passCount:Number.isFinite(counts[i])?counts[i]:0,
   lastSeen:Number.isFinite(lastSeen[i])?lastSeen[i]:0,
   health:health[i]!=null?clone(health[i]):null
  };
  if(mission){slot.missionId=mission.id;slot.status="legacy-imported";next.missions[mission.id]=mission}
  if(slot.conversation||mission){
   slot.control={...(slot.control||{}),paused:true,pauseReason:"legacy-migration-reconciliation"};
  }
 }

 for(const queued of arr(source.missionQueue))addMission(next,queued,{assignedAgent:null,status:"queued",source:"mission-queue"});
 for(const historical of arr(source.missionHistory))addMission(next,historical,{assignedAgent:null,status:historical?.status||"complete",source:"mission-history"});

 const migratedAt=Date.now(),compatibility=compatibilityArchive(source);
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
 next.recovery={
  migration:{
   source:"titan-5x5-v3.0.34",
   migrationVersion:2,
   migratedAt,
   needsReconciliation:true,
   legacyWasArmed:source.armed===true,
   legacyWasEnabled:source.enabled===true,
   priorRecovery:compatibility.recovery
  }
 };
 // Never carry armed/emergency runtime authority across architecture migration.
 next.controls.armed=false;
 next.controls.emergencyStop=false;
 next.controls.requiresReconciliation=true;
 next.schemaVersion=WORKFORCE_SCHEMA_VERSION;
 return next;
}
export function migrateWorkforceState(raw){
 if(!raw)return createWorkforceState();
 if(raw.schemaVersion===WORKFORCE_SCHEMA_VERSION)return raw;
 return migrateLegacy5x5(raw);
}
