const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));

export const SINGLE_TAB_TASK_DEFAULTS=Object.freeze({
  intervalMinutes:10,
  batchSize:10,
  maxTaskCharacters:4000,
  maxResultCharacters:12000
});

export function initialSingleTabTaskState(){
  return {
    schemaVersion:1,
    enabled:false,
    phase:"unbound",
    conversation:null,
    intervalMinutes:SINGLE_TAB_TASK_DEFAULTS.intervalMinutes,
    batchSize:SINGLE_TAB_TASK_DEFAULTS.batchSize,
    missionText:null,
    sourceUserFingerprint:null,
    lastSeenUserFingerprint:null,
    baselineAssistantCount:0,
    subtasks:[],
    currentIndex:0,
    nextRunAt:null,
    lastCheckAt:null,
    lastActionAt:null,
    lastError:null,
    retryPending:false,
    retryTaskIndex:null,
    retryPasses:0,
    retryIntervalMinutes:5,
    maxRetryPasses:5,
    retryNextAt:null,
    retryLog:[],
    lastProbeSummary:null,
    diagnosticReport:null,
    history:[]
  };
}

export function parseTenTaskBatch(text){
  const source=String(text||"");
  const fenced=source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const start=fenced?fenced[1]:source.slice(source.indexOf("{"));
  if(!start||!start.trim().startsWith("{"))throw new Error("Plan response did not contain JSON");
  let value;
  try{value=JSON.parse(start.trim())}catch{throw new Error("Plan response JSON could not be parsed")}
  if(value?.type!=="titan_task_batch"||!Array.isArray(value.subtasks)||value.subtasks.length!==10){
    throw new Error("Plan must contain exactly 10 subtasks with type titan_task_batch");
  }
  const ids=new Set();
  return value.subtasks.map((task,index)=>{
    const id=String(task?.id||`S${index+1}`).trim();
    const title=String(task?.title||"").trim().slice(0,160);
    const instruction=String(task?.instruction||"").trim().slice(0,SINGLE_TAB_TASK_DEFAULTS.maxTaskCharacters);
    const doneWhen=String(task?.done_when||"").trim().slice(0,500);
    if(!title||!instruction||!doneWhen)throw new Error(`Subtask ${index+1} is missing title, instruction, or done_when`);
    if(ids.has(id))throw new Error(`Duplicate subtask id: ${id}`);
    ids.add(id);
    return {id,title,instruction,doneWhen,status:"queued",result:null,dispatchedAt:null,completedAt:null};
  });
}

