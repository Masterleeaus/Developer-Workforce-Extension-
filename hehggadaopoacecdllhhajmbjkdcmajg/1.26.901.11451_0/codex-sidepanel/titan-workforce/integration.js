import {SQUADS} from "./constants.js";
import {canonicalSlotId,canonicalSupervisorForSquad,canonicalizePipelineSlot} from "./slot-id-adapter.js";
import {TitanProvenanceGraph,createProvenanceNode} from "./provenance.js";

const ROOT="../../../";
const getGlobal=name=>globalThis[name]||null;
const clone=x=>x==null?x:JSON.parse(JSON.stringify(x));
const MAX_PROFILE_CONTEXT_CHARS=12000;

function profileError(code,message,details={}){
 const e=new Error(message);e.code=code;Object.assign(e,details);return e;
}

export class TitanWorkforceIntegration{
 constructor({state,controller,missionControl,services,audit=()=>{}}){
  this.state=state;this.controller=controller;this.missionControl=missionControl;this.services=services;this.audit=audit;
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
 compileProfileForSlot(slotId,{mission=null}={}){
  if(!this.profileApi)throw profileError("PROFILE_API_UNAVAILABLE","Profile package unavailable");
  const canonical=canonicalSlotId(slotId),slot=this.controller.registry.get(canonical);
  if(!slot)throw profileError("UNKNOWN_PROFILE_SLOT","Unknown slot "+canonical,{slotId:canonical});
  let compiled,source;
  const stored=Array.isArray(slot.profileIds)?slot.profileIds.filter(Boolean):[];
  if(stored.length){
   for(const id of stored){
    const verdict=this.profileApi.validateExecutionClass(id,slot.executionClass);
    if(!verdict?.ok)throw profileError("PROFILE_EXECUTION_CLASS_MISMATCH","Profile "+id+" is incompatible with "+slot.executionClass,{slotId:canonical,profileId:id,executionClass:slot.executionClass});
   }
   const composition=this.profileApi.composeProfiles(stored[0],stored.slice(1),{executionClass:slot.executionClass});
   compiled=this.profileApi.compileProfileContext(composition,{executionClass:slot.executionClass});
   source="slot";
  }else if(mission){
   const cast=this.profileApi.selectProfilesForMission(mission,{executionClass:slot.executionClass});
   compiled=this.profileApi.compileProfileContext(cast,{executionClass:slot.executionClass});
   source="mission";
  }else{
   return null;
  }
  if(!compiled?.text||!Array.isArray(compiled.profileIds))throw profileError("PROFILE_CONTEXT_INVALID","Compiled profile context is invalid",{slotId:canonical});
  if(compiled.text.length>MAX_PROFILE_CONTEXT_CHARS)throw profileError("PROFILE_CONTEXT_TOO_LARGE","Compiled profile context exceeds bounded limit",{slotId:canonical,length:compiled.text.length,max:MAX_PROFILE_CONTEXT_CHARS});
  const context=Object.freeze({
   profile_ids:Object.freeze([...compiled.profileIds]),
   execution_class:slot.executionClass,
   primary_profile:compiled.primary,
   secondary_profiles:Object.freeze([...(compiled.secondary||[])]),
   source,
   text:compiled.text
  });
  this.audit("profile-context-compiled",{slotId:canonical,missionId:mission?.id||slot.missionId||null,profileIds:[...context.profile_ids],executionClass:slot.executionClass,source});
  return context;
 }
 profileMission(slot,payloadMission=null){
  return payloadMission||(slot?.missionId?this.missionControl.get(slot.missionId):null)||null;
 }
 withProfileContext(slotId,envelope,mission=null){
  const context=this.compileProfileForSlot(slotId,{mission});
  if(!context)return clone(envelope);
  return {...clone(envelope),profile_context:clone(context)};
 }
 withProfileInstruction(slotId,instruction,mission=null){
  const context=this.compileProfileForSlot(slotId,{mission});
  if(!context)return instruction;
  return context.text+"\n\n## CURRENT INSTRUCTION\n"+String(instruction);
 }
 castMission(missionId,slotId){
  const mission=this.missionControl.get(missionId);if(!mission)throw new Error("Unknown mission "+missionId);
  if(!this.profileApi)throw new Error("Profile package unavailable");
  const canonical=canonicalSlotId(slotId);
  const slot=this.controller.registry.get(canonical);if(!slot)throw new Error("Unknown slot "+canonical);
  const cast=this.profileApi.selectProfilesForMission(mission,{executionClass:slot.executionClass});
  const compiled=this.profileApi.compileProfileContext(cast,{executionClass:slot.executionClass});
  this.controller.assignMission(missionId,canonical,{profileIds:compiled.profileIds,expectedExecutionClass:slot.executionClass,source:"profile-cast"});
  this.audit("mission-cast",{missionId,slotId:canonical,inputSlotId:slotId,profiles:compiled.profileIds});
  return {mission:clone(mission),slot:clone(this.controller.registry.get(canonical)),cast,compiled};
 }
 squadForWorker(workerId){if(SQUADS.A.includes(workerId))return"A";if(SQUADS.B.includes(workerId))return"B";return null}
 recordArtifact({id,type,missionId,parentIds=[],agentId=null,artifactId=null,metadata={}}){
  return this.provenance.add(createProvenanceNode({id,type,missionId,parentIds,agentId,artifactId,metadata}));
 }
 normalizePipelineMission(m){
  return {id:m.id,title:m.title,goal:m.goal,repository:m.repository,scope_paths:m.scopePaths||[],constraints:m.constraints||[],acceptance_criteria:m.acceptanceCriteria||[],runtime_requirements:m.verificationRequirements||[],dependencies:m.dependencies||[]};
 }
 async dispatchChatPass(workerId,action){
  const slot=this.controller.registry.get(workerId);if(!slot||slot.executionClass!=="chat_worker")throw new Error("Chat slot required");
  const service=this.services.require("chat");
  if(slot.conversation?.identity&&service.assertConversation)await service.assertConversation(slot.conversation.identity);
  const mission=this.profileMission(slot),context=this.compileProfileForSlot(workerId,{mission});
  const instruction=context?context.text+"\n\n## CURRENT INSTRUCTION\n"+String(action.instruction):action.instruction;
  const profileIds=context?.profile_ids||[];
  const result=await service.send({workerId,conversation:slot.conversation,instruction,idempotencyKey:action.key,profileIds:[...profileIds]});
  this.audit("chat-pass-sent",{workerId,missionId:slot.missionId,key:action.key,profileIds:[...profileIds]});return result;
 }
 async requestWorkReview(squad,payload){
  const id=canonicalSupervisorForSquad(squad),slot=this.controller.registry.get(id),service=this.services.require("work");
  const mission=this.profileMission(slot,payload?.mission||null),profiled=this.withProfileContext(id,payload,mission);
  this.audit("work-review-routed",{squad,supervisorId:id,pipelineSupervisorId:payload?.supervisor_slot||payload?.supervisorSlot||null,missionId:slot?.missionId||payload?.mission?.id||null,profileIds:profiled?.profile_context?.profile_ids||[]});
  return service.review({supervisorId:id,conversation:slot.conversation,payload:profiled,profileIds:profiled?.profile_context?.profile_ids||[]});
 }
 async requestWorkReviewForPipelineSlot(supervisorId,payload){
  const mapped=canonicalizePipelineSlot(supervisorId,"work_supervisor");
  const slot=this.controller.registry.get(mapped.canonicalSlotId),service=this.services.require("work");
  const mission=this.profileMission(slot,payload?.mission||null),profiled=this.withProfileContext(mapped.canonicalSlotId,payload,mission);
  this.audit("work-review-routed",{supervisorId:mapped.canonicalSlotId,pipelineSupervisorId:mapped.pipelineSlotId,missionId:slot?.missionId||payload?.mission?.id||null,profileIds:profiled?.profile_context?.profile_ids||[]});
  return service.review({supervisorId:mapped.canonicalSlotId,conversation:slot.conversation,payload:profiled,profileIds:profiled?.profile_context?.profile_ids||[]});
 }
 async dispatchCodexPacket(builderId,packet){
  const mapped=canonicalizePipelineSlot(builderId,"codex_builder");
  const packetSlot=packet?.builder_slot||packet?.builderSlot||null;
  if(packetSlot){
   const packetMapped=canonicalizePipelineSlot(packetSlot,"codex_builder");
   if(packetMapped.canonicalSlotId!==mapped.canonicalSlotId){
    const e=new Error("Builder packet slot does not match dispatch slot");e.code="BUILDER_SLOT_MISMATCH";e.builderId=mapped.canonicalSlotId;e.packetBuilderId=packetMapped.canonicalSlotId;throw e;
   }
  }
  const slot=this.controller.registry.get(mapped.canonicalSlotId);if(!slot||slot.executionClass!=="codex_builder")throw new Error("Codex builder required");
  const mission=this.profileMission(slot,packet?.mission||null),profiled=this.withProfileContext(mapped.canonicalSlotId,packet,mission);
  this.audit("codex-packet-routed",{builderId:mapped.canonicalSlotId,pipelineBuilderId:mapped.pipelineSlotId,missionId:packet?.mission?.id||packet?.mission_id||slot.missionId||null,packetId:packet?.packet_id||packet?.packetId||null,profileIds:profiled?.profile_context?.profile_ids||[]});
  return this.services.requireCapability("codex","build").build({builderId:mapped.canonicalSlotId,packet:profiled,profileIds:profiled?.profile_context?.profile_ids||[]});
 }
 async orchestrate(bundle){
  const slot=this.controller.registry.get("ORCHESTRATOR"),mission=this.profileMission(slot,bundle?.mission||null);
  const profiled=this.withProfileContext("ORCHESTRATOR",bundle,mission);
  this.audit("orchestrator-routed",{orchestratorId:slot.id,missionId:mission?.id||null,profileIds:profiled?.profile_context?.profile_ids||[]});
  return this.services.requireCapability("codex","orchestrate").orchestrate({orchestratorId:slot.id,bundle:profiled,profileIds:profiled?.profile_context?.profile_ids||[]});
 }
}
