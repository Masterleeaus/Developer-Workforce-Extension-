import assert from "node:assert/strict";
import {TitanSingleTabTaskPump,parseTenTaskBatch} from "../../hehggadaopoacecdllhhajmbjkdcmajg/1.26.901.11451_0/codex-sidepanel/titan-workforce/single-tab-task-pump.js";
import {createSidepanelConversationService} from "../../hehggadaopoacecdllhhajmbjkdcmajg/1.26.901.11451_0/codex-sidepanel/titan-workforce/conversation-service.js";

const batch={type:"titan_task_batch",subtasks:Array.from({length:10},(_,i)=>({id:`S${i+1}`,title:`Task ${i+1}`,instruction:`Do task ${i+1}`,done_when:`Task ${i+1} is verified`}))};
assert.equal(parseTenTaskBatch(JSON.stringify(batch)).length,10);
assert.throws(()=>parseTenTaskBatch(JSON.stringify({...batch,subtasks:batch.subtasks.slice(1)})),/exactly 10/);

let now=1_000_000,observation={assistantCount:0,generating:false,lastText:"",lastUserText:""};
const sent=[],audit=[],root={};
const conversation={key:"https://chatgpt.com/c/one",tabId:7};
const service={assertConversation:async c=>{assert.match(c.key,/^https:\/\/chatgpt\.com\/c\//);return true},observe:async()=>({...observation}),send:async x=>{sent.push(x);observation={...observation,assistantCount:observation.assistantCount+1,generating:true};return{ok:true}}};
const pump=new TitanSingleTabTaskPump({state:root,conversationService:service,clock:()=>now,save:async()=>{},audit:(...x)=>audit.push(x)});
await pump.bind(conversation,{intervalMinutes:2});await pump.start();
assert.equal((await pump.tick()).reason,"NOT_DUE");
now+=120_000;observation={assistantCount:1,generating:false,lastText:"",lastUserText:"Fix the login bug"};
assert.equal((await pump.tick()).action,"plan-requested");assert.equal(sent.length,1);
observation={assistantCount:2,generating:false,lastText:JSON.stringify(batch),lastUserText:"Fix the login bug"};now+=120_000;
assert.equal((await pump.tick()).action,"plan-accepted");assert.equal(pump.status().subtasks.length,10);
now+=120_000;assert.equal((await pump.tick()).action,"subtask-ui-accepted");assert.equal(sent.length,2);
observation={assistantCount:2,generating:true,lastText:"",lastUserText:"Fix the login bug"};now+=120_000;
assert.equal((await pump.tick()).action,"subtask-ui-accepted");assert.equal(pump.status().subtasks[0].status,"accepted_by_ui");assert.equal(pump.status().subtasks[1].status,"accepted_by_ui");assert.equal(sent.length,3);
const status=pump.status();await assert.rejects(()=>pump.bind({key:"https://chatgpt.com/c/other",tabId:8}),/Pause/);
await pump.pause();await pump.bind({key:"https://chatgpt.com/c/other",tabId:8});
assert.equal(pump.status().conversation.key,"https://chatgpt.com/c/other");
assert.equal(pump.status().history[0].status,"rebound_before_all_responses");
let uncertainNow=0;
const uncertain=new TitanSingleTabTaskPump({state:{},conversationService:{assertConversation:async()=>true,observe:async()=>({assistantCount:0,generating:false,lastUserText:"Implement feature"}),send:async()=>{throw new Error("bridge disconnected")}},clock:()=>uncertainNow});
await uncertain.bind(conversation,{intervalMinutes:1});await uncertain.start();uncertainNow=60_000;
assert.equal((await uncertain.tick()).action,"paused-for-review");
assert.equal(uncertain.status().enabled,false);assert.equal(uncertain.status().phase,"plan_send_uncertain");
let activeTab={id:42,windowId:2,title:"GitHub issue",url:"https://github.com/acme/repo/issues/7"};
const bridgeCalls=[];
const panelService=createSidepanelConversationService({tabs:{query:async()=>[{...activeTab}]},request:async(action,payload)=>{
  bridgeCalls.push({action,payload});
  if(action==="probe")return {composerReady:true,generating:true,assistantCount:0,lastText:"",lastUserText:""};
  if(action==="send")return {ok:true,sent:true};
}});
const panelConversation=await panelService.currentConversation();
assert.equal(panelConversation.key,"chatgpt-extension-tab:42");
await panelService.send({conversation:panelConversation,instruction:"Run one step",idempotencyKey:"x"});
assert.ok(bridgeCalls.some(x=>x.action==="send"));
activeTab={...activeTab,id:43};
await assert.rejects(()=>panelService.observe(panelConversation),e=>e.code==="CONVERSATION_IDENTITY_MISMATCH");
console.log("Single-tab task pump tests PASS");

