const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));

function schedulerCtor(){
 const guarded=globalThis.TitanChatFivePassIntegration?.GuardedChatFivePassScheduler;
 const base=globalThis.TitanChatFivePass?.ChatFivePassScheduler;
 return guarded||base||null;
}

function ensureRuntimeState(state){
 state.chatScheduler=state.chatScheduler||null;
 state.chatRuntime=state.chatRuntime&&typeof state.chatRuntime==="object"
   ?state.chatRuntime
   :{observations:{},lastTickAt:null,errors:[]};
 state.chatRuntime.observations=state.chatRuntime.observations||{};
 state.chatRuntime.errors=Array.isArray(state.chatRuntime.errors)?state.chatRuntime.errors:[];
 state.sendLedger=Array.isArray(state.sendLedger)?state.sendLedger:[];
 return state;
}

export class TitanLiveChatRuntime{
 constructor({state,integration,missionControl,services,usageGovernor=null,pipelineRuntime=null,audit=()=>{},save=async()=>{},pollMs=6000}={}){
  if(!state||!integration||!missionControl||!services)throw new Error("Live Chat runtime dependencies are required");
  this.state=ensureRuntimeState(state);
  this.integration=integration;
  this.missionControl=missionControl;
  this.services=services;
  this.usageGovernor=usageGovernor;
  this.pipelineRuntime=pipelineRuntime;
  this.audit=audit;
  this.save=save;
  this.pollMs=Math.max(1000,Number(pollMs||6000));
  this.timer=null;
  this.ticking=false;
  const Ctor=schedulerCtor();
  if(!Ctor)throw new Error("WP2 Chat scheduler package unavailable");
  const opts={
   emit:event=>this.onSchedulerEvent(event),
   advanceGuard:(worker,action)=>this.advanceGuard(worker,action)
  };
  this.scheduler=typeof Ctor.restore==="function"&&this.state.chatScheduler
    ?Ctor.restore(this.state.chatScheduler,opts)
    :new Ctor(opts);
  this.persistSnapshot();
 }

 persistSnapshot(){
  this.state.chatScheduler=this.scheduler.snapshot();
  this.state.chatRuntime.lastTickAt=Date.now();
  this.state.updatedAt=Date.now();
 }

 advanceGuard(worker){
  const mission=this.missionControl.get(worker.missionId);
  if(!mission)return{allowed:false,reason:"MISSION_NOT_FOUND"};
  if(["cancelled","superseded","blocked","complete","verified"].includes(mission.status)){
   return{allowed:false,reason:"MISSION_NOT_ACTIVE"};
  }
  const max=Number(mission.maxPasses||mission.budget?.maxPasses||15);
  const completed=Array.isArray(worker.completedPasses)?worker.completedPasses.length:0;
  if(Number.isFinite(max)&&completed>=max)return{allowed:false,reason:"MISSION_PASS_BUDGET_EXHAUSTED"};
  return{allowed:true};
 }

 syncWorkerSlot(workerId){
  const worker=this.scheduler.getWorker(workerId);
  const slot=this.integration.controller.registry.get(workerId);
  if(!slot)return;
  slot.status=String(worker.state||"idle").toLowerCase().replaceAll("_","-");
  slot.missionId=worker.missionId||slot.missionId||null;
  slot.health=worker.health||slot.health||"unknown";
  slot.updatedAt=Date.now();
 }

 async bindConversation(workerId,conversation){
  const slot=this.integration.controller.registry.get(workerId);
  if(!slot||slot.executionClass!=="chat_worker")throw new Error("Chat worker slot required");
  if(!conversation?.key||!conversation?.tabId)throw new Error("Bound conversation identity is required");
  const current=slot.conversation;
  if(current?.key&&current.key!==conversation.key)throw new Error("Conversation identity lock mismatch for "+workerId);
  slot.conversation=clone(conversation);
  this.scheduler.bindConversation(workerId,conversation.key);
  this.syncWorkerSlot(workerId);
  this.persistSnapshot();
  await this.save();
  this.audit("chat-conversation-bound",{workerId,key:conversation.key,tabId:conversation.tabId});
  return clone(slot);
 }

