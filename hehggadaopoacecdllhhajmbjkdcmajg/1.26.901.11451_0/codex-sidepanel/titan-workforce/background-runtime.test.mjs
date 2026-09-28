import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {TitanRuntimeOwner,RUNTIME_ALARM} from "./runtime-owner.js";

const dirname=path.dirname(fileURLToPath(import.meta.url));
const extensionRoot=path.resolve(dirname,"..","..");
const read=rel=>fs.readFileSync(path.join(extensionRoot,rel),"utf8");

function makeFactory(shared,counters){
 return async()=>{
  counters.instances++;
  const state=shared.value?JSON.parse(JSON.stringify(shared.value)):{
   controls:{armed:true,emergencyStop:false},
   agents:{A1:{id:"A1",executionClass:"chat_worker",status:"waiting-gate"}},
   missions:{m1:{id:"m1",status:"assigned"}},
   sendLedger:[],
   pendingKey:"m1/c1/A1/1"
  };
  const registry={list:()=>Object.values(state.agents),get:id=>state.agents[id]||null};
  const controller={
   registry,
   arm(){state.controls.armed=true;return true},
   disarm(){state.controls.armed=false;return true},
   emergencyStop(){state.controls.armed=false;state.controls.emergencyStop=true;return true},
   clearEmergencyStop(){state.controls.emergencyStop=false;state.controls.armed=false;return true},
   markReconciled(){return true}
  };
  const api={
   state,
   controller,
   missions:{list:()=>Object.values(state.missions),upsert:m=>(state.missions[m.id]=m,m)},
   services:{status:()=>({chat:{available:true}})},
   mcp:{status:()=>({count:0,online:0,tools:0})},
   capabilities:{status:()=>({count:0,healthy:0,failing:0})},
   integration:{readiness:()=>({chat:true})},
   controls:{pauseAgent(){},resumeAgent(){}},
   mergeController:{state:"open"},
   lifecycle:{async run(){counters.maintenance++;state.lifecycle={lastRunAt:Date.now(),mergePressure:{state:"open"}};return state.lifecycle}},
   liveChat:{
    async tick(){
     counters.ticks++;
     if(!state.controls.armed||state.controls.emergencyStop)return;
     if(state.pendingKey&&!state.sendLedger.some(x=>x.key===state.pendingKey)){
      state.sendLedger.push({key:state.pendingKey,status:"sent"});
      counters.dispatches++;
     }
    },
    async bindConversation(){return true},
    async startCycle(){return true}
   },
   async save(){shared.value=JSON.parse(JSON.stringify(state));counters.saves++;return true},
   dispose(){counters.disposals++}
  };
  return api;
 };
}

const shared={value:null};
const counters={instances:0,ticks:0,dispatches:0,saves:0,disposals:0,maintenance:0};
const alarmsState=new Map();
const alarms={
 async get(name){return alarmsState.get(name)||null},
 async create(name,options){alarmsState.set(name,{name,...options})}
};

const owner=new TitanRuntimeOwner({createRuntime:makeFactory(shared,counters),alarms});

await Promise.all([owner.ensure(),owner.ensure(),owner.ensure()]);
assert.equal(counters.instances,1,"one service-worker runtime instance per worker lifetime");

await owner.ensureAlarm();
await owner.ensureAlarm();
assert.equal(alarmsState.size,1,"runtime alarm must not duplicate");
assert.equal(alarmsState.get(RUNTIME_ALARM).periodInMinutes,1);

const sidepanelClosed=true;
assert.equal(sidepanelClosed,true);
await Promise.all([owner.tick("sidepanel-closed"),owner.tick("sidepanel-closed")]);
assert.equal(counters.dispatches,1,"concurrent ticks must not duplicate dispatch");
assert.equal(counters.maintenance,1,"concurrent ticks must run lifecycle maintenance exactly once");
assert.equal(shared.value.sendLedger.length,1,"send ledger persisted after background tick");

await owner.suspend();
const savedBeforeRestart=JSON.parse(JSON.stringify(shared.value));
owner.dispose();

const ownerAfterRestart=new TitanRuntimeOwner({createRuntime:makeFactory(shared,counters),alarms});
await ownerAfterRestart.ensure();
assert.deepEqual(ownerAfterRestart.api.state.sendLedger,savedBeforeRestart.sendLedger,"restart rehydrates persisted ledger");
await ownerAfterRestart.tick("restart");
assert.equal(counters.dispatches,1,"restart must not resend persisted action key");
assert.equal(counters.maintenance,2,"restarted runtime must resume lifecycle maintenance");
assert.equal(ownerAfterRestart.snapshot().owner,"background-service-worker");

await ownerAfterRestart.command("disarm",{reason:"test"});
assert.equal(ownerAfterRestart.api.state.controls.armed,false);
await ownerAfterRestart.command("arm");
assert.equal(ownerAfterRestart.api.state.controls.armed,true);
assert.equal(counters.instances,2,"reopen/commands reuse one runtime in the restarted worker");

const manifest=JSON.parse(read("manifest.json"));
assert.equal(manifest.background.service_worker,"titan-background.js");
assert.equal(manifest.background.type,"module");
assert.ok(fs.existsSync(path.join(extensionRoot,"titan-background.js")));

const index=read("codex-sidepanel/index.html");
assert.ok(!index.includes("titan-workforce/bootstrap.js"),"sidepanel must not own canonical runtime bootstrap");
assert.ok(index.includes("titan-workforce/sidepanel-client.js"),"sidepanel must load remote cockpit client");

const wrapper=read("titan-background.js");
for(const token of [
 "./background.js",
 "./titan-workforce/chat-five-pass-scheduler.js",
 "./titan-workforce/chat-five-pass-integration.js",
 "./codex-sidepanel/titan-agent-profiles.js",
 "./titan-work-codex-pipeline.js",
 "./codex-sidepanel/titan-workforce/background-runtime.js"
])assert.ok(wrapper.includes(token),"service-worker wrapper missing "+token);

console.log("Background autonomous runtime ownership tests passed");
