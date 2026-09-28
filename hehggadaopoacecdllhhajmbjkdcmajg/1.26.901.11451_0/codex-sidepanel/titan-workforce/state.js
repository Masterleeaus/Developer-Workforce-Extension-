import {WORKFORCE_SCHEMA_VERSION,SLOT_IDS,SLOT_CLASS,SLOT_SQUAD} from "./constants.js";
const now=()=>Date.now();

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
 return {schemaVersion:WORKFORCE_SCHEMA_VERSION,agents:Object.fromEntries(SLOT_IDS.map(id=>[id,createAgentSlot(id)])),missions:{},squads:{A:{status:"idle"},B:{status:"idle"}},controls:{armed:false,emergencyStop:false,emergencyReason:null},provenance:{},createdAt:now(),updatedAt:now()};
}
export function validateWorkforceState(s){
 if(!s||s.schemaVersion!==WORKFORCE_SCHEMA_VERSION)return false;
 return SLOT_IDS.every(id=>s.agents?.[id]?.id===id&&s.agents[id].executionClass===SLOT_CLASS[id]);
}
