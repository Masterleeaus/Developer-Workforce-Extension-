import {capabilitiesForExecutionContext} from "./execution-capabilities.js";
import {SQUADS} from "./constants.js";
import {durableActionKey} from "./durability.js";
import {TitanProvenanceGraph,createProvenanceNode} from "./provenance.js";

const ROOT="../../../";
const getGlobal=name=>globalThis[name]||null;
const clone=x=>x==null?x:JSON.parse(JSON.stringify(x));
const PRE_SIDE_EFFECT_CODES=new Set(["USAGE_THROTTLE","CODEX_CONCURRENCY_LIMIT","AGENT_EMERGENCY_STOPPED","AGENT_QUARANTINED","AGENT_PAUSED","SCOPE_APPROVAL_PENDING","SCOPE_LOCK_VIOLATION","CAPABILITY_UNAVAILABLE","CAPABILITY_DENIED","APPROVAL_REQUIRED","CREDENTIAL_APPROVAL_REQUIRED","CONVERSATION_IDENTITY_MISMATCH","CONVERSATION_BUSY"]);
function requireAvailableSlot(slot){
 if(!slot)throw new Error("Agent slot unavailable");
 const c=slot.control||{};
 const reason=c.emergencyStopped?"AGENT_EMERGENCY_STOPPED":c.quarantined?"AGENT_QUARANTINED":c.paused?"AGENT_PAUSED":null;
 if(reason){const e=new Error(reason+" "+slot.id);e.code=reason;throw e}
 return slot;
}

export class TitanWorkforceIntegration{
 constructor({state,controller,missionControl,services,capabilities=null,repositoryIntelligence=null,architectureIndex=null,usageGovernor=null,sendLedger=null,save=async()=>{},audit=()=>{}}){
  this.state=state;this.controller=controller;this.missionControl=missionControl;this.services=services;this.capabilities=capabilities;this.repositoryIntelligence=repositoryIntelligence;this.architectureIndex=architectureIndex;this.usageGovernor=usageGovernor;this.sendLedger=sendLedger;this.save=save;this.audit=audit;
  this.provenance=new TitanProvenanceGraph(state);
  this.chatScheduler=null;this.profileApi=null;this.pipelineApi=null;
 }
 bindGlobals(){
  this.profileApi=getGlobal("TitanAgentProfiles");
  this.chatScheduler=getGlobal("TitanChatFivePass")||getGlobal("TitanChatFivePassIntegration");
  this.pipelineApi=getGlobal("TitanWorkCodexPipeline");
  return this.readiness();
 }
 readiness(){
  return {profiles:!!this.profileApi,chat:!!this.chatScheduler,pipeline:!!this.pipelineApi,services:this.services?.status?.()||{}};
 }
 async durableExecute({key,kind,missionId=null,agentId=null,metadata={}},fn){
  if(!this.sendLedger)return fn();
  this.sendLedger.assertNew({key,kind,missionId,agentId,metadata});
  await this.save();
  try{
   const result=await fn();
   this.sendLedger.markSent(key,{resultObserved:true});
   await this.save();
   this.sendLedger.complete(key,{resultObserved:true});
   await this.save();
   return result;
  }catch(error){
   const entry=this.sendLedger.get(key);
   if(entry?.status==="claimed"&&PRE_SIDE_EFFECT_CODES.has(error?.code))this.sendLedger.fail(key,error);
   else if(entry?.status==="claimed"||entry?.status==="sent")this.sendLedger.markRecoveryRequired(key,error);
   await this.save();
   throw error;
  }
 }
 castMission(missionId,slotId,{transfer=false,source="profile-cast"}={}){
  const mission=this.missionControl.get(missionId);if(!mission)throw new Error("Unknown mission "+missionId);
  if(!this.profileApi)throw new Error("Profile package unavailable");
  const slot=this.controller.registry.get(slotId);if(!slot)throw new Error("Unknown slot "+slotId);
  const cast=this.profileApi.selectProfilesForMission(mission,{executionClass:slot.executionClass});
  const compiled=this.profileApi.compileProfileContext(cast,{executionClass:slot.executionClass});
  this.controller.assignMission(missionId,slotId,{profileIds:compiled.profileIds,expectedExecutionClass:slot.executionClass,transfer,source});
  this.audit("mission-cast",{missionId,slotId,profiles:compiled.profileIds,transfer,source});
  return {mission:clone(mission),slot:clone(this.controller.registry.get(slotId)),cast,compiled};
 }
 squadForWorker(workerId){if(SQUADS.A.includes(workerId))return"A";if(SQUADS.B.includes(workerId))return"B";return null}
 recordArtifact({id,type,missionId,parentIds=[],agentId=null,artifactId=null,metadata={}}){
  return this.provenance.add(createProvenanceNode({id,type,missionId,parentIds,agentId,artifactId,metadata}));
 }
 normalizePipelineMission(m){
  return {id:m.id,title:m.title,goal:m.goal,repository:m.repository,scope_paths:m.scopePaths||[],constraints:m.constraints||[],acceptance_criteria:m.acceptanceCriteria||[],runtime_requirements:m.verificationRequirements||[],dependencies:m.dependencies||[]};
 }
 contextForMission(missionId,{commit=null,changedPaths=[],maxFiles=12}={}){
  const mission=this.missionControl.get(missionId);if(!mission)throw new Error("Unknown mission "+missionId);
  const architecture=this.architectureIndex?.compile?.(mission)||null;
  let repository=null,impact=null;
  if(this.repositoryIntelligence){
   try{repository=this.repositoryIntelligence.query(mission,{commit,maxFiles})}catch{}
   if(repository&&changedPaths.length){try{impact=this.repositoryIntelligence.impact(repository.repository,repository.commit,changedPaths)}catch{}}
  }
  const out={missionId,architecture,repository,impact};
  this.audit("mission-context-compiled",{missionId,architectureEntries:architecture?.entryIds||[],repositoryFiles:repository?.files?.map(x=>x.path)||[],changedPaths});
  return out;
 }

