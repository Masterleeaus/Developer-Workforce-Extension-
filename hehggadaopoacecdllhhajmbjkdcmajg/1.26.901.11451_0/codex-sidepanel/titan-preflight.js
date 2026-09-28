export async function runTitanPreflight(){
 const checks=[];const add=(name,ok,detail="",required=true)=>checks.push({name,ok:!!ok,detail,required});
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
 add("Codex service",svc.codex?.available===true,svc.codex?.source||"unavailable",false);
 add("Git service",svc.git?.available===true,svc.git?.source||"unavailable",false);
 add("GitHub service",svc.github?.available===true,svc.github?.source||"unavailable",false);
 add("Repository service",svc.repository?.available===true,svc.repository?.source||"unavailable",false);
 add("Terminal service",svc.terminal?.available===true,svc.terminal?.source||"unavailable",false);
 add("Browser service",svc.browser?.available===true,svc.browser?.source||"unavailable",false);
 add("Server service",svc.server?.available===true,svc.server?.source||"unavailable",false);
 add("MCP service",svc.mcp?.available===true);
 const mcp=api?.mcp?.status?.();
 add("MCP registry",!!api?.mcp,mcp?JSON.stringify({servers:mcp.count,online:mcp.online,tools:mcp.tools}):"missing");
 let webMcpAssets=false,registered=[];
 try{
  const urls=["../content-scripts/webmcp.js","../content-scripts/webmcp-bridge.js"].map(p=>chrome.runtime.getURL(p.replace(/^\.\.\//,"")));
  const responses=await Promise.all(urls.map(url=>fetch(url,{cache:"no-store"})));
  webMcpAssets=responses.every(r=>r.ok);
  registered=await chrome.scripting.getRegisteredContentScripts({ids:["codex-webmcp","codex-webmcp-bridge"]}).catch(()=>[]);
 }catch{}
 add("WebMCP content scripts",webMcpAssets,"registered "+registered.length+"/2 (feature gate may be off)");
 const usage=api?.usageGovernor?.status?.();
 add("Usage governor",!!api?.usageGovernor,usage?JSON.stringify({state:usage.state,chat:usage.policy.chatConcurrency,codex:usage.policy.codexConcurrency,contextScale:usage.policy.contextScale}):"missing");
 const cap=api?.capabilities?.status?.();
 add("Capability broker",!!api?.capabilities,cap?JSON.stringify({count:cap.count,healthy:cap.healthy,failing:cap.failing}):"missing");
 const requiredCapabilities=["repo.search","codex.build","codex.orchestrate","runtime.verify"];
 add("Execution capability readiness",requiredCapabilities.every(name=>api?.capabilities?.has?.(name)),requiredCapabilities.map(name=>name+":"+(api?.capabilities?.has?.(name)?"ready":"missing")).join(", "),false);
 const result={ok:checks.filter(x=>x.required!==false).every(x=>x.ok),at:Date.now(),checks};window.__titanPreflight=result;window.dispatchEvent(new CustomEvent("titan:preflight",{detail:result}));return result;
}
window.runTitanPreflight=runTitanPreflight;
setTimeout(()=>runTitanPreflight().catch(e=>{window.__titanPreflight={ok:false,at:Date.now(),checks:[{name:"preflight exception",ok:false,detail:String(e?.message||e)}]}}),1500);
