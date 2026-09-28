import assert from "node:assert/strict";
import {TitanUsageGovernor,USAGE_STATES,POLICIES} from "./usage-governor.js";

let t=1000;
const state={};
const audits=[];
const governor=new TitanUsageGovernor(state,{clock:()=>t,recoveryMs:1000,audit:(type,data)=>audits.push({type,data})});

assert.deepEqual(USAGE_STATES,["NORMAL","ELEVATED","CONSERVE","RESTRICTED","RECOVERY"]);
assert.equal(governor.status().state,"NORMAL");
assert.equal(governor.policy().slowdown,"normal");
assert.equal(governor.contextLimit(12000),12000);

for(let i=0;i<10;i++)governor.record("chat_turn",{missionId:"routine"});
for(let i=0;i<2;i++)governor.record("retry",{missionId:"routine"});
assert.equal(governor.status().state,"ELEVATED");

const conserve=governor.evaluate({reviewBacklog:5,ciBacklog:4});
assert.equal(conserve.state,"CONSERVE");
assert.equal(conserve.policy.slowdown,"moderate");
assert(conserve.policy.contextScale<1);
assert.equal(governor.contextLimit(12000),Math.floor(12000*conserve.policy.contextScale));

governor.record("restriction",{missionId:"routine"});
assert.equal(governor.status().state,"RESTRICTED");
assert.equal(governor.policy().slowdown,"high");
assert.equal(governor.policy().codexConcurrency,0);
assert.equal(governor.allowCodex().allowed,false);

const missions={
 urgent:{id:"urgent",priority:"P0",status:"runtime-verification"},
 normal:{id:"normal",priority:"P2",status:"research"},
 low:{id:"low",priority:"P3",status:"research"}
};
const slots=[
 {id:"A1",missionId:"low"},
 {id:"A2",missionId:"normal"},
 {id:"A3",missionId:"urgent"},
 {id:"A4",missionId:"low"},
 {id:"A5",missionId:"normal"}
];
const allowed=governor.allowedChatSlots(slots,missions);
assert.equal(allowed.length,POLICIES.RESTRICTED.chatConcurrency);
assert(allowed.includes("A3"),"verification/P0 work should survive throttling");

governor.clearRestriction();
assert.equal(governor.status().state,"RECOVERY");
assert.equal(governor.policy().slowdown,"moderate");
t+=1500;
const recovered=governor.evaluate();
assert.notEqual(recovered.state,"RESTRICTED");
assert.notEqual(recovered.state,"RECOVERY");

const missionBudget=governor.mission("routine");
assert.equal(missionBudget.chatTurns,10);
assert.equal(missionBudget.retries,2);
assert.equal(missionBudget.restrictionSignals,1);

governor.record("context",{missionId:"urgent",characters:4321});
governor.record("work_cycle",{missionId:"urgent"});
governor.record("codex_turn",{missionId:"urgent"});
governor.record("repair",{missionId:"urgent"});
governor.record("pass_duration",{missionId:"urgent",durationMs:300000});
const urgent=governor.mission("urgent");
assert.equal(urgent.contextCharacters,4321);
assert.equal(urgent.workCycles,1);
assert.equal(urgent.codexTurns,1);
assert.equal(urgent.repairCycles,1);
assert.equal(urgent.passDurations[0],300000);

governor.setConcurrency({codex:POLICIES.NORMAL.codexConcurrency});
if(governor.status().state==="NORMAL")assert.equal(governor.allowCodex().allowed,false);
governor.setConcurrency({codex:0});
assert.equal(governor.allowCodex().allowed,true);

assert(audits.some(x=>x.type==="usage-state-changed"));
assert(audits.some(x=>x.type==="usage-recorded"));
assert(state.usageGovernor.history.length>0);

console.log("Titan Usage Governor test PASS");
