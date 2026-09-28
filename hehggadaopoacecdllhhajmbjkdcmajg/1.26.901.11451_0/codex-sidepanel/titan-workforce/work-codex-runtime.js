const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));

const BUILDER_ID=Object.freeze({"builder-a":"BUILDER_A","builder-b":"BUILDER_B"});
const BUILDER_SLOT=Object.freeze({BUILDER_A:"builder-a",BUILDER_B:"builder-b"});
const TERMINAL=new Set(["COMPLETE","BLOCKED"]);

function error(code,message,extra={}){
 return Object.assign(new Error(message),{code,...extra});
}
function parseJsonText(text){
 const raw=String(text||"").trim();
 if(!raw)return null;
 const fenced=raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
 const candidate=(fenced?.[1]||raw).trim();
 try{return JSON.parse(candidate)}catch{}
 const object=candidate.match(/\{[\s\S]*\}/);
 if(object)try{return JSON.parse(object[0])}catch{}
 return null;
}
function unwrap(result){
 if(result==null)return null;
 if(result.parsed&&typeof result.parsed==="object")return result.parsed;
 if(typeof result==="string")return parseJsonText(result)||{instruction:result};
 if(result.text&&typeof result.text==="string")return parseJsonText(result.text)||result;
 return result;
}
function acceptanceEvidence(mission){
 const criteria=(mission?.acceptanceCriteria||mission?.acceptance_criteria||[]).map((c,index)=>
  typeof c==="string"?{id:"ac-"+(index+1),text:c,done:false}:{...clone(c),done:c?.done===true}
 );
 return {passed:criteria.length===0||criteria.every(c=>c.done),criteria};
}
function testEvidence(builderResults){
 return builderResults.flatMap(result=>(result.tests||[]).map((test,index)=>{
  if(typeof test==="string")return{name:test,status:"unknown",passed:false};
  return{...clone(test),passed:test?.passed===true||test?.status==="passed"};
 }));
}
function hintFromOrchestrator(raw){
 const value=unwrap(raw)||{};
 const state=String(value.state||value.decision||value.next_decision||"").toUpperCase();
 const hint={reason:value.reason||value.summary||null};
 if(state==="REPAIR"){hint.repair_required=true;hint.builder_slot=value.builder_slot||value.builderSlot;hint.repair_packet=value.repair_packet||value.repairPacket||{}}
 if(state==="RESEARCH"){hint.research_required=true;hint.squad=value.squad;hint.research_request=value.research_request||value.researchRequest||{}}
 if(state==="BLOCKED"){hint.blocked=true;hint.blocker=value.blocker||{}}
 if(state==="VERIFY")hint.reason=hint.reason||"Orchestrator requested verification";
 return hint;
}
function builderState(registry,missionControl){
 const state={completed_dependencies:[]};
 for(const [runtimeId,pipelineId] of Object.entries(BUILDER_SLOT)){
  const slot=registry.get(runtimeId);
  state[pipelineId]={
   workload:["building","assigned","reviewing"].includes(slot?.status)?1:0,
   blocked:["blocked","quarantined","emergency-stopped"].includes(slot?.status),
   repository:null,
   owned_paths:[]
  };
 }
 for(const mission of missionControl.list()){
  if(["complete","verified"].includes(mission.status))state.completed_dependencies.push(mission.id);
 }
 return state;
}

