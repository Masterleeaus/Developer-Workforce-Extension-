import {normalizeMissionContract,validateMissionContract} from "./mission-contract.js";
export class TitanMissionControl{
 constructor(state){this.state=state;this.state.missions=this.state.missions||{}}
 upsert(raw){const m=normalizeMissionContract(raw);const v=validateMissionContract(m);if(!v.ok)throw new Error(v.errors.join("; "));this.state.missions[m.id]={...(this.state.missions[m.id]||{}),...m};this.state.updatedAt=Date.now();return this.state.missions[m.id]}
 get(id){return this.state.missions[id]||null}
 list(){return Object.values(this.state.missions)}
 assign(id,agentId){const m=this.get(id);if(!m)throw new Error("Unknown mission "+id);m.assignedAgent=agentId;m.status="assigned";m.updatedAt=Date.now();return m}
 transition(id,status,reason=null){const m=this.get(id);if(!m)throw new Error("Unknown mission "+id);m.status=status;m.statusReason=reason;m.updatedAt=Date.now();return m}
 cancel(id,reason="cancelled"){return this.transition(id,"cancelled",reason)}
 supersede(id,replacementId){const m=this.transition(id,"superseded","superseded by "+replacementId);m.supersededBy=replacementId;return m}
}
