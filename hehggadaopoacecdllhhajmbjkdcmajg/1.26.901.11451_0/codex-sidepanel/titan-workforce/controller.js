import {TitanAgentRegistry} from "./registry.js";
export class TitanWorkforceController{
 constructor(state,{audit=()=>{},services={}}={}){this.state=state;this.registry=new TitanAgentRegistry(state);this.audit=audit;this.services=services}
 arm(){if(this.state.controls.emergencyStop)throw new Error("Cannot arm during emergency stop");this.state.controls.armed=true;this.audit("workforce-armed",{});return true}
 disarm(reason="manual"){this.state.controls.armed=false;this.audit("workforce-disarmed",{reason});return true}
 emergencyStop(reason="manual"){this.state.controls.armed=false;this.state.controls.emergencyStop=true;for(const a of this.registry.list())if(!["complete","verified"].includes(a.status))a.status="emergency-stopped";this.audit("workforce-emergency-stop",{reason});return true}
 clearEmergencyStop(){this.state.controls.emergencyStop=false;this.audit("workforce-emergency-cleared",{});return true}
 assign(slotId,assignment){const s=this.registry.assign(slotId,assignment);this.audit("agent-assigned",{slotId,missionId:s.missionId,profiles:s.profileIds});return s}
}