export class TitanWorkCodexRuntime{
 constructor({
  state,
  integration,
  missionControl,
  services,
  capabilities,
  gitSubstrate=null,
  pipelineApi=globalThis.TitanWorkCodexPipeline,
  audit=()=>{},
  save=async()=>{}
 }={}){
  if(!state||!integration||!missionControl||!services||!capabilities)throw error("PIPELINE_DEPENDENCIES_REQUIRED","Work/Codex runtime dependencies are required");
  if(!pipelineApi)throw error("WP3_PIPELINE_UNAVAILABLE","WP3 pipeline package unavailable");
  this.state=state;
  this.integration=integration;
  this.missionControl=missionControl;
  this.services=services;
  this.capabilities=capabilities;
  this.gitSubstrate=gitSubstrate;
  this.pipeline=pipelineApi;
  this.audit=audit;
  this.save=save;
  this.state.workCodexRuntime=this.state.workCodexRuntime&&typeof this.state.workCodexRuntime==="object"
   ?this.state.workCodexRuntime:{runs:{},errors:[]};
  this.state.workCodexRuntime.runs=this.state.workCodexRuntime.runs||{};
  this.state.workCodexRuntime.errors=Array.isArray(this.state.workCodexRuntime.errors)?this.state.workCodexRuntime.errors:[];
 }
 run(missionId){
  return this.state.workCodexRuntime.runs[missionId]||(this.state.workCodexRuntime.runs[missionId]={
   missionId,
   status:"research",
   cycleReviews:[],
   approvedDeltas:[],
   packets:[],
   builderResults:[],
   orchestratorDecisions:[],
   verification:[],
   updatedAt:Date.now()
  });
 }
 recordError(missionId,stage,cause){
  const item={at:Date.now(),missionId,stage,code:cause?.code||null,message:String(cause?.message||cause)};
  this.state.workCodexRuntime.errors.push(item);
  this.state.workCodexRuntime.errors=this.state.workCodexRuntime.errors.slice(-200);
  this.audit("work-codex-runtime-error",item);
  return item;
 }
 requireExecutionCapabilities(){
  const missing=["codex.build","codex.orchestrate"].filter(name=>!this.capabilities.has(name));
  if(missing.length)throw error("CODEX_EXECUTION_CAPABILITY_UNAVAILABLE","Required Codex execution capabilities unavailable: "+missing.join(", "),{missing});
  const codex=this.services.get("codex");
  if(!codex||typeof codex.build!=="function"||typeof codex.orchestrate!=="function"){
   throw error("CODEX_EXECUTION_SERVICE_UNAVAILABLE","Codex service must expose distinct build() and orchestrate() capabilities");
  }
  return true;
 }
 workOutputContract(request){
  return {
   ...clone(request),
   output_contract:{
    format:"json",
    required:["next_decision"],
    next_decision:["CONTINUE_5","READY_FOR_CODEX","REDIRECT","BLOCKED"],
    ready_for_codex_requires:{
     approved_delta:{
      required:["required_changes","scope_paths"],
      scope_rule:"scope_paths must stay within the mission scope"
     }
    },
    optional:["approved_findings","rejected_findings","unresolved_questions","architecture_implications","dependencies","evidence_quality","redirect","blocker"]
   }
  };
 }
 async handleSupervisorBoundary({event,request,supervisorId,squad}){
  const missionId=event?.missionId||request?.mission?.id;
  const mission=this.missionControl.get(missionId);
  if(!mission)throw error("MISSION_NOT_FOUND","Mission not found for Work/Codex runtime");
  const run=this.run(missionId);
  run.status="supervisor-review";
  run.updatedAt=Date.now();
  try{
   const response=await this.integration.requestWorkReview(squad,this.workOutputContract(request));
   const parsed=unwrap(response);
   if(!parsed?.next_decision)throw error("WORK_REVIEW_INVALID","Work supervisor returned no next_decision");
   const cycleReview=this.pipeline.createCycleReview({
    mission:request.mission,
    worker:request.worker,
    squad:request.squad,
    cycle:request.cycle,
    passes_completed:request.passes_completed,
    approved_findings:parsed.approved_findings,
    rejected_findings:parsed.rejected_findings,
    unresolved_questions:parsed.unresolved_questions,
    architecture_implications:parsed.architecture_implications,
    dependencies:parsed.dependencies,
    evidence_quality:parsed.evidence_quality,
    next_decision:parsed.next_decision,
    redirect:parsed.redirect,
    blocker:parsed.blocker,
    provenance:request.provenance
   });
   run.cycleReviews.push(cycleReview);
   this.audit("work-cycle-review-completed",{missionId,supervisorId,reviewId:cycleReview.review_id,nextDecision:cycleReview.next_decision});
   const next=this.pipeline.nextResearchEpoch(cycleReview);
   if(next.action!=="compile-delta"){
    run.status=next.action;
    const target=next.action==="mission-control-attention"?"blocked":"research";
    this.missionControl.transition(missionId,target,cycleReview.next_decision);
    this.integration.controller.registry.get(supervisorId).status=target==="blocked"?"blocked":"idle";
    run.updatedAt=Date.now();await this.save();
    return{stage:"work-review",cycleReview,next};
   }
   const approved=parsed.approved_delta||parsed.approvedDelta||parsed.delta;
   if(!approved||!Array.isArray(approved.scope_paths||approved.scopePaths)||!(approved.scope_paths||approved.scopePaths).length){
    throw error("WORK_APPROVED_DELTA_REQUIRED","READY_FOR_CODEX requires approved_delta with non-empty scope_paths");
   }
   const delta=this.pipeline.compileApprovedImplementationDelta({
    mission:request.mission,
    cycle_reviews:[cycleReview],
    ...clone(approved)
   });
   run.approvedDeltas.push(delta);
   run.status="delta-approved";
   this.integration.controller.registry.get(supervisorId).status="idle";
   const result=await this.executeApprovedDelta(mission,delta,run);
   await this.save();
   return result;
  }catch(cause){
   this.recordError(missionId,"supervisor-boundary",cause);
   run.status="blocked";run.updatedAt=Date.now();
   this.missionControl.transition(missionId,"blocked",String(cause?.message||cause));
   const supervisor=this.integration.controller.registry.get(supervisorId);if(supervisor)supervisor.status="blocked";
   await this.save();
   throw cause;
  }
 }
 async executeApprovedDelta(mission,delta,run=this.run(mission.id)){
  this.requireExecutionCapabilities();
  const packet=this.pipeline.assignBuilder(delta,{repository:mission.repository||mission.repo},builderState(this.integration.controller.registry,this.missionControl));
  run.packets.push(packet);run.status="builder-dispatch";run.updatedAt=Date.now();
  const builderId=BUILDER_ID[packet.builder_slot];
  if(!builderId)throw error("BUILDER_ROUTE_INVALID","Unknown builder route "+packet.builder_slot);
  const builder=this.integration.controller.registry.get(builderId);
  this.integration.controller.assignMission(mission.id,builderId,{profileIds:builder.profileIds||[],expectedExecutionClass:"codex_builder",transfer:true,source:"work-codex-runtime"});
  builder.status="building";builder.updatedAt=Date.now();
  this.missionControl.transition(mission.id,"building","Codex builder "+builderId);
  this.audit("codex-builder-dispatched",{missionId:mission.id,builderId,packetId:packet.packet_id});
  const raw=await this.integration.dispatchCodexPacket(builderId,packet,{missionId:mission.id});
  const data=unwrap(raw)||{};
  const builderResult=this.pipeline.createBuilderResult({
   packet,
   builder_slot:packet.builder_slot,
   files_changed:data.files_changed||data.filesChanged||[],
   diff:data.diff||"",
   tests:data.tests||[],
   commit:data.commit||null,
   branch:data.branch||null,
   pr:data.pr||null,
   ci:data.ci||null,
   blockers:data.blockers||[],
   remaining_implementation:data.remaining_implementation||data.remainingImplementation||[],
   provenance:data.provenance||[]
  });
  run.builderResults.push(builderResult);run.status="orchestrator-review";run.updatedAt=Date.now();
  builder.status=builderResult.blockers.length?"blocked":"idle";builder.updatedAt=Date.now();
  this.audit("codex-builder-result",{missionId:mission.id,builderId,resultId:builderResult.result_id,files:builderResult.files_changed});

  const github=this.services.get("github");
  if(!github||typeof github.verify!=="function")throw error("GITHUB_VERIFICATION_UNAVAILABLE","Authoritative GitHub verification service unavailable");
  const githubTruth=await github.verify({mission});
  run.verification.push({type:"github",at:Date.now(),evidence:clone(githubTruth)});
  if(this.gitSubstrate?.get?.(mission.id)){
   this.gitSubstrate.markCI(mission.id,{status:githubTruth.ciPassed?"success":githubTruth.ciStatus||"failed",headSha:githubTruth.headSha||builderResult.commit?.sha||null});
   if(builderResult.pr)this.gitSubstrate.markPullRequest(mission.id,{number:builderResult.pr.number,url:builderResult.pr.url||null,state:githubTruth.merged?"merged":"open",headSha:githubTruth.headSha||null});
  }

  let runtimeEvidence=null;
  const runtimeRequired=(mission.runtimeRequirements||mission.runtime_requirements||mission.verificationRequirements||[]).length>0;
  const runtime=this.services.get("runtime");
  if(runtimeRequired&&runtime?.verify){
   runtimeEvidence=await runtime.verify({mission,requirements:mission.runtimeRequirements||mission.verificationRequirements||[]});
   run.verification.push({type:"runtime",at:Date.now(),evidence:clone(runtimeEvidence)});
  }
  const acceptance=acceptanceEvidence(mission);
  const tests=testEvidence([builderResult]);
  const bundle=this.pipeline.createOrchestratorBundle({
   mission:this.integration.normalizePipelineMission(mission),
   approved_deltas:[delta],
   builder_results:[builderResult],
   actual_git_diff:builderResult.diff,
   commits:[builderResult.commit].filter(Boolean),
   prs:[builderResult.pr].filter(Boolean),
   ci:builderResult.ci,
   tests,
   runtime_evidence:runtimeEvidence,
   acceptance_evidence:acceptance,
   github_truth:githubTruth
  });
  const orchestrator=this.integration.controller.registry.get("ORCHESTRATOR");
  this.integration.controller.assignMission(mission.id,"ORCHESTRATOR",{profileIds:orchestrator.profileIds||[],expectedExecutionClass:"codex_orchestrator",transfer:true,source:"work-codex-runtime"});
  orchestrator.status="reviewing";orchestrator.updatedAt=Date.now();
  const rawDecision=await this.integration.orchestrate({
   ...bundle,
   output_contract:{format:"json",decision:["COMPLETE","REPAIR","RESEARCH","VERIFY","BLOCKED"],required:["decision","reason"]}
  },{missionId:mission.id});
  const decision=this.pipeline.decideOrchestrator(bundle,hintFromOrchestrator(rawDecision));
  run.orchestratorDecisions.push(decision);run.status=decision.state.toLowerCase();run.updatedAt=Date.now();
  orchestrator.status="idle";orchestrator.updatedAt=Date.now();
  const route=this.pipeline.routeOrchestratorDecision(decision);
  this.routeMissionDecision(mission.id,decision,route);
  this.audit("codex-orchestrator-decision",{missionId:mission.id,decisionId:decision.decision_id,state:decision.state,route});
  await this.save();
  return{stage:"orchestrator",delta,packet,builderResult,bundle,decision,route};
 }
 routeMissionDecision(missionId,decision,route){
  switch(decision.state){
   case "COMPLETE": {
    const run=this.run(missionId),g=run.verification.find(x=>x.type==="github")?.evidence||{};
    if(this.gitSubstrate?.get?.(missionId))this.gitSubstrate.assertGitHubTruthComplete(missionId,{merged:g.merged===true,mergeCommit:g.mergeCommit||g.mergeCommitSha||g.commitSha||g.headSha||null,ciStatus:g.ciPassed?"success":g.ciStatus,verified:true});
    this.missionControl.transition(missionId,"complete",decision.reason);break;
   }
   case "REPAIR": this.missionControl.transition(missionId,"repair",decision.reason);break;
   case "RESEARCH": this.missionControl.transition(missionId,"research",decision.reason);break;
   case "VERIFY": this.missionControl.transition(missionId,"verification",decision.reason);break;
   case "BLOCKED": this.missionControl.transition(missionId,"blocked",decision.reason);break;
   default: throw error("ORCHESTRATOR_DECISION_INVALID","Unsupported orchestrator decision "+decision.state);
  }
  return route;
 }
 snapshot(){return clone(this.state.workCodexRuntime)}
}
