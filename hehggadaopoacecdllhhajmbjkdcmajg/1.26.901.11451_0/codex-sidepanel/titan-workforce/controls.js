export class TitanWorkforceControls{
 constructor(controller,audit=()=>{}){this.controller=controller;this.audit=audit}
 pauseAgent(id,reason="manual"){const s=this.controller.registry.get(id);if(!s)throw new Error("Unknown agent "+id);s.status="paused";s.pauseReason=reason;this.audit("agent-paused",{id,reason});return s}
 resumeAgent(id){const s=this.controller.registry.get(id);if(!s)throw new Error("Unknown agent "+id);s.status=s.missionId?"assigned":"idle";s.pauseReason=null;this.audit("agent-resumed",{id});return s}
 quarantine(id,reason){const s=this.controller.registry.get(id);if(!s)throw new Error("Unknown agent "+id);s.status="quarantined";s.quarantineReason=reason;this.audit("agent-quarantined",{id,reason});return s}
 pauseSquad(squad,reason="manual"){return this.controller.registry.list().filter(s=>s.squad===squad).map(s=>this.pauseAgent(s.id,reason))}
 resumeSquad(squad){return this.controller.registry.list().filter(s=>s.squad===squad&&s.status==="paused").map(s=>this.resumeAgent(s.id))}
}
