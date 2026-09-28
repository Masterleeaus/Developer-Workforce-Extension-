import {SLOT_IDS,SLOT_CLASS} from "./constants.js";
export class TitanAgentRegistry{
 constructor(state){this.state=state}
 get(id){return this.state.agents?.[id]||null}
 list(executionClass=null){const a=SLOT_IDS.map(id=>this.get(id)).filter(Boolean);return executionClass?a.filter(x=>x.executionClass===executionClass):a}
 assign(id,{missionId=null,profileIds=[]}={}){
   const slot=this.get(id);if(!slot)throw new Error("Unknown agent slot "+id);
   slot.missionId=missionId;slot.profileIds=[...profileIds];slot.status=missionId?"assigned":"idle";slot.updatedAt=Date.now();this.state.updatedAt=slot.updatedAt;return slot;
 }
 compatible(id,executionClass){return SLOT_CLASS[id]===executionClass}
 snapshot(){return structuredClone(this.state)}
}