 async startCycle(workerId,{missionId,cycleId,queue}){
  const slot=this.integration.controller.registry.get(workerId);
  if(!slot||slot.executionClass!=="chat_worker")throw new Error("Chat worker slot required");
  const mission=this.missionControl.get(missionId);
  if(!mission)throw new Error("Unknown mission "+missionId);
  if(!slot.conversation?.key)throw new Error("Worker conversation is not bound");
  this.scheduler.bindConversation(workerId,slot.conversation.key);
  const worker=this.scheduler.startCycle(workerId,{missionId,cycleId,queue});
  this.missionControl.assign(missionId,workerId);
  const obs=await this.services.require("chat").observe(slot.conversation).catch(()=>null);
  this.state.chatRuntime.observations[workerId]={
   assistantCount:Number(obs?.assistantCount||0),
   dispatchBaseline:null,
   lastObservedAt:Date.now()
  };
  this.syncWorkerSlot(workerId);
  this.persistSnapshot();
  await this.save();
  this.audit("chat-cycle-started",{workerId,missionId,cycleId});
  return clone(worker);
 }

 async tickWorker(workerId,{allowDispatch=true}={}){
  const slot=this.integration.controller.registry.get(workerId);
  if(!slot||slot.executionClass!=="chat_worker"||!slot.conversation?.key)return null;
  const worker=this.scheduler.getWorker(workerId);
  if(!worker?.missionId)return null;
  const chat=this.services.require("chat");
  await chat.assertConversation?.(slot.conversation);
  const obs=await chat.observe(slot.conversation);
  const runtime=this.state.chatRuntime.observations[workerId]||{
   assistantCount:Number(obs?.assistantCount||0),
   dispatchBaseline:null
  };
  runtime.lastObservedAt=Date.now();

  const completedForCurrent=worker.completedPasses?.some(p=>p.passNumber===worker.currentPass);
  if(worker.currentPass>0&&!completedForCurrent&&!obs?.generating&&runtime.dispatchBaseline!=null&&Number(obs?.assistantCount||0)>runtime.dispatchBaseline){
   this.scheduler.completePass(workerId,{
    assistantCount:Number(obs.assistantCount),
    text:String(obs.lastText||"").slice(-12000)
   });
   const duration=worker.lastDispatchAt?Math.max(0,Date.now()-worker.lastDispatchAt):0;
   this.usageGovernor?.record?.("pass_duration",{missionId:worker.missionId,durationMs:duration});
   runtime.assistantCount=Number(obs.assistantCount||0);
   runtime.dispatchBaseline=null;
   this.state.chatRuntime.observations[workerId]=runtime;
   this.syncWorkerSlot(workerId);
   this.persistSnapshot();
   await this.save();
   return{action:"completed",workerId,passNumber:worker.currentPass};
  }

  const action=this.scheduler.inspectGate(workerId,{busy:!!obs?.generating});
  if(action.action==="dispatch"&&!allowDispatch)return{action:"held",reason:"USAGE_THROTTLE",workerId};
  if(action.action==="dispatch"){
   runtime.dispatchBaseline=Number(obs?.assistantCount||0);
   this.state.chatRuntime.observations[workerId]=runtime;
   await this.integration.dispatchChatPass(workerId,action);
   this.scheduler.confirmDispatch(workerId,action.key);
   this.usageGovernor?.record?.("chat_turn",{missionId:action.missionId});
   this.state.sendLedger.push({
    key:action.key,
    workerId,
    missionId:action.missionId,
    cycleId:action.cycleId,
    passNumber:action.passNumber,
    status:"sent",
    at:Date.now()
   });
   this.state.sendLedger=this.state.sendLedger.slice(-1000);
   this.syncWorkerSlot(workerId);
   this.persistSnapshot();
   await this.save();
   return{action:"dispatched",workerId,passNumber:action.passNumber,key:action.key};
  }
  if(["defer","blocked","paused"].includes(action.action)){
   this.syncWorkerSlot(workerId);
   this.persistSnapshot();
   await this.save();
  }
  this.state.chatRuntime.observations[workerId]=runtime;
  return action;
 }