function fingerprint(value){
  let h=2166136261;
  for(const ch of String(value||"")){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}
  return `u${(h>>>0).toString(16)}`;
}
function summarizeProbe(probe,at=Date.now()){
  if(!probe)return null;
  return {
    at,pageOrigin:probe.pageOrigin||null,pagePath:probe.pagePath||null,
    documentReadyState:probe.documentReadyState||null,visibilityState:probe.visibilityState||null,
    userAgent:probe.userAgent||null,language:probe.language||null,
    composerReady:!!probe.composerReady,composerTag:probe.composerTag||null,composerId:probe.composerId||null,
    composerDisabled:!!probe.composerDisabled,composerTextLength:String(probe.composerText||"").length,
    sendButtonFound:!!probe.sendButtonFound,sendButtonDisabled:!!probe.sendButtonDisabled,sendButtonLabel:probe.sendButtonLabel||null,
    generating:!!probe.generating,stopButtonFound:!!probe.stopButtonFound,stopButtonLabel:probe.stopButtonLabel||null,
    userCount:Number(probe.userCount||0),assistantCount:Number(probe.assistantCount||0),
    lastUserTextLength:Number(probe.lastUserTextLength||String(probe.lastUserText||"").length),
    lastAssistantTextLength:Number(probe.lastAssistantTextLength||String(probe.lastText||"").length)
  };
}
export function analyzeSingleTabDiagnostic(report){
  const code=String(report?.failure?.code||""),probe=report?.probe||{};
  let classification="chatgpt_ui_send_failure",likelyCause="The visible composer did not confirm the scheduled prompt.",nextSteps=["Reopen the ChatGPT extension side panel on the bound tab.","Check whether the selected Chat, Work, or Codex view exposes a usable composer.","Review the send-attempt timeline before restarting to avoid duplicate work."];
  if(code.includes("PANEL_CONVERSATION_UNAVAILABLE")||code.includes("PANEL_BRIDGE")){classification="side_panel_bridge_unavailable";likelyCause="The background runner could not reach the ChatGPT side-panel bridge.";nextSteps=["Reopen the ChatGPT extension side panel.","Confirm the extension is enabled and reload it if needed.","Rebind the active host tab and restart the runner."]}
  else if(code.includes("IDENTITY")||code.includes("NO_TAB")){classification="bound_tab_unavailable";likelyCause="The bound tab was changed, closed, or could not be addressed during retries.";nextSteps=["Restore the original tab or bind the intended tab again.","Check whether Chrome discarded or closed the page."]}
  else if(!probe.composerReady){classification="composer_not_detected";likelyCause="The active ChatGPT extension view did not expose a composer matching the supported selectors.";nextSteps=["Open a supported ChatGPT conversation view.","Keep the side panel open and rebind the host tab.","If this is Work or Codex mode, capture the view-specific composer structure for a targeted adapter."]}
  else if(probe.generating&&probe.sendButtonDisabled){classification="composer_busy_or_queue_unsupported";likelyCause="ChatGPT was generating and the visible send/queue control remained disabled.";nextSteps=["Wait for the model to finish, or use a view that supports queued prompts.","Do not assume an unconfirmed attempt reached ChatGPT."]}
  return {classification,likelyCause,nextSteps};
}

