import assert from "node:assert/strict";
import {TitanConversationLifecycle,buildConversationContinuation} from "./conversation-lifecycle.js";

function fixture({generating=false}={}){
 let clock=10_000_000;
 const state={
  agents:{
   A1:{id:"A1",executionClass:"chat_worker",squad:"A",missionId:"M1",profileIds:["crm"],status:"waiting-gate",conversation:{key:"https://chatgpt.com/c/old",conversationId:"old",tabId:11,boundAt:clock-8*24*3600000,cyclesCompleted:9,contextCharacters:65000,failures:0}},
   SUPERVISOR_A:{id:"SUPERVISOR_A",executionClass:"work_supervisor",squad:"A",missionId:"M1",profileIds:["mission-planning"],status:"reviewing",conversation:{key:"https://chatgpt.com/c/sup-old",conversationId:"sup-old",tabId:12,boundAt:clock-1000}}
  },
  missions:{M1:{id:"M1",title:"Mission One",goal:"Finish safely",status:"research",priority:"P1",scopePaths:["src/**"],acceptanceCriteria:["passes"]}},
  chatScheduler:{workers:{A1:{missionId:"M1",cycleId:"C7",currentPass:3,completedPasses:[{passNumber:1},{passNumber:2}],nextGateAt:clock+1000,state:"WAITING_GATE"}}},
  provenance:{p1:{id:"p1",missionId:"M1",at:1},p2:{id:"p2",missionId:"M1",at:2}},
  sendLedger:[{key:"k1",missionId:"M1"},{key:"k2",missionId:"M1"}]
 };
 const registry={get:id=>state.agents[id]||null,list:()=>Object.values(state.agents)};
 const missionControl={get:id=>state.missions[id]||null};
 const provenance={forMission:id=>Object.values(state.provenance).filter(x=>x.missionId===id)};
 const audits=[];
 const service={
  observe:async()=>({generating}),
  create:async({initialInstruction})=>({key:"https://chatgpt.com/c/new",conversationId:"new",tabId:21,title:"New",boundAt:clock+10,initialInstruction})
 };
 const binds=[];
 const manager=new TitanConversationLifecycle({
  state,registry,missionControl,provenance,conversationService:service,
  bindReplacement:async(id,conversation,{checkpoint})=>binds.push({id,conversation,checkpoint}),
  audit:(type,data)=>audits.push({type,data}),
  save:async()=>true,clock:()=>clock
 });
 return {state,manager,audits,binds,setClock:v=>clock=v};
}

{
 const {manager}=fixture();
 const verdict=manager.evaluate("A1");
 assert.equal(verdict.rotate,true);
 assert(verdict.reasons.includes("age"));
 assert(verdict.reasons.includes("cycles"));
 assert(verdict.reasons.includes("context-size"));
}

{
 const {manager,state}=fixture();
 const cp=manager.checkpoint("A1");
 assert.equal(cp.missionId,"M1");
 assert.equal(cp.scheduler.currentPass,3);
 assert.deepEqual(cp.provenanceIds,["p1","p2"]);
 assert.deepEqual(cp.sendKeys,["k1","k2"]);
 const text=buildConversationContinuation(cp);
 assert(text.includes("Checkpoint:"));
 assert(text.includes("pass 3/5"));
 assert(!text.toLowerCase().includes("transcript"));
 assert(state.conversationCheckpoints[cp.id]);
}

{
 const {manager}=fixture({generating:true});
 await assert.rejects(()=>manager.rotate("A1"),err=>err.code==="CONVERSATION_BUSY");
}

{
 const {manager,state,binds,audits}=fixture();
 const beforeWorker=JSON.stringify(state.chatScheduler.workers.A1);
 const beforeLedger=JSON.stringify(state.sendLedger);
 const result=await manager.rotate("A1");
 assert.equal(result.conversation.key,"https://chatgpt.com/c/new");
 assert.equal(result.archived.conversation.key,"https://chatgpt.com/c/old");
 assert.equal(state.conversationArchive.length,1);
 assert.equal(binds.length,1);
 assert.equal(JSON.stringify(state.chatScheduler.workers.A1),beforeWorker,"lifecycle manager must not reset scheduler state");
 assert.equal(JSON.stringify(state.sendLedger),beforeLedger,"lifecycle manager must not reset idempotency ledger");
 assert(audits.some(x=>x.type==="conversation-checkpoint-created"));
 assert(audits.some(x=>x.type==="conversation-rotated"));
 assert.equal(state.agents.A1.missionId,"M1");
 assert.deepEqual(state.agents.A1.profileIds,["crm"]);
}

{
 const {manager}=fixture();
 manager.note("A1",{cycleCompleted:true,contextCharacters:500,failure:true});
 const m=manager.metrics("A1");
 assert.equal(m.cycles,10);
 assert.equal(m.contextCharacters,65500);
 assert.equal(m.failures,1);
}

console.log("Titan conversation lifecycle tests PASS");
