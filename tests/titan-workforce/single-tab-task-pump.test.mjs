import assert from "node:assert/strict";
import {TitanSingleTabTaskPump,parseTenTaskBatch,initialSingleTabTaskState} from "../../hehggadaopoacecdllhhajmbjkdcmajg/1.26.901.11451_0/codex-sidepanel/titan-workforce/single-tab-task-pump.js";
import {createSidepanelConversationService,sendPrompt} from "../../hehggadaopoacecdllhhajmbjkdcmajg/1.26.901.11451_0/codex-sidepanel/titan-workforce/conversation-service.js";
import {TitanRuntimeOwner,SINGLE_TAB_TASK_ALARM} from "../../hehggadaopoacecdllhhajmbjkdcmajg/1.26.901.11451_0/codex-sidepanel/titan-workforce/runtime-owner.js";

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
const bridgeCalls=[],discardedTabs=[];
const panelService=createSidepanelConversationService({tabs:{query:async()=>[{...activeTab}],get:async id=>({...activeTab,id}),discard:async id=>{discardedTabs.push(id);return activeTab.active?undefined:{id,discarded:true}}},request:async(action,payload)=>{
  bridgeCalls.push({action,payload});
  if(action==="probe")return {composerReady:true,generating:true,assistantCount:0,lastText:"",lastUserText:""};
  if(action==="send")return {ok:true,sent:true};
}});
const panelConversation=await panelService.currentConversation();
assert.equal(panelConversation.key,"chatgpt-extension-tab:42");
await panelService.send({conversation:panelConversation,instruction:"Run one step",idempotencyKey:"x"});
assert.ok(bridgeCalls.some(x=>x.action==="send"));
activeTab={...activeTab,active:true};
assert.equal((await panelService.sleepTab(panelConversation)).reason,"ACTIVE_TAB_CANNOT_BE_DISCARDED");
activeTab={...activeTab,active:false};
assert.equal((await panelService.sleepTab(panelConversation)).success,true);
assert.deepEqual(discardedTabs,[42]);
activeTab={...activeTab,id:43};
await assert.rejects(()=>panelService.observe(panelConversation),e=>e.code==="CONVERSATION_IDENTITY_MISMATCH");


let retryNow=60_000,sleepCalls=0,sendAttempts=0;
const retryState=initialSingleTabTaskState();
Object.assign(retryState,{enabled:true,phase:"waiting_delivery",conversation:{key:"chatgpt-extension-tab:42",tabId:42,windowId:2,url:"https://github.com/acme/repo/issues/7"},intervalMinutes:1,missionText:"Implement feature",sourceUserFingerprint:"u123",nextRunAt:retryNow,nextDeliveryAt:retryNow,subtasks:parseTenTaskBatch(JSON.stringify(batch))});
const retryPump=new TitanSingleTabTaskPump({state:{singleTabTaskPump:retryState},conversationService:{
  assertConversation:async()=>true,
  observe:async()=>({assistantCount:2,userCount:2,generating:true,composerReady:true,composerTag:"DIV",composerId:"prompt-textarea",composerDisabled:false,sendButtonFound:true,sendButtonDisabled:true,sendButtonLabel:"Send",lastText:"working",lastUserText:"task",lastUserTextLength:4,lastAssistantTextLength:7,pageOrigin:"chrome-extension://chatgpt",pagePath:"/sidepanel",documentReadyState:"complete",visibilityState:"visible",userAgent:"Chrome test",language:"en"}),
  send:async()=>{sendAttempts++;const error=new Error("composer busy");error.code="PANEL_SEND_UNCONFIRMED";throw error},
  sleepTab:async()=>{sleepCalls++;return {attempted:true,success:true}}
},clock:()=>retryNow,save:async()=>{}});
assert.equal((await retryPump.tick()).action,"retry-scheduled");
assert.equal(retryPump.status().retryNextAt,retryNow+5*60_000);
for(let pass=1;pass<=5;pass++){
  retryNow=retryPump.status().retryNextAt;
  const result=await retryPump.tick();
  if(pass<5)assert.equal(result.action,"retry-scheduled");
  else assert.equal(result.action,"sleep-and-diagnostic");
}
assert.equal(sendAttempts,6,"initial attempt plus five retry passes");
assert.equal(sleepCalls,1);
assert.equal(retryPump.status().enabled,false);
assert.equal(retryPump.status().phase,"sleep_after_retry_failures");
assert.equal(retryPump.status().diagnosticReport.retry.failedRetryPasses,5);
assert.equal(retryPump.status().diagnosticReport.classification,"composer_busy_or_queue_unsupported");
assert.equal(retryPump.status().diagnosticReport.sleep.success,true);
assert.equal(retryPump.status().diagnosticReport.probe.lastUserText,undefined,"diagnostics omit conversation text");


const alarmState={},alarmCalls=[];
const owner=new TitanRuntimeOwner({createRuntime:async()=>({}),alarms:{get:async name=>alarmState[name]||null,clear:async name=>{delete alarmState[name];return true},create:async(name,info)=>{alarmState[name]={...info};alarmCalls.push({name,...info})}}});
const alarmApi={singleTabTasks:{status:()=>({enabled:true,conversation:{tabId:42},intervalMinutes:1,retryPending:true,retryIntervalMinutes:5})}};
await owner.ensureSingleTabAlarm(alarmApi);
assert.equal(alarmState[SINGLE_TAB_TASK_ALARM].periodInMinutes,5,"retrying changes the alarm to the five-minute retry cadence");

const previousDocument=globalThis.document,previousInputEvent=globalThis.InputEvent,previousKeyboardEvent=globalThis.KeyboardEvent;
globalThis.InputEvent=class extends Event{};globalThis.KeyboardEvent=class extends Event{};
let uiGenerating=true,userMessages=[],composerText="",acceptedClicks=0,buttonDisabled=false;
const mockComposer={tagName:"DIV",focus(){},dispatchEvent(){},get innerText(){return composerText},set innerText(v){composerText=v},set textContent(v){composerText=v}};
const mockButton={get disabled(){return buttonDisabled},click(){acceptedClicks++;userMessages.push(composerText);composerText=""}};
globalThis.document={
  querySelector(selector){if(selector.includes("stop-button"))return uiGenerating?{}:null;if(selector.includes("prompt-textarea"))return mockComposer;if(selector.includes("send-button"))return mockButton;return null},
  querySelectorAll(selector){if(selector.includes('author-role="assistant"'))return [];if(selector.includes('author-role="user"'))return userMessages.map(text=>({innerText:text}));return []},
  execCommand(command,_ui,value){if(command==="insertText")composerText=value;return true}
};
assert.equal(await sendPrompt("scheduled hard send"),true,"active generation does not block a UI-accepted send");
assert.equal(acceptedClicks,1);
buttonDisabled=true;
assert.equal(await sendPrompt("blocked submission"),false,"a disabled composer is not reported as sent");
assert.equal(composerText,"","an unaccepted prompt does not block later scheduled attempts");
globalThis.document=previousDocument;
if(previousInputEvent===undefined)delete globalThis.InputEvent;else globalThis.InputEvent=previousInputEvent;
if(previousKeyboardEvent===undefined)delete globalThis.KeyboardEvent;else globalThis.KeyboardEvent=previousKeyboardEvent;

console.log("Single-tab task pump tests PASS");

