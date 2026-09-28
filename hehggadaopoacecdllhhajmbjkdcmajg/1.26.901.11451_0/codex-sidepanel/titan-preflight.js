import {validateWorkforceStateDetailed} from "./titan-workforce/state.js";
import {verifyDiffScope} from "./titan-workforce/scope-locks.js";

function add(checks,name,ok,detail="",required=true){
 checks.push({name,ok:!!ok,detail,required});
}
function fail(message){throw new Error(message)}
function profileCount(){try{return window.TitanAgentProfiles?.listProfiles?.().length||0}catch{return 0}}

export function runTitanSystemSelfTest(){
 const Profiles=window.TitanAgentProfiles,Chat=window.TitanChatFivePass,Pipeline=window.TitanWorkCodexPipeline;
 if(!Profiles||!Chat?.ChatFivePassScheduler||!Pipeline)fail("WP1/WP2/WP3 packages unavailable");
 const mission={id:"preflight-selftest",title:"Preflight integration",goal:"Verify zero-token workforce flow",repository:"example/repo",scope_paths:["src/preflight"],constraints:[],acceptance_criteria:[{id:"a1",text:"flow",done:false}],runtime_requirements:["browser","network"]};
 const cast=Profiles.selectProfilesForMission(mission,{executionClass:"chat_worker"});
 const compiled=Profiles.compileProfileContext(cast,{executionClass:"chat_worker"});
 if(!compiled?.profileIds?.length)fail("profile casting failed");
 let now=0;const events=[];
 const scheduler=new Chat.ChatFivePassScheduler({clock:()=>now,emit:e=>events.push(e)});
 scheduler.startCycle("A1",{missionId:mission.id,cycleId:"cycle-1",queue:[1,2,3,4,5].map(n=>"pass "+n)});
 for(let pass=1;pass<=5;pass++){
  const worker=scheduler.getWorker("A1");now=worker.nextGateAt;
  const action=scheduler.inspectGate("A1",{busy:false});if(action.action!=="dispatch")fail("chat dispatch failed at pass "+pass);
  scheduler.confirmDispatch("A1",action.key);scheduler.completePass("A1",{summary:"pass "+pass});
 }
 const event=events.find(e=>e.type==="supervisor_review_required");if(!event)fail("supervisor review event missing");
 const request=Pipeline.adaptChatSupervisorReviewEvent(event,mission);if(request.supervisor_slot!=="supervisor-a")fail("Supervisor A routing failed");
 const review=Pipeline.createCycleReview({mission,worker:"A1",squad:"A",cycle:1,passes_completed:5,approved_findings:["bounded"],next_decision:"READY_FOR_CODEX"});
 const delta=Pipeline.compileApprovedImplementationDelta({mission,cycle_reviews:[review],validated_findings:["bounded"],required_changes:["change"],scope_paths:["src/preflight"],expected_files:["src/preflight/index.js"],tests:[{name:"selftest",required:true}]});
 const packet=Pipeline.assignBuilder(delta,{},{"builder-a":{workload:0,repository:"example/repo"},"builder-b":{workload:1,repository:"example/repo"}});
 const result=Pipeline.createBuilderResult({packet,files_changed:["src/preflight/index.js"],diff:"diff",tests:[{name:"selftest",passed:true}],commit:{sha:"abc"},branch:{name:"selftest"},pr:{number:1},ci:{passed:true}});
 const bundle=Pipeline.createOrchestratorBundle({mission,approved_deltas:[delta],builder_results:[result],actual_git_diff:"diff",tests:[{name:"selftest",passed:true}],github_truth:{commitExists:true,ciPassed:true,merged:true,presentOnMain:true},runtime_evidence:{deployed:true,browserPassed:true,consoleClean:true,networkPassed:true,acceptancePassed:true},acceptance_evidence:{passed:true}});
 const complete=Pipeline.decideOrchestrator(bundle);
 if(complete.state!=="COMPLETE")fail("orchestrator did not COMPLETE");
 const verify=Pipeline.decideOrchestrator(Pipeline.createOrchestratorBundle({...bundle,github_truth:{commitExists:true,ciPassed:true,merged:false,presentOnMain:false}}));
 if(verify.state!=="VERIFY")fail("VERIFY failure route missing");
 const repair=Pipeline.decideOrchestrator(Pipeline.createOrchestratorBundle({...bundle,tests:[{name:"selftest",passed:false}]}));
 if(repair.state!=="REPAIR")fail("REPAIR failure route missing");
 if(Pipeline.decideOrchestrator(bundle,{research_required:true,research_request:{question:"why"}}).state!=="RESEARCH")fail("RESEARCH route missing");
 if(verifyDiffScope(["src/escape.js"],["src/preflight"]).ok)fail("scope violation not rejected");
 return {ok:true,profileIds:[...compiled.profileIds],worker:"A1",supervisor:request.supervisor_slot,builder:packet.builder_slot,decision:complete.state};
}

