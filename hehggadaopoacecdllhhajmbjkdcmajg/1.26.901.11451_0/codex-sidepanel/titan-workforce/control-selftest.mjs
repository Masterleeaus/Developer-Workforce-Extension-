import {createWorkforceState} from "./state.js";import {TitanWorkforceController} from "./controller.js";import {TitanWorkforceControls} from "./controls.js";import {TitanMissionControl} from "./mission-control.js";
const assert=(x,m)=>{if(!x)throw new Error(m)};const s=createWorkforceState(),mc=new TitanMissionControl(s),c=new TitanWorkforceController(s,{missionControl:mc}),ctl=new TitanWorkforceControls(c);mc.upsert({id:"m1",title:"control test mission"});\nc.markReconciled();c.assign("A1",{missionId:"m1"});ctl.quarantine("A1","bad");
let threw=false;try{ctl.resumeAgent("A1")}catch{threw=true}assert(threw,"quarantine bypass");
ctl.pauseSquad("A");assert(ctl.effectiveState("A1")==="quarantined","squad pause erased quarantine");
ctl.pauseAgent("A2");c.emergencyStop("test");assert(ctl.effectiveState("A1")==="emergency-stopped","estop missing");assert(s.agents.A1.status==="assigned","estop overwrote mission status");
c.clearEmergencyStop({reconciled:false});assert(!s.controls.armed&&s.controls.requiresReconciliation,"clear estop unsafe");assert(ctl.effectiveState("A1")==="quarantined","quarantine not restored");assert(ctl.effectiveState("A2")==="paused","pause not restored");
threw=false;try{c.arm()}catch{threw=true}assert(threw,"armed without reconciliation");c.markReconciled({ok:true});c.arm();assert(s.controls.armed,"arm after reconcile failed");
threw=false;try{ctl.unquarantine("A1")}catch{threw=true}assert(threw,"unquarantine without approval");ctl.unquarantine("A1",{approved:true});assert(ctl.effectiveState("A1")==="assigned","approved unquarantine failed");
console.log("Titan control-state safety PASS");