 async tick(){
  if(this.ticking||!this.state.controls?.armed||this.state.controls?.emergencyStop)return;
  this.ticking=true;
  try{
   const chatSlots=this.integration.controller.registry.list("chat_worker");
   const usage=this.usageGovernor?.evaluate?.()||null;
   const slowdown=usage?.policy?.slowdown||"normal";
   for(const slot of chatSlots){try{this.scheduler.setSlowdown?.(slot.id,slowdown)}catch{}}
   const allowed=new Set(this.usageGovernor?.allowedChatSlots?.(chatSlots,this.state.missions||{})||chatSlots.map(x=>x.id));
   this.usageGovernor?.setConcurrency?.({chat:chatSlots.filter(x=>["busy","working","reviewing"].includes(String(x.status))).length});
   for(const slot of chatSlots){
    try{await this.tickWorker(slot.id,{allowDispatch:allowed.has(slot.id)})}
    catch(error){
     this.state.chatRuntime.errors.push({
      at:Date.now(),
      workerId:slot.id,
      message:String(error?.message||error),
      code:error?.code||null
     });
     this.state.chatRuntime.errors=this.state.chatRuntime.errors.slice(-100);
     slot.health="error";
     slot.status="blocked";
     slot.updatedAt=Date.now();
     this.audit("chat-runtime-error",{workerId:slot.id,message:String(error?.message||error),code:error?.code||null});
    }
   }
   this.persistSnapshot();
   await this.save();
  }finally{
   this.ticking=false;
  }
 }

 start(){
  if(this.timer)return;
  this.timer=setInterval(()=>this.tick().catch(()=>{}),this.pollMs);
  this.tick().catch(()=>{});
 }

 stop(){
  if(this.timer){
   clearInterval(this.timer);
   this.timer=null;
  }
 }

 async onSchedulerEvent(event){
  this.persistSnapshot();
  if(event?.type!=="supervisor_review_required")return;
  queueMicrotask(()=>this.routeSupervisorReview(event).catch(error=>{
   this.audit("supervisor-review-route-error",{workerId:event.workerId,message:String(error?.message||error)});
  }));
 }

 async routeSupervisorReview(event){
  const mission=this.missionControl.get(event.missionId);
  if(!mission)throw new Error("Mission not found for supervisor review");
  const pipeline=this.integration.pipelineApi||globalThis.TitanWorkCodexPipeline;
  if(!pipeline?.adaptChatSupervisorReviewEvent)throw new Error("WP3 chat review adapter unavailable");
  const request=pipeline.adaptChatSupervisorReviewEvent(
   event,
   this.integration.normalizePipelineMission(mission)
  );
  const squad=this.integration.squadForWorker(event.workerId);
  if(!squad)throw new Error("Chat worker has no squad");
  const supervisorId=squad==="A"?"SUPERVISOR_A":"SUPERVISOR_B";
  const supervisor=this.integration.controller.registry.get(supervisorId);
  if(!supervisor)throw new Error("Supervisor slot unavailable");
  supervisor.missionId=event.missionId;
  supervisor.status="reviewing";
  supervisor.updatedAt=Date.now();

  if(this.integration.profileApi){
   const cast=this.integration.castMission(event.missionId,supervisorId);
   request.profile_context=cast.compiled.text;
  }

  const result=this.pipelineRuntime
   ?await this.pipelineRuntime.handleSupervisorBoundary({event,request,supervisorId,squad})
   :await this.integration.requestWorkReview(squad,request);
  this.usageGovernor?.record?.("work_cycle",{missionId:event.missionId});
  this.audit("supervisor-review-requested",{
   workerId:event.workerId,
   supervisorId,
   missionId:event.missionId,
   cycleId:event.cycleId,
   profiles:supervisor.profileIds||[],
   executablePipeline:!!this.pipelineRuntime
  });
  this.persistSnapshot();
  await this.save();
  return result;
 }

 snapshot(){
  return{
   scheduler:this.scheduler.snapshot(),
   runtime:clone(this.state.chatRuntime)
  };
 }
}