export async function runTitanPreflight(){
 const checks=[];
 add(checks,"Chrome extension API",!!globalThis.chrome?.runtime,globalThis.chrome?.runtime?.id||"missing");
 add(checks,"Storage API",!!globalThis.chrome?.storage?.local);
 add(checks,"Tabs API",!!globalThis.chrome?.tabs);
 add(checks,"Scripting API",!!globalThis.chrome?.scripting);
 add(checks,"Debugger API",!!globalThis.chrome?.debugger);

 const api=window.TitanDeveloperWorkforce;
 add(checks,"Developer Workforce v4",!!api);
 const agents=api?.controller?.registry?.list?.()||[];
 add(checks,"15-agent topology",agents.length===15,String(agents.length));
 const counts=agents.reduce((o,a)=>(o[a.executionClass]=(o[a.executionClass]||0)+1,o),{});
 add(checks,"10 Chat workers",counts.chat_worker===10,String(counts.chat_worker||0));
 add(checks,"2 Work supervisors",counts.work_supervisor===2,String(counts.work_supervisor||0));
 add(checks,"2 Codex builders",counts.codex_builder===2,String(counts.codex_builder||0));
 add(checks,"1 Codex orchestrator",counts.codex_orchestrator===1,String(counts.codex_orchestrator||0));

 const stateValidation=api?.state?validateWorkforceStateDetailed(api.state):{ok:false,errors:[{code:"NO_STATE"}]};
 add(checks,"Canonical workforce state",stateValidation.ok,stateValidation.ok?"valid":JSON.stringify(stateValidation.errors?.slice?.(0,8)||[]));
 add(checks,"Persistence API",typeof api?.save==="function");
 add(checks,"Agent profiles",profileCount()>=45,String(profileCount()));
 add(checks,"Five-pass scheduler",!!window.TitanChatFivePass?.ChatFivePassScheduler);
 add(checks,"Work/Codex pipeline",!!window.TitanWorkCodexPipeline);
 add(checks,"Mission Control",!!api?.missions);
 add(checks,"Workforce Controller",!!api?.controller);
 add(checks,"Scope locks",verifyDiffScope(["src/test/a.js"],["src/test"]).ok&&!verifyDiffScope(["src/escape.js"],["src/test"]).ok);
 add(checks,"Recovery state",!!api?.state?.recovery||api?.state?.controls?.requiresReconciliation===false,"recovery metadata/clean state");
 add(checks,"Conversation identity lock",api?.services?.get?.("chat")?.capabilities?.includes?.("conversation_identity")===true);
 add(checks,"Send ledger/idempotency",Array.isArray(api?.state?.sendLedger)||Array.isArray(api?.state?.legacy?.compatibility?.sendLedger),"required durable ledger",true);
 add(checks,"Approval policy",Array.isArray(api?.state?.approvals)||Array.isArray(api?.state?.legacy?.compatibility?.approvals),"required durable approvals",true);
 add(checks,"Engineering Cockpit",!!document.getElementById("titan-dev-workforce"));

 const svc=api?.services?.status?.()||{};
 add(checks,"Chat service",svc.chat?.available===true);
 add(checks,"Work service",svc.work?.available===true);
 add(checks,"GitHub Truth",svc.github?.available===true||!!window.TitanGitHubTruth);
 add(checks,"Repository Context",svc.repository?.available===true||!!window.TitanRepositoryContext);
 add(checks,"Runtime Verification",svc.runtime?.available===true||!!window.TitanRuntimeVerification);
 add(checks,"Codex service",svc.codex?.available===true,JSON.stringify(svc.codex||{}),false);
 add(checks,"Terminal service",svc.terminal?.available===true,JSON.stringify(svc.terminal||{}),false);

 let self=null;try{self=runTitanSystemSelfTest()}catch(error){self={ok:false,error:String(error?.message||error)}}
 add(checks,"15-agent zero-token system self-test",self?.ok===true,JSON.stringify(self));

 const requiredOk=checks.filter(x=>x.required!==false).every(x=>x.ok);
 const result={ok:requiredOk,at:Date.now(),schemaVersion:api?.state?.schemaVersion||null,checks,selfTest:self};
 if(api?.state?.controls){
  api.state.controls.preflightPassed=result.ok;
  api.state.controls.preflightAt=result.at;
  api.state.controls.preflightSummary={ok:result.ok,failed:checks.filter(x=>x.required!==false&&!x.ok).map(x=>x.name)};
  try{await api.save?.()}catch(error){result.ok=false;result.checks.push({name:"Persist preflight result",ok:false,detail:String(error?.message||error),required:true});api.state.controls.preflightPassed=false}
 }
 window.__titanPreflight=result;window.dispatchEvent(new CustomEvent("titan:preflight",{detail:result}));return result;
}
window.runTitanSystemSelfTest=runTitanSystemSelfTest;
window.runTitanPreflight=runTitanPreflight;
setTimeout(()=>runTitanPreflight().catch(error=>{
 const result={ok:false,at:Date.now(),checks:[{name:"preflight exception",ok:false,detail:String(error?.message||error),required:true}]};
 if(window.TitanDeveloperWorkforce?.state?.controls)window.TitanDeveloperWorkforce.state.controls.preflightPassed=false;
 window.__titanPreflight=result;window.dispatchEvent(new CustomEvent("titan:preflight",{detail:result}));
}),1500);
