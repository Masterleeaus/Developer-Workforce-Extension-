import {runExtensionDiagnostics,DIAGNOSTIC_STATUS} from "./titan-workforce/extension-diagnostics.js";

export async function runTitanPreflight(){
 const runtime=await runExtensionDiagnostics();
 const checks=[...runtime.checks];
 const add=(name,ok,detail="",critical=true)=>checks.push({
  name,status:ok?DIAGNOSTIC_STATUS.PASS:DIAGNOSTIC_STATUS.FAIL,ok:!!ok,critical,category:"titan-package",detail:String(detail||""),evidence:null
 });
 const api=window.TitanDeveloperWorkforce;
 const agents=api?.controller?.registry?.list?.()||[];
 const counts=agents.reduce((o,a)=>(o[a.executionClass]=(o[a.executionClass]||0)+1,o),{});
 add("10 Chat workers",counts.chat_worker===10,String(counts.chat_worker||0));
 add("2 Work supervisors",counts.work_supervisor===2,String(counts.work_supervisor||0));
 add("2 Codex builders",counts.codex_builder===2,String(counts.codex_builder||0));
 add("1 Codex orchestrator",counts.codex_orchestrator===1,String(counts.codex_orchestrator||0));
 const profileCount=window.TitanAgentProfiles?.listProfiles?.().length||0;
 add("Agent profiles",profileCount>=30,String(profileCount));
 add("Five-pass scheduler",!!window.TitanChatFivePass?.ChatFivePassScheduler);
 add("Work/Codex pipeline",!!window.TitanWorkCodexPipeline);
 const criticalFailures=checks.filter(x=>x.critical&&x.status!==DIAGNOSTIC_STATUS.PASS&&x.status!==DIAGNOSTIC_STATUS.DISABLED);
 const result={
  ok:criticalFailures.length===0,
  at:Date.now(),
  checks,
  criticalFailures:criticalFailures.map(x=>x.name),
  runtime
 };
 window.__titanPreflight=result;
 window.__titanExtensionDiagnostics=runtime;
 window.dispatchEvent(new CustomEvent("titan:preflight",{detail:result}));
 window.dispatchEvent(new CustomEvent("titan:extension-diagnostics",{detail:runtime}));
 return result;
}
window.runTitanPreflight=runTitanPreflight;
setTimeout(()=>runTitanPreflight().catch(e=>{
 window.__titanPreflight={ok:false,at:Date.now(),checks:[{name:"preflight exception",status:"fail",ok:false,critical:true,category:"preflight",detail:String(e?.message||e)}],criticalFailures:["preflight exception"]};
}),1500);