 async dispatchChatPass(workerId,action){
  const slot=this.controller.registry.get(workerId);if(!slot||slot.executionClass!=="chat_worker")throw new Error("Chat slot required");requireAvailableSlot(slot);
  const service=this.services.require("chat");
  if(slot.conversation?.identity&&service.assertConversation)await service.assertConversation(slot.conversation.identity);
  const result=await service.send({workerId,conversation:slot.conversation,instruction:action.instruction,idempotencyKey:action.key});
  this.audit("chat-pass-sent",{workerId,missionId:slot.missionId,key:action.key});return result;
 }
 async requestWorkReview(squad,payload){
  const id=squad==="A"?"SUPERVISOR_A":"SUPERVISOR_B",slot=this.controller.registry.get(id),service=this.services.require("work");requireAvailableSlot(slot);
  const missionId=payload?.missionId||payload?.mission?.id||slot.missionId||null;
  const cycleId=payload?.chat_cycle?.cycle_id||payload?.cycle_id||payload?.cycleId||"";
  const reviewId=payload?.reviewId||payload?.review_id||"";
  const key=durableActionKey("work-review",missionId,cycleId,id,reviewId);
  this.audit("supervisor-review-requested",{missionId,supervisorId:id,reviewId:reviewId||null});
  return this.durableExecute({key,kind:"work-review",missionId,agentId:id,metadata:{squad,cycleId,reviewId}},()=>service.review({supervisorId:id,conversation:slot.conversation,payload}));
 }
 allowedCapabilitiesForSlot(slot){
  const profileCaps=[];
  if(this.profileApi&&Array.isArray(slot?.profileIds)){
   for(const id of slot.profileIds){
    const profile=this.profileApi.getProfile?.(id);
    if(Array.isArray(profile?.allowedCapabilities))profileCaps.push(...profile.allowedCapabilities);
   }
  }
  return capabilitiesForExecutionContext({executionClass:slot?.executionClass,profileCapabilities:profileCaps});
 }
 async dispatchCodexPacket(builderId,packet,context={}){
  const slot=this.controller.registry.get(builderId);if(!slot||slot.executionClass!=="codex_builder")throw new Error("Codex builder required");requireAvailableSlot(slot);
  const missionId=packet?.mission?.id||packet?.mission_id||slot.missionId||null;
  const key=durableActionKey("codex-build",missionId,builderId,packet?.packet_id||packet?.packetId||packet?.id||"");
  return this.durableExecute({key,kind:"codex-build",missionId,agentId:builderId,metadata:{packetId:packet?.packet_id||packet?.packetId||packet?.id||null}},async()=>{
  const admission=this.usageGovernor?.allowCodex?.({mission:this.missionControl.get(missionId)})||{allowed:true};
  if(!admission.allowed){const e=new Error(admission.reason||"Codex usage throttled");e.code=admission.reason||"USAGE_THROTTLE";throw e}
  const current=this.state.usageGovernor?.metrics?.activeCodex||0;this.usageGovernor?.setConcurrency?.({codex:current+1});
  try{
   this.audit("builder-assigned",{missionId,builderId,agentId:builderId,deltaId:packet?.delta_id||packet?.deltaId||null});
   let result;
   if(this.capabilities?.has?.("codex.build")){
    const allowed=this.allowedCapabilitiesForSlot(slot);
    result=await this.capabilities.call("codex.build",{builderId,packet},{...context,executionClass:slot.executionClass,profileIds:slot.profileIds||[],...(allowed?{allowedCapabilities:allowed}:{})});
   }else result=await this.services.require("codex").build({builderId,packet});
   this.usageGovernor?.record?.("codex_turn",{missionId});
   this.audit("codex-completed",{missionId,builderId,agentId:builderId,status:"success",artifactId:result?.artifactId||result?.artifact_id||null,commit:result?.commit||result?.commitSha||result?.sha||null});
   return result;
  }catch(error){
   this.audit("tool-call-failed",{missionId,builderId,agentId:builderId,tool:"codex.build",code:error?.code||null});
   throw error;
  }finally{this.usageGovernor?.setConcurrency?.({codex:Math.max(0,(this.state.usageGovernor?.metrics?.activeCodex||1)-1)})}
  });
 }
 async orchestrate(bundle,context={}){
  const slot=this.controller.registry.get("ORCHESTRATOR"),missionId=bundle?.mission?.id||bundle?.mission_id||slot?.missionId||null;requireAvailableSlot(slot);
  const fingerprint=(bundle?.builder_results||bundle?.builderResults||[]).map(x=>x?.result_id||x?.resultId||"").join(",");
  const key=durableActionKey("codex-orchestrate",missionId,bundle?.bundle_id||bundle?.bundleId||fingerprint);
  return this.durableExecute({key,kind:"codex-orchestrate",missionId,agentId:slot.id},async()=>{
  const admission=this.usageGovernor?.allowCodex?.({mission:this.missionControl.get(missionId)})||{allowed:true};
  if(!admission.allowed){const e=new Error(admission.reason||"Codex usage throttled");e.code=admission.reason||"USAGE_THROTTLE";throw e}
  const current=this.state.usageGovernor?.metrics?.activeCodex||0;this.usageGovernor?.setConcurrency?.({codex:current+1});
  try{
   let result;
   if(this.capabilities?.has?.("codex.orchestrate")){
    const allowed=this.allowedCapabilitiesForSlot(slot);
    result=await this.capabilities.call("codex.orchestrate",{orchestratorId:slot.id,bundle},{...context,executionClass:slot.executionClass,profileIds:slot.profileIds||[],...(allowed?{allowedCapabilities:allowed}:{})});
   }else result=await this.services.require("codex").orchestrate({orchestratorId:slot.id,bundle});
   this.usageGovernor?.record?.("codex_turn",{missionId});
   this.audit("orchestrator-decision",{missionId,agentId:slot.id,decision:result?.decision||result?.route||null,status:result?.status||null});
   return result;
  }catch(error){
   this.audit("tool-call-failed",{missionId,agentId:slot.id,tool:"codex.orchestrate",code:error?.code||null});
   throw error;
  }finally{this.usageGovernor?.setConcurrency?.({codex:Math.max(0,(this.state.usageGovernor?.metrics?.activeCodex||1)-1)})}
  });
 }
}
