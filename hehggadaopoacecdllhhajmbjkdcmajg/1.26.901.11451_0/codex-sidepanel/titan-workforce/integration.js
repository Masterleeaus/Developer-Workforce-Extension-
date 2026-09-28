import {SQUADS} from "./constants.js";
import {TitanProvenanceGraph,createProvenanceNode} from "./provenance.js";

const ROOT="../../../";
const getGlobal=name=>globalThis[name]||null;
const clone=x=>x==null?x:JSON.parse(JSON.stringify(x));

export class TitanWorkforceIntegration{
 constructor({state,controller,missionControl,services,capabilities=null,audit=()=>{}}){
  this.state=state;this.controller=controller;this.missionControl=missionControl;this.services=services;this.capabilities=capabilities;this.audit=audit;
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
 castMission(missionId,slotId){
  const mission=this.missionControl.get(missionId);if(!mission)throw new Error("Unknown mission "+missionId);
  if(!this.profileApi)throw new Error("Profile package unavailable");
  const slot=this.controller.registry.get(slotId);if(!slot)throw new Error("Unknown slot "+slotId);
  const cast=this.profileApi.selectProfilesForMission(mission,{executionClass:slot.executionClass});
  const compiled=this.profileApi.compileProfileContext(cast,{executionClass:slot.executionClass});
  this.controller.assign(slotId,{missionId,profileIds:compiled.profileIds});
  this.audit("mission-cast",{missionId,slotId,profiles:compiled.profileIds});
  return {mission:clone(mission),slot:clone(this.controller.registry.get(slotId)),cast,compiled};
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
  const result=await service.send({workerId,conversation:slot.conversation,instruction:action.instruction,idempotencyKey:action.key});
  this.audit("chat-pass-sent",{workerId,missionId:slot.missionId,key:action.key});return result;
 }
 async requestWorkReview(squad,payload){
  const id=squad==="A"?"SUPERVISOR_A":"SUPERVISOR_B",slot=this.controller.registry.get(id),service=this.services.require("work");
  return service.review({supervisorId:id,conversation:slot.conversation,payload});
 }
 allowedCapabilitiesForSlot(slot){
  const profileCaps=[];
  if(this.profileApi&&Array.isArray(slot?.profileIds)){
   for(const id of slot.profileIds){
    const profile=this.profileApi.getProfile?.(id);
    if(Array.isArray(profile?.allowedCapabilities))profileCaps.push(...profile.allowedCapabilities);
   }
  }
  const helper=globalThis.TitanExecutionCapabilities?.capabilitiesForExecutionContext;
  return typeof helper==="function"?helper({executionClass:slot?.executionClass,profileCapabilities:profileCaps}):null;
 }
 async dispatchCodexPacket(builderId,packet,context={}){
  const slot=this.controller.registry.get(builderId);if(!slot||slot.executionClass!=="codex_builder")throw new Error("Codex builder required");
  if(this.capabilities?.has?.("codex.build")){
   const allowed=this.allowedCapabilitiesForSlot(slot);
   return this.capabilities.call("codex.build",{builderId,packet},{...context,executionClass:slot.executionClass,profileIds:slot.profileIds||[],...(allowed?{allowedCapabilities:allowed}:{})});
  }
  return this.services.require("codex").build({builderId,packet});
 }
 async orchestrate(bundle,context={}){
  const slot=this.controller.registry.get("ORCHESTRATOR");
  if(this.capabilities?.has?.("codex.orchestrate")){
   const allowed=this.allowedCapabilitiesForSlot(slot);
   return this.capabilities.call("codex.orchestrate",{orchestratorId:slot.id,bundle},{...context,executionClass:slot.executionClass,profileIds:slot.profileIds||[],...(allowed?{allowedCapabilities:allowed}:{})});
  }
  return this.services.require("codex").orchestrate({orchestratorId:slot.id,bundle});
 }
}
