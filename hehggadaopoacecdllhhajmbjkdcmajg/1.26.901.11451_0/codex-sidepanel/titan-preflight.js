import {runExtensionDiagnostics,DIAGNOSTIC_STATUS} from "./titan-workforce/extension-diagnostics.js";

function packageCheck(name,ok,detail=""){
 return {
  name,
  status:ok?DIAGNOSTIC_STATUS.PASS:DIAGNOSTIC_STATUS.FAIL,
  ok:!!ok,
  critical:true,
  category:"titan-package",
  detail:String(detail||""),
  evidence:null
 };
}

export async function runTitanPreflight(){
 const extensionRuntime=await runExtensionDiagnostics();
 const packageChecks=[];

 const api=window.TitanDeveloperWorkforce;
 const agents=api?.controller?.registry?.list?.()||[];
 const counts=agents.reduce((out,agent)=>{
  out[agent.executionClass]=(out[agent.executionClass]||0)+1;
  return out;
 },{});

 packageChecks.push(packageCheck("Developer Workforce v4",!!api));
 packageChecks.push(packageCheck("15-agent topology",agents.length===15,String(agents.length)));
 packageChecks.push(packageCheck("10 Chat workers",counts.chat_worker===10,String(counts.chat_worker||0)));
 packageChecks.push(packageCheck("2 Work supervisors",counts.work_supervisor===2,String(counts.work_supervisor||0)));
 packageChecks.push(packageCheck("2 Codex builders",counts.codex_builder===2,String(counts.codex_builder||0)));
 packageChecks.push(packageCheck("1 Codex orchestrator",counts.codex_orchestrator===1,String(counts.codex_orchestrator||0)));

 const profileCount=window.TitanAgentProfiles?.listProfiles?.().length||0;
 packageChecks.push(packageCheck("Agent profiles",profileCount>=30,String(profileCount)));
 packageChecks.push(packageCheck("Five-pass scheduler",!!window.TitanChatFivePass?.ChatFivePassScheduler));
 packageChecks.push(packageCheck("Work/Codex pipeline",!!window.TitanWorkCodexPipeline));
 const services=api?.services?.status?.()||{};
 packageChecks.push({name:"Codex service",status:services.codex?.available?DIAGNOSTIC_STATUS.PASS:DIAGNOSTIC_STATUS.UNAVAILABLE,ok:services.codex?.available===true,critical:false,category:"workforce-readiness",detail:services.codex?.source||"unavailable",evidence:services.codex||null});
 packageChecks.push({name:"Git service",status:services.git?.available?DIAGNOSTIC_STATUS.PASS:DIAGNOSTIC_STATUS.UNAVAILABLE,ok:services.git?.available===true,critical:false,category:"workforce-readiness",detail:services.git?.source||"unavailable",evidence:services.git||null});
 packageChecks.push({name:"GitHub service",status:services.github?.available?DIAGNOSTIC_STATUS.PASS:DIAGNOSTIC_STATUS.UNAVAILABLE,ok:services.github?.available===true,critical:false,category:"workforce-readiness",detail:services.github?.source||"unavailable",evidence:services.github||null});
 packageChecks.push({name:"Repository service",status:services.repository?.available?DIAGNOSTIC_STATUS.PASS:DIAGNOSTIC_STATUS.UNAVAILABLE,ok:services.repository?.available===true,critical:false,category:"workforce-readiness",detail:services.repository?.source||"unavailable",evidence:services.repository||null});
 packageChecks.push({name:"Runtime Verification",status:services.runtime?.available?DIAGNOSTIC_STATUS.PASS:DIAGNOSTIC_STATUS.UNAVAILABLE,ok:services.runtime?.available===true,critical:false,category:"workforce-readiness",detail:services.runtime?.source||"unavailable",evidence:services.runtime||null});

 const criticalFailures=[
  ...extensionRuntime.criticalFailures,
  ...packageChecks.filter(check=>check.critical&&!check.ok).map(check=>check.name)
 ];

 const result={
  ok:criticalFailures.length===0,
  at:Date.now(),
  checks:[...extensionRuntime.checks,...packageChecks],
  criticalFailures,
  extensionRuntime,
  workforceReadiness:extensionRuntime.workforce
 };

 window.__titanPreflight=result;
 window.__titanExtensionDiagnostics=extensionRuntime;
 window.dispatchEvent(new CustomEvent("titan:preflight",{detail:result}));
 window.dispatchEvent(new CustomEvent("titan:extension-diagnostics",{detail:extensionRuntime}));
 return result;
}

window.runTitanPreflight=runTitanPreflight;

setTimeout(()=>runTitanPreflight().catch(error=>{
 window.__titanPreflight={
  ok:false,
  at:Date.now(),
  checks:[{
   name:"preflight exception",
   status:DIAGNOSTIC_STATUS.RUNTIME_FAILURE,
   ok:false,
   critical:true,
   category:"preflight",
   detail:String(error?.message||error)
  }],
  criticalFailures:["preflight exception"]
 };
}),1500);
