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
   :{observations:{},lastTickAt:null,errors:[],pendingReviews:{},cycleReviews:{},approvedDeltas:{},redirects:{}};
 state.chatRuntime.observations=state.chatRuntime.observations||{};
 state.chatRuntime.pendingReviews=state.chatRuntime.pendingReviews||{};
 state.chatRuntime.cycleReviews=state.chatRuntime.cycleReviews||{};
 state.chatRuntime.approvedDeltas=state.chatRuntime.approvedDeltas||{};
 state.chatRuntime.redirects=state.chatRuntime.redirects||{};
 state.chatRuntime.errors=Array.isArray(state.chatRuntime.errors)?state.chatRuntime.errors:[];
 state.sendLedger=Array.isArray(state.sendLedger)?state.sendLedger:[];
 return state;
}

export class TitanLiveChatRuntime{
 constructor({state,integration,missionControl,services,usageGovernor=null,audit=()=>{},save=async()=>{},pollMs=6000,eventTarget=globalThis}={}){
  if(!state||!integration||!missionControl||!services)throw new Error("Live Chat runtime dependencies are required");
  this.state=ensureRuntimeState(state);
  this.integration=integration;
  this.missionControl=missionControl;
  this.services=services;
  this.usageGovernor=usageGovernor;
  this.audit=audit;
  this.save=save;
  this.eventTarget=eventTarget;
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
  const mission=worker.missionId?this.missionControl.get(worker.missionId):null;
  if(!worker.missionId)slot.missionId=null;
  else if(!mission?.assignedAgent||mission.assignedAgent===workerId)slot.missionId=worker.missionId;
  else if(slot.missionId===worker.missionId)slot.missionId=null;
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
  if(!Array.isArray(queue)||queue.length!==5||queue.some(x=>typeof x!=="string"||!x.trim()))throw new Error("five-pass queue must contain exactly 5 instructions");
  const priorOwner=mission.assignedAgent||null;
  const priorSlot=priorOwner?this.integration.controller.registry.get(priorOwner):null;
  const priorProfileIds=priorSlot?.profileIds?[...priorSlot.profileIds]:[];
  this.missionControl.assign(missionId,workerId,{transfer:true,expectedExecutionClass:"chat_worker",profileIds:[...(slot.profileIds||[])],source:"chat-cycle-start"});
  this.scheduler.bindConversation(workerId,slot.conversation.key);
  let worker;
  try{
   worker=this.scheduler.startCycle(workerId,{missionId,cycleId,queue});
  }catch(error){
   if(priorOwner)this.missionControl.assign(missionId,priorOwner,{transfer:true,expectedExecutionClass:priorSlot?.executionClass||null,profileIds:priorProfileIds,source:"chat-cycle-rollback"});
   else this.missionControl.clearAssignment?.(missionId,"chat-cycle-start-failed");
   throw error;
  }
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

  if(this.integration.profileApi){
   const cast=this.integration.castMission(event.missionId,supervisorId,{transfer:true,source:"work-review"});
   request.profile_context=cast.compiled.text;
  }else{
   this.integration.controller.assignMission(event.missionId,supervisorId,{transfer:true,expectedExecutionClass:"work_supervisor",source:"work-review"});
  }
  supervisor.status="reviewing";
  supervisor.updatedAt=Date.now();

  const pendingId=request.review_id||request.reviewId||[event.missionId,event.cycleId,event.workerId,"review"].join(":");
  this.state.chatRuntime.pendingReviews[pendingId]={
   id:pendingId,
   workerId:event.workerId,
   supervisorId,
   missionId:event.missionId,
   cycleId:event.cycleId,
   request:clone(request),
   event:clone(event),
   status:"dispatching",
   createdAt:Date.now(),
   updatedAt:Date.now()
  };
  this.persistSnapshot();
  await this.save();

  const result=await this.integration.requestWorkReview(squad,request);
  this.usageGovernor?.record?.("work_cycle",{missionId:event.missionId});
  this.audit("supervisor-review-requested",{
   workerId:event.workerId,
   supervisorId,
   missionId:event.missionId,
   cycleId:event.cycleId,
   reviewId:pendingId,
   profiles:supervisor.profileIds||[]
  });

  const pending=this.state.chatRuntime.pendingReviews[pendingId];
  if(pending){
   pending.status="awaiting-result";
   pending.updatedAt=Date.now();
   pending.dispatchResult=clone(result);
  }
  const structured=this.extractCycleReview(result);
  if(structured){
   const consumed=await this.consumeCycleReview(result,{event,workerId:event.workerId,pendingId});
   return {reviewResult:result,consumed};
  }
  this.persistSnapshot();
  await this.save();
  return result;
 }

