import {WORKFORCE_SCHEMA_VERSION,SQUADS} from "./constants.js";
import {createWorkforceState} from "./state.js";
export function migrateLegacy5x5(legacy={}){
 const next=createWorkforceState();
 const tabs=legacy.workerTabs||[];
 const missions=legacy.missions||[];
 for(let i=0;i<5;i++){
   const id=SQUADS.A[i],slot=next.agents[id];
   slot.conversation=tabs[i]?{legacyTabId:tabs[i]}:null;
   slot.missionId=missions[i]?.id||null;
   slot.status=missions[i]?"legacy-imported":"idle";
   if(missions[i])next.missions[missions[i].id]={...missions[i],migratedFrom:"titan-5x5-v3.0.34",assignedAgent:id};
 }
 next.legacy={source:"titan-5x5-v3.0.34",migratedAt:Date.now(),reviewQueue:legacy.reviewQueue||[],auditLog:legacy.auditLog||[],sendLedger:legacy.sendLedger||[]};
 next.schemaVersion=WORKFORCE_SCHEMA_VERSION;return next;
}
export function migrateWorkforceState(raw){
 if(!raw)return createWorkforceState();
 if(raw.schemaVersion===WORKFORCE_SCHEMA_VERSION)return raw;
 return migrateLegacy5x5(raw);
}
