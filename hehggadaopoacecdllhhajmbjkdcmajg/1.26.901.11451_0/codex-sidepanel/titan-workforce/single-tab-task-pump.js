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
    this.state={...initialSingleTabTaskState(),conversation:clone(conversation),intervalMinutes:interval,phase:"watching"};
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
      this.state.nextRunAt=now+this.state.intervalMinutes*60000;
      if(observation?.generating){await this.save();return {action:"waiting",reason:"CONVERSATION_BUSY"}}
      let action={action:"checked",phase:this.state.phase};
      if(this.state.phase==="awaiting_plan")action=this.acceptPlan(observation,now);
      else if(this.state.phase==="awaiting_subtask")action=this.acceptSubtaskResult(observation,now);
      else if(this.state.phase==="waiting_delivery"&&now>=Number(this.state.nextDeliveryAt||0))action=await this.dispatchNext(observation,now);
      else if(this.state.phase==="watching")action=await this.detectTask(observation,now);
      this.state.lastError=null;
      await this.save();
      return action;
    }catch(error){
      this.state.lastError={code:error?.code||"TASK_PUMP_ERROR",message:String(error?.message||error),at:now};
      this.state.nextRunAt=now+this.state.intervalMinutes*60000;
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
      "Break my latest task into exactly 10 ordered, independently verifiable subtasks.",
      "Do not execute any subtask yet. Keep scope focused on the task I just gave you.",
      "Return only a JSON object: {\"type\":\"titan_task_batch\",\"subtasks\":[{\"id\":\"S1\",\"title\":\"...\",\"instruction\":\"...\",\"done_when\":\"...\"}]}.",
      "Include exactly 10 subtasks. Each instruction must be concrete and sized for one work interval."
    ].join("\n");
    await this.conversationService.send({conversation:this.state.conversation,instruction:prompt,idempotencyKey:`${key}/plan`});
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
    const task=this.state.subtasks[this.state.currentIndex];
    if(!task){this.state.phase="watching";this.state.sourceUserFingerprint=fingerprint(this.state.missionText);return {action:"batch-complete"}}
    if(observation?.generating)return {action:"waiting",reason:"CONVERSATION_BUSY"};
    const number=this.state.currentIndex+1;
    const prompt=[
      `TITAN SINGLE-TAB SUBTASK ${number}/10`,
      `ID: ${task.id}`,
      `TITLE: ${task.title}`,
      `TASK: ${task.instruction}`,
      `DONE WHEN: ${task.doneWhen}`,
      "Work only on this subtask in the current repository/conversation context. Do not start another subtask.",
      "At the end, report what changed, evidence/checks, whether the done condition is met, and any blocker."
    ].join("\n");
    task.status="in_progress";task.dispatchedAt=now;
    this.state.baselineAssistantCount=Number(observation?.assistantCount||0);
    this.state.phase="awaiting_subtask";
    this.state.pendingSubtaskId=task.id;
    this.state.lastActionAt=now;
    const key=`${this.state.sourceUserFingerprint}/${task.id}`;
    await this.save();
    try{
      await this.conversationService.send({conversation:this.state.conversation,instruction:prompt,idempotencyKey:key});
    }catch(error){
      // A failed send can be ambiguous: the page may have accepted it before
      // the bridge failed. Stop for review instead of risking a duplicate.
      task.status="send_uncertain";
      this.state.enabled=false;
      this.state.phase="send_uncertain";
      this.state.nextRunAt=null;
      this.state.lastError={code:error?.code||"SEND_UNCERTAIN",message:String(error?.message||error),at:now,subtaskId:task.id};
      await this.save();
      this.audit("single-tab-subtask-send-uncertain",{subtaskId:task.id,conversationKey:this.state.conversation.key});
      return {action:"paused-for-review",reason:"SEND_UNCERTAIN",subtaskId:task.id};
    }
    this.state.lastSeenUserFingerprint=fingerprint(prompt);
    this.audit("single-tab-subtask-dispatched",{subtaskId:task.id,number,conversationKey:this.state.conversation.key,idempotencyKey:key});
    return {action:"subtask-dispatched",subtaskId:task.id,number};
  }
  acceptSubtaskResult(observation,now){
    if(Number(observation?.assistantCount||0)<=this.state.baselineAssistantCount||!String(observation?.lastText||"").trim())return {action:"waiting",reason:"SUBTASK_NOT_READY"};
    const task=this.state.subtasks[this.state.currentIndex];
    if(!task)return {action:"error",reason:"CURRENT_SUBTASK_MISSING"};
    task.status="complete";task.result=String(observation.lastText||"").slice(-SINGLE_TAB_TASK_DEFAULTS.maxResultCharacters);task.completedAt=now;
    this.state.currentIndex+=1;this.state.pendingSubtaskId=null;this.state.baselineAssistantCount=Number(observation.assistantCount||0);
    if(this.state.currentIndex>=this.state.subtasks.length){
      this.state.history.push({taskFingerprint:this.state.sourceUserFingerprint,missionText:this.state.missionText,completedAt:now,subtasks:this.state.subtasks});
      this.state.history=this.state.history.slice(-20);this.state.phase="watching";
      this.audit("single-tab-task-batch-completed",{count:this.state.subtasks.length});
      return {action:"batch-complete",completed:task.id};
    }
    this.state.phase="waiting_delivery";this.state.nextDeliveryAt=now+this.state.intervalMinutes*60000;
    this.audit("single-tab-subtask-completed",{subtaskId:task.id,nextIndex:this.state.currentIndex+1,nextDeliveryAt:this.state.nextDeliveryAt});
    return {action:"subtask-completed",subtaskId:task.id,nextIndex:this.state.currentIndex+1,nextDeliveryAt:this.state.nextDeliveryAt};
  }
}