export class TitanSingleTabTaskPump{
  constructor({state,conversationService,save=async()=>{},audit=()=>{},clock=()=>Date.now()}={}){
    if(!state||!conversationService)throw new Error("Single-tab task pump requires state and conversation service");
    this.rootState=state;
    this.state=state.singleTabTaskPump&&typeof state.singleTabTaskPump==="object"
      ?state.singleTabTaskPump
      :initialSingleTabTaskState();
    this.rootState.singleTabTaskPump=this.state;
    this.conversationService=conversationService;
    this.save=save;this.audit=audit;this.clock=clock;this.ticking=false;
  }
  status(){return clone(this.state)}
  async bind(conversation,{intervalMinutes=this.state.intervalMinutes}={}){
    if(this.state.enabled)throw new Error("Pause the single-tab runner before rebinding its conversation");
    if(!conversation?.key||!Number.isSafeInteger(conversation.tabId))throw new Error("A ChatGPT conversation tab identity is required");
    await this.conversationService.assertConversation(conversation);
    const interval=Math.max(1,Math.min(1440,Math.round(Number(intervalMinutes)||SINGLE_TAB_TASK_DEFAULTS.intervalMinutes)));
    const history=Array.isArray(this.state.history)?this.state.history.slice(-19):[];
    if(this.state.missionText&&this.state.subtasks?.length&&this.state.currentIndex<this.state.subtasks.length){
      history.push({taskFingerprint:this.state.sourceUserFingerprint,missionText:this.state.missionText,status:"rebound_before_all_responses",subtasks:clone(this.state.subtasks)});
    }
    this.state={...initialSingleTabTaskState(),history,conversation:clone(conversation),intervalMinutes:interval,phase:"watching"};
    this.rootState.singleTabTaskPump=this.state;
    this.audit("single-tab-conversation-bound",{key:conversation.key,tabId:conversation.tabId,intervalMinutes:interval});
    await this.save();
    return this.status();
  }
  async start({intervalMinutes=this.state.intervalMinutes}={}){
    if(!this.state.conversation)throw new Error("Bind one ChatGPT conversation before starting");
    const interval=Math.max(1,Math.min(1440,Math.round(Number(intervalMinutes)||SINGLE_TAB_TASK_DEFAULTS.intervalMinutes)));
    await this.conversationService.assertConversation(this.state.conversation);
    this.state.enabled=true;this.state.intervalMinutes=interval;
    this.state.nextRunAt=this.clock()+interval*60000;this.state.lastError=null;
    if(this.state.phase==="unbound")this.state.phase="watching";
    this.audit("single-tab-task-pump-started",{key:this.state.conversation.key,intervalMinutes:interval});
    await this.save();
    return this.status();
  }
  async pause(reason="manual"){
    this.state.enabled=false;this.state.nextRunAt=null;
    this.audit("single-tab-task-pump-paused",{reason,phase:this.state.phase,currentIndex:this.state.currentIndex});
    await this.save();return this.status();
  }
  async clear(){
    this.state=initialSingleTabTaskState();this.rootState.singleTabTaskPump=this.state;
    this.audit("single-tab-task-pump-cleared",{});await this.save();return this.status();
  }
  async tick(){
    if(this.ticking)return {action:"held",reason:"TICK_ALREADY_RUNNING"};
    if(!this.state.enabled||!this.state.conversation)return {action:"idle",reason:"NOT_RUNNING"};
    const now=this.clock();
    if(this.state.nextRunAt&&now<this.state.nextRunAt)return {action:"idle",reason:"NOT_DUE",nextRunAt:this.state.nextRunAt};
    this.ticking=true;
    try{
      const conversation=this.state.conversation;
      await this.conversationService.assertConversation(conversation);
      const observation=await this.conversationService.observe(conversation);
      this.state.lastCheckAt=now;
      this.state.lastProbeSummary=summarizeProbe(observation,now);
      this.state.nextRunAt=now+(this.state.retryPending?this.state.retryIntervalMinutes:this.state.intervalMinutes)*60000;
      if(observation?.generating&&this.state.phase==="awaiting_plan"){await this.save();return {action:"waiting",reason:"PLAN_RESPONSE_STILL_GENERATING"}}
      let action={action:"checked",phase:this.state.phase};
      if(this.state.retryPending&&now>=Number(this.state.retryNextAt||0))action=await this.dispatchNext(observation,now);
      else if(this.state.phase==="awaiting_plan")action=this.acceptPlan(observation,now);
      else if(this.state.phase==="waiting_delivery"&&now>=Number(this.state.nextDeliveryAt||0))action=await this.dispatchNext(observation,now);
      else if(this.state.phase==="watching")action=await this.detectTask(observation,now);
      if(!["subtask-attempted-unconfirmed","retry-scheduled","sleep-and-diagnostic"].includes(action.action))this.state.lastError=null;
      await this.save();
      return action;
    }catch(error){
      if(this.state.retryPending){
        const action=await this.recordRetryFailure(error,now,"bridge_or_probe");
        await this.save();
        return action;
      }
      if(this.state.phase==="waiting_delivery"&&this.state.subtasks?.[this.state.currentIndex])return this.startRetryFromError(error,now,"bridge_or_probe");
      this.state.lastError={code:error?.code||"TASK_PUMP_ERROR",message:String(error?.message||error),at:now};
      if(this.state.phase==="awaiting_plan"&&/Plan|Subtask|JSON/i.test(this.state.lastError.message)){
        this.state.enabled=false;
        this.state.phase="plan_invalid";
        this.state.nextRunAt=null;
      }else if(error?.code==="CONVERSATION_IDENTITY_MISMATCH"||/No tab with id/i.test(this.state.lastError.message)){
        this.state.enabled=false;
        this.state.phase="conversation_lost";
        this.state.nextRunAt=null;
      }else this.state.nextRunAt=now+this.state.intervalMinutes*60000;
      await this.save();
      this.audit("single-tab-task-pump-error",{code:this.state.lastError.code,message:this.state.lastError.message});
      return {action:"error",...clone(this.state.lastError)};
    }finally{this.ticking=false}
  }
  async detectTask(observation,now){
    const text=String(observation?.lastUserText||"").trim();
    if(!text)return {action:"checked",reason:"NO_USER_TASK"};
    const key=fingerprint(text);
    if(key===this.state.sourceUserFingerprint)return {action:"checked",reason:"TASK_ALREADY_SEEN"};
    if(key===this.state.lastSeenUserFingerprint)return {action:"checked",reason:"TASK_ALREADY_SEEN"};
    this.state.missionText=text.slice(0,12000);
    this.state.sourceUserFingerprint=key;
    this.state.lastSeenUserFingerprint=key;
    this.state.baselineAssistantCount=Number(observation?.assistantCount||0);
    this.state.phase="awaiting_plan";
    const prompt=[
      "TITAN SINGLE-TAB TASK PLAN",
      "Break the original task below into exactly 10 ordered, independently verifiable subtasks.",
      "Do not execute any subtask yet. Keep scope focused on the task I just gave you.",
      "Return only a JSON object: {\"type\":\"titan_task_batch\",\"subtasks\":[{\"id\":\"S1\",\"title\":\"...\",\"instruction\":\"...\",\"done_when\":\"...\"}]}.",
      "Include exactly 10 subtasks. Each instruction must be concrete and sized for one work interval.",
      "ORIGINAL TASK:",
      this.state.missionText
    ].join("\n");
    try{
      await this.conversationService.send({conversation:this.state.conversation,instruction:prompt,idempotencyKey:`${key}/plan`});
    }catch(error){
      this.state.enabled=false;
      this.state.phase="plan_send_uncertain";
      this.state.nextRunAt=null;
      this.state.lastError={code:error?.code||"SEND_UNCERTAIN",message:String(error?.message||error),at:now};
      await this.save();
      this.audit("single-tab-plan-send-uncertain",{conversationKey:this.state.conversation.key});
      return {action:"paused-for-review",reason:"SEND_UNCERTAIN"};
    }
    this.state.lastSeenUserFingerprint=fingerprint(prompt);
    this.state.lastActionAt=now;
    this.audit("single-tab-task-plan-requested",{conversationKey:this.state.conversation.key,userTaskFingerprint:key});
    return {action:"plan-requested",taskFingerprint:key};
  }
  acceptPlan(observation,now){
    if(Number(observation?.assistantCount||0)<=this.state.baselineAssistantCount||!String(observation?.lastText||"").trim())return {action:"waiting",reason:"PLAN_NOT_READY"};
    const tasks=parseTenTaskBatch(observation.lastText);
    this.state.subtasks=tasks;this.state.currentIndex=0;this.state.phase="waiting_delivery";
    this.state.nextDeliveryAt=now+this.state.intervalMinutes*60000;
    this.state.baselineAssistantCount=Number(observation.assistantCount||0);
    this.state.lastActionAt=now;
    this.audit("single-tab-task-plan-accepted",{count:tasks.length,intervalMinutes:this.state.intervalMinutes});
    return {action:"plan-accepted",subtaskCount:tasks.length,nextDeliveryAt:this.state.nextDeliveryAt};
  }
  async dispatchNext(observation,now){
    const task=this.state.subtasks[this.state.retryPending?this.state.retryTaskIndex:this.state.currentIndex];
    if(!task){this.state.phase="batch_dispatched";this.state.nextDeliveryAt=null;return {action:"batch-dispatched",count:this.state.subtasks.length}}
    const retrying=!!this.state.retryPending;
    const number=(this.state.retryPending?this.state.retryTaskIndex:this.state.currentIndex)+1;
    const runKey=`${this.state.sourceUserFingerprint}/${task.id}`;
    const marker=`SEND KEY: ${runKey}`;
    if(retrying&&String(observation?.lastUserText||"").includes(marker)){
      return this.acceptTaskSubmission(task,number,now,true);
    }
    const prompt=[
      `TITAN SINGLE-TAB SUBTASK ${number}/10`,
      `ID: ${task.id}`,
      marker,
      `TITLE: ${task.title}`,
      `TASK: ${task.instruction}`,
      `DONE WHEN: ${task.doneWhen}`,
      "Work only on this subtask in the current repository/conversation context. Do not start another subtask.",
      "Use the existing conversation context, including work and responses already present. At the end, report what changed, evidence/checks, whether the done condition is met, and any blocker."
    ].join("\n");
    task.status="send_attempted";task.dispatchedAt=now;this.state.lastActionAt=now;
    await this.save();
    try{
      const result=await this.conversationService.send({conversation:this.state.conversation,instruction:prompt,idempotencyKey:runKey});
      if(result?.ok===false)throw Object.assign(new Error("Visible ChatGPT UI did not accept the prompt"),{code:"PANEL_SEND_UNCONFIRMED"});
      return this.acceptTaskSubmission(task,number,now,false);
    }catch(error){
      task.status="retry_pending";
      task.sendError={code:error?.code||"SEND_UNCONFIRMED",message:String(error?.message||error),at:now};
      this.state.lastError={...task.sendError,subtaskId:task.id};
      this.audit("single-tab-subtask-send-attempt-failed",{subtaskId:task.id,number,retrying,code:task.sendError.code,message:task.sendError.message});
      if(retrying)return this.recordRetryFailure(error,now,"send");
      this.state.retryPending=true;this.state.retryTaskIndex=this.state.currentIndex;this.state.retryPasses=0;
      this.state.retryNextAt=now+this.state.retryIntervalMinutes*60000;this.state.phase="retry_wait";
      this.state.nextRunAt=this.state.retryNextAt;
      this.state.retryLog=[...(this.state.retryLog||[]),{at:now,pass:0,subtaskId:task.id,code:task.sendError.code,message:task.sendError.message,probe:clone(this.state.lastProbeSummary)}].slice(-20);
      await this.save();
      return {action:"retry-scheduled",subtaskId:task.id,retryAt:this.state.retryNextAt,retryPass:0};
    }
  }
  async acceptTaskSubmission(task,number,now,recovered=false){
    task.status=recovered?"accepted_by_ui_recovered":"accepted_by_ui";task.uiAcceptedAt=now;
    task.sendError=null;this.state.currentIndex=Math.max(this.state.currentIndex,this.state.retryTaskIndex??this.state.currentIndex)+1;
    this.state.retryPending=false;this.state.retryTaskIndex=null;this.state.retryPasses=0;this.state.retryNextAt=null;
    this.state.phase=this.state.currentIndex>=this.state.subtasks.length?"batch_dispatched":"waiting_delivery";
    this.state.nextDeliveryAt=this.state.phase==="waiting_delivery"?now+this.state.intervalMinutes*60000:null;
    this.state.nextRunAt=this.state.phase==="waiting_delivery"?this.state.nextDeliveryAt:now+this.state.intervalMinutes*60000;
    this.state.lastError=null;
    this.audit("single-tab-subtask-submitted",{subtaskId:task.id,number,recovered,conversationKey:this.state.conversation.key});
    await this.save();
    return {action:recovered?"subtask-ui-acceptance-recovered":"subtask-ui-accepted",subtaskId:task.id,number,recovered,nextDeliveryAt:this.state.nextDeliveryAt};
  }
  async startRetryFromError(error,now,stage){
    const task=this.state.subtasks[this.state.currentIndex];
    const failure={code:error?.code||"SEND_UNCONFIRMED",message:String(error?.message||error),at:now,stage};
    task.status="retry_pending";task.sendError=failure;this.state.lastError={...failure,subtaskId:task.id};
    this.state.retryPending=true;this.state.retryTaskIndex=this.state.currentIndex;this.state.retryPasses=0;
    this.state.retryNextAt=now+this.state.retryIntervalMinutes*60000;this.state.phase="retry_wait";this.state.nextRunAt=this.state.retryNextAt;
    this.state.retryLog=[...(this.state.retryLog||[]),{at:now,pass:0,subtaskId:task.id,...failure,probe:clone(this.state.lastProbeSummary)}].slice(-20);
    this.audit("single-tab-subtask-retry-started",{subtaskId:task.id,stage,code:failure.code});
    await this.save();
    return {action:"retry-scheduled",subtaskId:task.id,retryAt:this.state.retryNextAt,retryPass:0};
  }
  async recordRetryFailure(error,now,stage){
    this.state.retryPasses=Number(this.state.retryPasses||0)+1;
    const task=this.state.subtasks[this.state.retryTaskIndex];
    const failure={code:error?.code||"RETRY_FAILED",message:String(error?.message||error),at:now,stage};
    this.state.lastError={...failure,subtaskId:task?.id||null};
    if(task){task.status="retry_pending";task.sendError=failure}
    this.state.retryLog=[...(this.state.retryLog||[]),{at:now,pass:this.state.retryPasses,subtaskId:task?.id||null,...failure,probe:clone(this.state.lastProbeSummary)}].slice(-20);
    this.audit("single-tab-subtask-retry-failed",{subtaskId:task?.id||null,retryPass:this.state.retryPasses,stage,code:failure.code});
    if(this.state.retryPasses>=this.state.maxRetryPasses)return this.sleepAndReport(failure,now);
    this.state.retryNextAt=now+this.state.retryIntervalMinutes*60000;this.state.nextRunAt=this.state.retryNextAt;this.state.phase="retry_wait";
    await this.save();
    return {action:"retry-scheduled",subtaskId:task?.id||null,retryPass:this.state.retryPasses,retryAt:this.state.retryNextAt};
  }
  async sleepAndReport(failure,now){
    const currentTask=this.state.subtasks[this.state.retryTaskIndex];
    const conversation=this.state.conversation||{};
    let origin=null;try{origin=new URL(conversation.url||"").origin}catch{}
    const report={
      schemaVersion:1,createdAt:now,trigger:"five_retry_passes_failed",failure:{...failure},
      conversation:{tabId:conversation.tabId??null,windowId:conversation.windowId??null,origin,key:conversation.key||null},
      subtask:{id:currentTask?.id||null,index:Number(this.state.retryTaskIndex)+1,total:this.state.subtasks.length},
      retry:{intervalMinutes:this.state.retryIntervalMinutes,failedRetryPasses:this.state.retryPasses,maxRetryPasses:this.state.maxRetryPasses,attempts:clone(this.state.retryLog||[])},
      probe:clone(this.state.lastProbeSummary),
      extension:{version:globalThis.chrome?.runtime?.getManifest?.().version||null,userAgent:globalThis.navigator?.userAgent||null},
      sleep:{attempted:false,success:false,reason:"TAB_DISCARD_NOT_ATTEMPTED"}
    };
    Object.assign(report,analyzeSingleTabDiagnostic(report));
    this.state.enabled=false;this.state.retryPending=false;this.state.retryNextAt=null;this.state.nextRunAt=null;this.state.phase="sleep_after_retry_failures";this.state.diagnosticReport=report;
    await this.save();
    try{
      const sleep=await this.conversationService.sleepTab?.(this.state.conversation);
      report.sleep=sleep||{attempted:false,success:false,reason:"TAB_SLEEP_ADAPTER_UNAVAILABLE"};
    }catch(error){report.sleep={attempted:true,success:false,reason:String(error?.message||error)}}
    report.sleepNote=report.sleep.success?"Bound tab discarded from memory; it reloads when opened.":report.sleep.reason==="ACTIVE_TAB_CANNOT_BE_DISCARDED"?"Chrome does not allow discarding the active tab. Runner is parked; switch away before manually sleeping the tab.":"Runner is parked, but Chrome did not discard the bound tab.";
    this.state.diagnosticReport=report;this.state.lastError={code:"RETRIES_EXHAUSTED",message:report.sleepNote,at:now};
    this.audit("single-tab-task-retries-exhausted",{subtaskId:currentTask?.id||null,diagnostic:report.classification,sleep:report.sleep});
    await this.save();
    return {action:"sleep-and-diagnostic",subtaskId:currentTask?.id||null,diagnostic:clone(report)};
  }

}

