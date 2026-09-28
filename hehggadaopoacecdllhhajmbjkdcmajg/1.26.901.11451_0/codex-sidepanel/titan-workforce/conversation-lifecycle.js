const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
const now=()=>Date.now();
export const DEFAULT_CONVERSATION_THRESHOLDS=Object.freeze({
 maxAgeMs:7*24*3600000,
 maxCycles:8,
 maxContextCharacters:60000,
 maxFailures:3
});
function error(code,message,details={}){return Object.assign(new Error(message),{code,...details})}
function activeConversationSlot(slot){return slot&&["chat_worker","work_supervisor"].includes(slot.executionClass)}
function compactMission(m){
 if(!m)return null;
 return {
  id:m.id,title:m.title||"",goal:String(m.goal||"").slice(0,1600),status:m.status||null,
  priority:m.priority||null,repository:m.repository||m.repo||null,
  scopePaths:[...(m.scopePaths||m.scope_paths||[])].slice(0,30),
  acceptanceCriteria:[...(m.acceptanceCriteria||m.acceptance_criteria||[])].slice(0,20).map(x=>typeof x==="string"?x:{text:x?.text||"",done:x?.done===true})
 };
}
export function buildConversationContinuation(checkpoint){
 const m=checkpoint.mission,s=checkpoint.scheduler;
 return [
  "TITAN CONTINUATION CHECKPOINT",
  `Checkpoint: ${checkpoint.id}`,
  `Agent: ${checkpoint.agentId} (${checkpoint.executionClass})`,
  m?`Mission: ${m.id} — ${m.title}`:"Mission: none",
  m?`Status: ${m.status||"unknown"} · Priority: ${m.priority||"—"}`:"",
  m?.goal?`Goal: ${m.goal}`:"",
  checkpoint.profileIds?.length?`Profiles: ${checkpoint.profileIds.join(", ")}`:"",
  s?`Cycle/pass: ${s.cycleId||"—"} · pass ${s.currentPass||0}/5 · completed ${s.completedPasses||0}`:"",
  checkpoint.provenanceIds?.length?`Provenance refs: ${checkpoint.provenanceIds.join(", ")}`:"",
  checkpoint.sendKeys?.length?`Recent idempotency keys: ${checkpoint.sendKeys.join(", ")}`:"",
  "Continue from this checkpoint. Do not recreate prior business state or repeat completed work."
 ].filter(Boolean).join("\n").slice(0,6000);
}
export class TitanConversationLifecycle{
 constructor({
  state,registry,missionControl,provenance=null,conversationService=null,
  bindReplacement=null,audit=()=>{},save=async()=>true,clock=now,
  thresholds={}
 }={}){
  if(!state||!registry)throw new Error("Conversation lifecycle requires state and registry");
  this.state=state;this.registry=registry;this.missionControl=missionControl;this.provenance=provenance;
  this.conversationService=conversationService;this.bindReplacement=bindReplacement;this.audit=audit;this.save=save;this.clock=clock;
  this.thresholds={...DEFAULT_CONVERSATION_THRESHOLDS,...thresholds};
  state.conversationArchive=Array.isArray(state.conversationArchive)?state.conversationArchive:[];
  state.conversationCheckpoints=state.conversationCheckpoints&&typeof state.conversationCheckpoints==="object"?state.conversationCheckpoints:{};
 }
 metrics(agentId){
  const slot=this.registry.get(agentId);if(!activeConversationSlot(slot))throw error("CONVERSATION_SLOT_REQUIRED","Chat/Work conversation slot required",{agentId});
  const c=slot.conversation||{};
  return {
   ageMs:c.boundAt?Math.max(0,this.clock()-c.boundAt):0,
   cycles:Number(c.cyclesCompleted||0),
   contextCharacters:Number(c.contextCharacters||0),
   failures:Number(c.failures||0),
   rotationRequired:c.rotationRequired===true
  };
 }
 evaluate(agentId){
  const metrics=this.metrics(agentId),reasons=[],t=this.thresholds;
  if(metrics.rotationRequired)reasons.push("requested");
  if(metrics.ageMs>=t.maxAgeMs)reasons.push("age");
  if(metrics.cycles>=t.maxCycles)reasons.push("cycles");
  if(metrics.contextCharacters>=t.maxContextCharacters)reasons.push("context-size");
  if(metrics.failures>=t.maxFailures)reasons.push("failures");
  return {agentId,rotate:reasons.length>0,reasons,metrics,thresholds:clone(t)};
 }
 note(agentId,{contextCharacters=0,cycleCompleted=false,failure=false}={}){
  const slot=this.registry.get(agentId);if(!activeConversationSlot(slot)||!slot.conversation)return null;
  const c=slot.conversation;
  c.contextCharacters=Math.max(0,Number(c.contextCharacters||0)+Number(contextCharacters||0));
  if(cycleCompleted)c.cyclesCompleted=Math.max(0,Number(c.cyclesCompleted||0)+1);
  if(failure)c.failures=Math.max(0,Number(c.failures||0)+1);
  c.updatedAt=this.clock();return this.evaluate(agentId);
 }
 checkpoint(agentId){
  const slot=this.registry.get(agentId);if(!activeConversationSlot(slot))throw error("CONVERSATION_SLOT_REQUIRED","Chat/Work conversation slot required",{agentId});
  if(!slot.conversation)throw error("CONVERSATION_NOT_BOUND","Conversation is not bound",{agentId});
  const mission=slot.missionId?this.missionControl?.get?.(slot.missionId)||this.state.missions?.[slot.missionId]||null:null;
  const worker=this.state.chatScheduler?.workers?.[agentId]||null;
  const missionProv=slot.missionId
   ?(this.provenance?.forMission?.(slot.missionId)||Object.values(this.state.provenance||{}).filter(x=>x?.missionId===slot.missionId))
   :[];
  const checkpoint={
   id:`conversation-checkpoint:${agentId}:${this.clock()}`,
   at:this.clock(),agentId,executionClass:slot.executionClass,missionId:slot.missionId||null,
   mission:compactMission(mission),profileIds:[...(slot.profileIds||[])],
   scheduler:worker?{
    missionId:worker.missionId||null,cycleId:worker.cycleId||null,currentPass:Number(worker.currentPass||0),
    completedPasses:Array.isArray(worker.completedPasses)?worker.completedPasses.length:0,
    nextGateAt:worker.nextGateAt||null,state:worker.state||null
   }:null,
   provenanceIds:missionProv.slice(-30).map(x=>x.id).filter(Boolean),
   sendKeys:(this.state.sendLedger||[]).filter(x=>!slot.missionId||x.missionId===slot.missionId).slice(-30).map(x=>x.key).filter(Boolean),
   previousConversation:{key:slot.conversation.key||null,conversationId:slot.conversation.conversationId||null,tabId:slot.conversation.tabId||null,boundAt:slot.conversation.boundAt||null}
  };
  this.state.conversationCheckpoints[checkpoint.id]=clone(checkpoint);
  const ids=Object.keys(this.state.conversationCheckpoints);
  if(ids.length>200)for(const id of ids.slice(0,ids.length-200))delete this.state.conversationCheckpoints[id];
  this.audit("conversation-checkpoint-created",{agentId,missionId:slot.missionId||null,checkpointId:checkpoint.id});
  return checkpoint;
 }
 async assertIdle(agentId){
  const slot=this.registry.get(agentId);if(!slot?.conversation)return true;
  const service=this.conversationService;
  if(service?.observe){
   const observation=await service.observe(slot.conversation);
   if(observation?.generating)throw error("CONVERSATION_BUSY","Cannot rotate while a turn is generating",{agentId});
  }
  return true;
 }
 async rotate(agentId,{newConversation=null,createIfMissing=true,active=false}={}){
  const slot=this.registry.get(agentId);if(!activeConversationSlot(slot))throw error("CONVERSATION_SLOT_REQUIRED","Chat/Work conversation slot required",{agentId});
  if(!slot.conversation)throw error("CONVERSATION_NOT_BOUND","Conversation is not bound",{agentId});
  await this.assertIdle(agentId);
  const old=clone(slot.conversation),checkpoint=this.checkpoint(agentId),continuation=buildConversationContinuation(checkpoint);
  let next=newConversation;
  if(!next&&createIfMissing){
   if(typeof this.conversationService?.create!=="function")throw error("CONVERSATION_CREATE_UNAVAILABLE","Conversation service cannot create a fresh conversation",{agentId});
   next=await this.conversationService.create({initialInstruction:continuation,active});
  }
  if(!next?.key||!next?.tabId)throw error("CONVERSATION_IDENTITY_REQUIRED","Fresh conversation identity is required",{agentId});
  if(next.key===old.key)throw error("CONVERSATION_ROTATION_SAME_IDENTITY","Fresh conversation must have a different identity",{agentId});
  if(typeof this.bindReplacement!=="function")throw error("CONVERSATION_REBIND_UNAVAILABLE","Conversation replacement binding is unavailable",{agentId});
  await this.bindReplacement(agentId,next,{checkpoint});
  const archived={agentId,missionId:slot.missionId||null,checkpointId:checkpoint.id,conversation:old,archivedAt:this.clock()};
  this.state.conversationArchive.push(archived);this.state.conversationArchive=this.state.conversationArchive.slice(-500);
  const current=this.registry.get(agentId);
  current.conversation={...clone(next),boundAt:next.boundAt||this.clock(),rotatedFrom:old.key,checkpointId:checkpoint.id,cyclesCompleted:0,contextCharacters:continuation.length,failures:0,rotationRequired:false};
  current.updatedAt=this.clock();
  this.audit("conversation-rotated",{agentId,missionId:current.missionId||null,checkpointId:checkpoint.id,fromKey:old.key,toKey:next.key});
  await this.save();
  return {agentId,checkpoint:clone(checkpoint),conversation:clone(current.conversation),archived:clone(archived)};
 }
 status(agentId=null){
  if(agentId)return this.evaluate(agentId);
  return this.registry.list().filter(activeConversationSlot).map(slot=>this.evaluate(slot.id));
 }
}
