import {ensureAgentControlState} from "./state.js";

function transitionError(message,details={}){
 const e=new Error(message);e.code="INVALID_CONTROL_TRANSITION";Object.assign(e,details);return e;
}
function terminal(status){return ["complete","verified","cancelled","superseded"].includes(status)}

export class TitanWorkforceControls{
 constructor(controller,audit=()=>{}){this.controller=controller;this.audit=audit}
 pauseAgent(id,reason="manual"){
  const s=this.controller.registry.get(id);if(!s)throw new Error("Unknown agent "+id);
  const c=ensureAgentControlState(s);
  if(terminal(s.status))throw transitionError("Terminal agent cannot be paused",{id,status:s.status});
  if(c.quarantined)throw transitionError("Quarantined agent cannot be paused",{id});
  if(c.emergencyStopped||this.controller.state.controls.emergencyStop)throw transitionError("Emergency-stopped agent cannot be paused",{id});
  if(c.paused)return s;
  c.paused=true;c.pauseReason=reason;this.audit("agent-paused",{id,reason});return s
 }
 resumeAgent(id){
  const s=this.controller.registry.get(id);if(!s)throw new Error("Unknown agent "+id);
  const c=ensureAgentControlState(s);
  if(c.quarantined)throw transitionError("Quarantined agent requires explicit unquarantine",{id});
  if(c.emergencyStopped||this.controller.state.controls.emergencyStop)throw transitionError("Emergency-stopped agent cannot resume",{id});
  if(!c.paused)throw transitionError("Agent is not paused",{id});
  c.paused=false;c.pauseReason=null;this.audit("agent-resumed",{id});return s
 }
 quarantine(id,reason="manual"){
  const s=this.controller.registry.get(id);if(!s)throw new Error("Unknown agent "+id);
  const c=ensureAgentControlState(s);
  if(c.emergencyStopped||this.controller.state.controls.emergencyStop)throw transitionError("Emergency-stopped agent cannot change quarantine state",{id});
  c.quarantined=true;c.quarantineReason=reason;c.paused=true;c.pauseReason="quarantine";
  this.audit("agent-quarantined",{id,reason});return s
 }
 unquarantine(id,reason="manual"){
  const s=this.controller.registry.get(id);if(!s)throw new Error("Unknown agent "+id);
  const c=ensureAgentControlState(s);
  if(!c.quarantined)throw transitionError("Agent is not quarantined",{id});
  if(c.emergencyStopped||this.controller.state.controls.emergencyStop)throw transitionError("Emergency-stopped agent cannot unquarantine",{id});
  c.quarantined=false;c.quarantineReason=null;c.paused=true;c.pauseReason="post-quarantine";
  this.audit("agent-unquarantined",{id,reason});return s
 }
 pauseSquad(squad,reason="manual"){
  return this.controller.registry.list().filter(s=>s.squad===squad).filter(s=>{
   const c=ensureAgentControlState(s);return !terminal(s.status)&&!c.quarantined&&!c.emergencyStopped&&!this.controller.state.controls.emergencyStop;
  }).map(s=>this.pauseAgent(s.id,reason))
 }
 resumeSquad(squad){
  return this.controller.registry.list().filter(s=>s.squad===squad).filter(s=>{
   const c=ensureAgentControlState(s);return c.paused&&!c.quarantined&&!c.emergencyStopped&&!this.controller.state.controls.emergencyStop;
  }).map(s=>this.resumeAgent(s.id))
 }
 pauseAll(reason="manual"){
  return this.controller.registry.list().filter(s=>{
   const c=ensureAgentControlState(s);return !terminal(s.status)&&!c.quarantined&&!c.emergencyStopped&&!this.controller.state.controls.emergencyStop;
  }).map(s=>this.pauseAgent(s.id,reason))
 }
 resumeAll(){
  return this.controller.registry.list().filter(s=>{
   const c=ensureAgentControlState(s);return c.paused&&!c.quarantined&&!c.emergencyStopped&&!this.controller.state.controls.emergencyStop;
  }).map(s=>this.resumeAgent(s.id))
 }
}