 extractCycleReview(value){
  const pipeline=this.integration.pipelineApi||globalThis.TitanWorkCodexPipeline;
  if(!value)return null;
  const candidates=[value,value.cycleReview,value.cycle_review,value.review,value.parsed,value.result];
  for(const candidate of candidates){
   if(!candidate)continue;
   let raw=candidate;
   if(typeof raw==="string"){
    const text=raw.trim();
    try{raw=JSON.parse(text)}catch{
     const fenced=text.match(/\x60\x60\x60(?:json)?\s*([\s\S]*?)\x60\x60\x60/i);
     if(fenced)try{raw=JSON.parse(fenced[1].trim())}catch{continue}
     else continue;
    }
   }
   if(raw&&typeof raw==="object"&&(raw.next_decision||raw.nextDecision)){
    if(raw.schema_version===1&&raw.review_id&&raw.mission)return clone(raw);
    if(!pipeline?.createCycleReview)return clone(raw);
    try{return pipeline.createCycleReview(raw)}catch{return clone(raw)}
   }
  }
  return null;
 }

 reviewQueueFrom(raw){
  const q=raw?.next_queue||raw?.nextQueue||raw?.next_instructions||raw?.nextInstructions||raw?.instructions||raw?.queue||null;
  return Array.isArray(q)&&q.length===5&&q.every(x=>typeof x==="string"&&x.trim())?q.map(String):null;
 }

 nextCycleId(workerId,missionId){
  const worker=this.scheduler.getWorker(workerId),current=String(worker?.cycleId||"cycle-0");
  const m=current.match(/^(.*?)(\d+)$/);
  if(m)return m[1]+String(Number(m[2])+1);
  return missionId+":cycle:"+Date.now();
 }

 emit(type,detail){
  try{
   if(typeof this.eventTarget?.dispatchEvent==="function"&&typeof CustomEvent==="function"){
    this.eventTarget.dispatchEvent(new CustomEvent(type,{detail:clone(detail)}));
   }
  }catch{}
 }

