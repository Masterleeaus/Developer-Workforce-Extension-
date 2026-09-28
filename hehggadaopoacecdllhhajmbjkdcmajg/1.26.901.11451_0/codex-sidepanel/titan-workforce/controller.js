import {TitanAgentRegistry} from "./registry.js";
import {ensureAgentControlState} from "./state.js";

function controlError(code,message,details={}){
 const e=new Error(message);e.code=code;Object.assign(e,details);return e;
}
function terminal(status){return ["complete","verified","cancelled","superseded"].includes(status)}

export class TitanWorkforceController{
 constructor(state,{audit=()=>{},services={}}={}){this.state=state;this.registry=new TitanAgentRegistry(state);this.audit=audit;this.services=services}
 arm(){
  if(this.state.controls.emergencyStop)throw controlError("EMERGENCY_STOP_ACTIVE","Cannot arm during emergency stop");
  const stopped=this.registry.list().filter(a=>ensureAgentControlState(a).emergencyStopped);
  if(stopped.length)throw controlError("AGENT_EMERGENCY_STOPPED","Cannot arm while agent emergency-stop flags remain",{agents:stopped.map(x=>x.id)});
  this.state.controls.armed=true;this.audit("workforce-armed",{});return true
 }
 disarm(reason="manual"){this.state.controls.armed=false;this.audit("workforce-disarmed",{reason});return true}
 emergencyStop(reason="manual"){
  this.state.controls.armed=false;this.state.controls.emergencyStop=true;this.state.controls.emergencyReason=reason;
  for(const a of this.registry.list()){
   if(terminal(a.status))continue;
   const control=ensureAgentControlState(a);control.emergencyStopped=true;control.emergencyReason=reason;
  }
  this.audit("workforce-emergency-stop",{reason});return true
 }
 clearEmergencyStop({reconciled=false}={}){
  if(!this.state.controls.emergencyStop)return true;
  if(!reconciled)throw controlError("RECOVERY_RECONCILIATION_REQUIRED","Emergency stop cannot be cleared before recovery reconciliation");
  this.state.controls.armed=false;this.state.controls.emergencyStop=false;this.state.controls.emergencyReason=null;
  for(const a of this.registry.list()){const control=ensureAgentControlState(a);control.emergencyStopped=false;control.emergencyReason=null}
  this.audit("workforce-emergency-cleared",{reconciled:true});return true
 }
 assign(slotId,assignment){
  const slot=this.registry.get(slotId);if(!slot)throw new Error("Unknown agent slot "+slotId);
  const control=ensureAgentControlState(slot);
  if(this.state.controls.emergencyStop||control.emergencyStopped||control.quarantined||control.paused){
   throw controlError("AGENT_NOT_AVAILABLE","Agent slot is not available for assignment",{slotId,control:{...control},emergencyStop:this.state.controls.emergencyStop});
  }
  const s=this.registry.assign(slotId,assignment);this.audit("agent-assigned",{slotId,missionId:s.missionId,profiles:s.profileIds});return s
 }
}
