export async function runTitanPreflight(){
 const checks=[];const add=(name,ok,detail="")=>checks.push({name,ok:!!ok,detail});
 add("Chrome extension API",!!globalThis.chrome?.runtime,chrome?.runtime?.id||"missing");
 add("Storage API",!!chrome?.storage?.local);add("Tabs API",!!chrome?.tabs);add("Scripting API",!!chrome?.scripting);add("Debugger API",!!chrome?.debugger);
 const api=window.TitanDeveloperWorkforce;
 add("Developer Workforce v4",!!api);
 const agents=api?.controller?.registry?.list?.()||[];
 add("15-agent topology",agents.length===15,String(agents.length));
 const counts=agents.reduce((o,a)=>(o[a.executionClass]=(o[a.executionClass]||0)+1,o),{});
 add("10 Chat workers",counts.chat_worker===10,String(counts.chat_worker||0));
 add("2 Work supervisors",counts.work_supervisor===2,String(counts.work_supervisor||0));
 add("2 Codex builders",counts.codex_builder===2,String(counts.codex_builder||0));
 add("1 Codex orchestrator",counts.codex_orchestrator===1,String(counts.codex_orchestrator||0));
 add("Agent profiles",window.TitanAgentProfiles?.listProfiles?.().length>=30,String(window.TitanAgentProfiles?.listProfiles?.().length||0));
 add("Five-pass scheduler",!!window.TitanChatFivePass?.ChatFivePassScheduler);
 add("Work/Codex pipeline",!!window.TitanWorkCodexPipeline);
 const svc=api?.services?.status?.()||{};add("Chat service",svc.chat?.available===true);add("Work service",svc.work?.available===true);
 add("GitHub Truth",svc.github?.available===true||!!window.TitanGitHubTruth);
 add("Repository Context",svc.repository?.available===true||!!window.TitanRepositoryContext);
 add("Runtime Verification",svc.runtime?.available===true||!!window.TitanRuntimeVerification);
 const result={ok:checks.every(x=>x.ok),at:Date.now(),checks};window.__titanPreflight=result;window.dispatchEvent(new CustomEvent("titan:preflight",{detail:result}));return result;
}
window.runTitanPreflight=runTitanPreflight;
setTimeout(()=>runTitanPreflight().catch(e=>{window.__titanPreflight={ok:false,at:Date.now(),checks:[{name:"preflight exception",ok:false,detail:String(e?.message||e)}]}}),1500);