 async consumeCycleReview(raw,{event=null,workerId=null,pendingId=null}={}){
  const pipeline=this.integration.pipelineApi||globalThis.TitanWorkCodexPipeline;
  if(!pipeline?.createCycleReview||!pipeline?.nextResearchEpoch)throw new Error("WP3 CycleReview API unavailable");
  const source=this.extractCycleReview(raw)||raw;
  const missionId=source?.mission?.id||source?.mission_id||event?.missionId||this.scheduler.getWorker(workerId||event?.workerId)?.missionId;
  if(!missionId)throw new Error("CycleReview mission id is required");
  const mission=this.missionControl.get(missionId);
  if(!mission)throw new Error("Unknown mission "+missionId);
  const targetWorker=workerId||source.worker||event?.workerId;
  if(!targetWorker)throw new Error("CycleReview worker is required");
  const squad=this.integration.squadForWorker(targetWorker);
  const completed=Number(source.passes_completed||source.passesCompleted||5);
  const normalized=source.schema_version===1&&source.review_id
   ?clone(source)
   :pipeline.createCycleReview({
     ...source,
     mission:this.integration.normalizePipelineMission(mission),
     worker:targetWorker,
     squad:squad||source.squad,
     cycle:Number(source.cycle||1),
     passes_completed:completed
    });
  const route=pipeline.nextResearchEpoch(normalized);
  const list=this.state.chatRuntime.cycleReviews[missionId]||(this.state.chatRuntime.cycleReviews[missionId]=[]);
  if(!list.some(x=>x.review_id===normalized.review_id))list.push(clone(normalized));
  this.state.chatRuntime.cycleReviews[missionId]=list.slice(-10);
  if(pendingId&&this.state.chatRuntime.pendingReviews[pendingId]){
   this.state.chatRuntime.pendingReviews[pendingId].status="consumed";
   this.state.chatRuntime.pendingReviews[pendingId].reviewId=normalized.review_id;
   this.state.chatRuntime.pendingReviews[pendingId].updatedAt=Date.now();
  }
  const supervisorId=squad==="A"?"SUPERVISOR_A":"SUPERVISOR_B";
  const supervisor=this.integration.controller.registry.get(supervisorId);
  if(supervisor){supervisor.status="ready";supervisor.updatedAt=Date.now()}

  if(route.action==="research"){
   const queue=this.reviewQueueFrom(raw);
   if(!queue){
    this.missionControl.transition(missionId,"blocked","CONTINUE_5 review did not provide a five-instruction queue");
    this.audit("cycle-review-blocked",{missionId,workerId:targetWorker,reviewId:normalized.review_id,reason:"NEXT_QUEUE_REQUIRED"});
    this.persistSnapshot();await this.save();
    return {action:"blocked",reason:"NEXT_QUEUE_REQUIRED",review:normalized};
   }
   const nextCycleId=this.nextCycleId(targetWorker,missionId);
   await this.startCycle(targetWorker,{missionId,cycleId:nextCycleId,queue});
   this.missionControl.transition(missionId,"research","Supervisor requested next five-pass cycle");
   this.audit("cycle-review-continue",{missionId,workerId:targetWorker,reviewId:normalized.review_id,nextCycleId});
   this.emit("titan-workforce:chat-cycle-continued",{missionId,workerId:targetWorker,review:normalized,nextCycleId});
   return {action:"continue-5",review:normalized,nextCycleId};
  }

  if(route.action==="compile-delta"){
   const scopePaths=raw?.scope_paths||raw?.scopePaths||mission.scopePaths||[];
   if(!Array.isArray(scopePaths)||!scopePaths.length){
    this.missionControl.transition(missionId,"blocked","READY_FOR_CODEX review has no bounded scope");
    this.persistSnapshot();await this.save();
    return {action:"blocked",reason:"DELTA_SCOPE_REQUIRED",review:normalized};
   }
   const delta=pipeline.compileApprovedImplementationDelta({
    mission:this.integration.normalizePipelineMission(mission),
    cycle_reviews:[normalized],
    validated_findings:normalized.approved_findings||[],
    required_changes:raw?.required_changes||raw?.requiredChanges||normalized.approved_findings||[],
    scope_paths:scopePaths,
    expected_files:raw?.expected_files||raw?.expectedFiles||[],
    expected_symbols:raw?.expected_symbols||raw?.expectedSymbols||[],
    dependencies:normalized.dependencies||[],
    tests:mission.testPlan||[],
    acceptance_criteria:mission.acceptanceCriteria||[],
    runtime_verification:mission.runtimeRequirements||mission.verificationRequirements||[]
   });
   this.state.chatRuntime.approvedDeltas[missionId]=clone(delta);
   this.missionControl.transition(missionId,"ready-for-codex","Supervisor approved implementation delta");
   this.audit("cycle-review-ready-for-codex",{missionId,workerId:targetWorker,reviewId:normalized.review_id,deltaId:delta.delta_id});
   this.emit("titan-workforce:approved-delta",{missionId,workerId:targetWorker,review:normalized,delta});
   this.persistSnapshot();await this.save();
   return {action:"ready-for-codex",review:normalized,delta};
  }

  if(route.action==="redirect"){
   const redirect=clone(route.redirect||{});
   this.state.chatRuntime.redirects[missionId]={reviewId:normalized.review_id,redirect,at:Date.now()};
   this.missionControl.transition(missionId,"redirected","Supervisor redirected research");
   this.audit("cycle-review-redirect",{missionId,workerId:targetWorker,reviewId:normalized.review_id,redirect});
   this.emit("titan-workforce:research-redirect",{missionId,workerId:targetWorker,review:normalized,redirect});
   this.persistSnapshot();await this.save();
   return {action:"redirect",review:normalized,redirect};
  }

  const blocker=clone(route.blocker||normalized.blocker||{});
  this.missionControl.transition(missionId,"blocked",blocker.reason||blocker.message||"Supervisor blocked mission");
  this.audit("cycle-review-blocked",{missionId,workerId:targetWorker,reviewId:normalized.review_id,blocker});
  this.emit("titan-workforce:mission-blocked",{missionId,workerId:targetWorker,review:normalized,blocker});
  this.persistSnapshot();await this.save();
  return {action:"blocked",review:normalized,blocker};
 }

 async submitCycleReview(payload={}){
  const pendingId=payload.pendingReviewId||payload.pending_id||payload.review_id||payload.reviewId||null;
  let pending=pendingId?this.state.chatRuntime.pendingReviews[pendingId]:null;
  if(!pending&&payload.missionId){
   pending=Object.values(this.state.chatRuntime.pendingReviews).find(x=>x.missionId===payload.missionId&&x.status==="awaiting-result")||null;
  }
  const event=payload.event||pending?.event||null;
  const workerId=payload.workerId||pending?.workerId||payload.review?.worker||payload.worker||null;
  const review=payload.review||payload.cycleReview||payload.cycle_review||payload;
  return this.consumeCycleReview(review,{event,workerId,pendingId:pending?.id||pendingId});
 }

 snapshot(){
  return{
   scheduler:this.scheduler.snapshot(),
   runtime:clone(this.state.chatRuntime)
  };
 }
}
