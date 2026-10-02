import {pageProbe,sendPrompt} from "./conversation-service.js";
const COMMAND_TYPE="TITAN_WORKFORCE_RUNTIME_COMMAND";
const STATE_TYPE="TITAN_WORKFORCE_RUNTIME_STATE";
const PANEL_BRIDGE_TYPE="TITAN_SINGLE_TAB_PANEL_BRIDGE";
let snapshot=null;
let timer=null;
let conversationCandidates=[];
let lastDiagnostics=null;
let lastPreflight=null;
let lastExtensionDiagnostics=null;
let lastUiError=null;

const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
const esc=v=>String(v??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
function fmtTime(value){
 if(!value)return "—";
 const d=new Date(value);
 return Number.isNaN(d.getTime())?"—":d.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"});
}
function fmtGate(value){
 if(!value)return "—";
 const delta=Number(value)-Date.now();
 if(delta<=0)return "due";
 const min=Math.floor(delta/60000),sec=Math.floor((delta%60000)/1000);
 return (min?min+"m ":"")+sec+"s";
}
async function command(action,payload={}){
 const response=await chrome.runtime.sendMessage({type:COMMAND_TYPE,action,payload});
 if(!response?.ok)throw Object.assign(new Error(response?.error||"Background workforce command failed"),{code:response?.code||null});
 if(response.snapshot)snapshot=response.snapshot;
 render();
 return response;
}
async function refresh(){
 try{
  const response=await command("snapshot");
  snapshot=response.result||response.snapshot||snapshot;
  lastUiError=null;
  render();
  return snapshot;
 }catch(error){
  lastUiError=error;
  render();
  return null;
 }
}
function agents(executionClass=null){
 const list=snapshot?.agents||Object.values(snapshot?.state?.agents||{});
 return executionClass?list.filter(a=>a.executionClass===executionClass):list;
}
function diagnostics(){
 return snapshot?.diagnostics||lastDiagnostics||null;
}
function diagnosticAgent(id){
 return diagnostics()?.agents?.find?.(a=>a.id===id)||null;
}
function missionFor(id){return (snapshot?.missions||[]).find(m=>m.id===id)||null}
function lifecycleFor(id){const rows=snapshot?.conversationLifecycle;return Array.isArray(rows)?rows.find(x=>x.agentId===id)||null:null}
export function missionStage(status){
 const s=String(status||"").toLowerCase();
 if(/accept/.test(s))return "Acceptance";
 if(/runtime/.test(s))return "Runtime";
 if(/git|ci|merge|pr/.test(s))return "Git / CI";
 if(/orchestr/.test(s))return "Orchestrator QA";
 if(/codex|build|implementation|ready-for-codex/.test(s))return "Build";
 if(/review|supervisor/.test(s))return "Review";
 return "Research";
}
async function discoverConversations(){
 const response=await command("discoverConversations");
 conversationCandidates=Array.isArray(response.result)?response.result:[];
 render();
 return conversationCandidates;
}
async function bindAgent(id,tabId){
 const n=Number(tabId);
 if(!String(tabId??"").trim()||!Number.isSafeInteger(n)||n<0)throw new Error("Choose a ChatGPT conversation first");
 await command("bindAgentConversation",{id,tabId:n});
 await refresh();
}
async function runDiagnostics(){
 const response=await command("diagnostics");
 const background=response.result||response.snapshot?.diagnostics||null;
 let extensionRuntime=null;
 if(typeof globalThis.runTitanExtensionDiagnostics==="function"){
  try{extensionRuntime=await globalThis.runTitanExtensionDiagnostics()}
  catch(error){
   extensionRuntime={
    ok:false,
    criticalFailures:["extension diagnostics exception"],
    error:String(error?.message||error)
   };
  }
 }
 lastExtensionDiagnostics=extensionRuntime;
 lastDiagnostics=background&&typeof background==="object"
  ?{...background,extensionRuntime}
  :background;
 render();
 return lastDiagnostics;
}
async function runPreflight(){
 if(typeof globalThis.runTitanPreflight!=="function")throw new Error("Preflight module is not available");
 lastPreflight=await globalThis.runTitanPreflight();
 lastExtensionDiagnostics=lastPreflight?.extensionRuntime||lastExtensionDiagnostics;
 render();
 return lastPreflight;
}
async function safe(fn){
 try{lastUiError=null;await fn()}catch(error){lastUiError=error;render()}
}

const facade={
 remote:true,
 get state(){return snapshot?.state||{}},
 controller:{
  registry:{list:executionClass=>clone(agents(executionClass)),get:id=>clone(agents().find(a=>a.id===id)||null)},
  arm:()=>command("arm"),
  disarm:reason=>command("disarm",{reason}),
  emergencyStop:reason=>command("emergencyStop",{reason}),
  clearEmergencyStop:options=>command("clearEmergencyStop",options||{}),
  markReconciled:evidence=>command("markReconciled",{evidence})
 },
 missions:{
  list:()=>clone(snapshot?.missions||[]),
  upsert:mission=>command("missionUpsert",{mission})
 },
 services:{status:()=>clone(snapshot?.services||{})},
 mcp:{status:()=>clone(snapshot?.mcp||{count:0,online:0,tools:0})},
 capabilities:{status:()=>clone(snapshot?.capabilities||{count:0,healthy:0,failing:0})},
 usageGovernor:{status:()=>clone(snapshot?.usage||null),clearRestriction:()=>command("usageClearRestriction")},
 controls:{
  pauseAgent:(id,reason)=>command("pauseAgent",{id,reason}),
  resumeAgent:id=>command("resumeAgent",{id}),
  quarantine:(id,reason)=>command("quarantineAgent",{id,reason}),
  unquarantine:(id,approved=true)=>command("unquarantineAgent",{id,approved,reason:"cockpit"}),
  pauseSquad:(squad,reason)=>command("pauseSquad",{squad,reason}),
  resumeSquad:squad=>command("resumeSquad",{squad}),
  pauseAll:reason=>command("pauseAll",{reason}),
  resumeAll:()=>command("resumeAll")
 },
 liveChat:{
  bindConversation:(workerId,conversation)=>command("bindConversation",{workerId,conversation}),
  bindAgentConversation:(id,tabId)=>command("bindAgentConversation",{id,tabId}),
  discoverConversations,
  startCycle:(workerId,contract)=>command("startCycle",{workerId,contract}),
  submitCycleReview:payload=>command("submitCycleReview",payload)
 },
 diagnostics:runDiagnostics,
 save:async()=>true,
 snapshot:()=>clone(snapshot),
 refresh,
 command
};
globalThis.TitanDeveloperWorkforce=facade;
globalThis.TitanDeveloperWorkforceClient=facade;

function summary(){
 const list=agents(),byClass={};
 for(const a of list)byClass[a.executionClass]=(byClass[a.executionClass]||0)+1;
 return {
  total:list.length,
  active:list.filter(a=>!["idle","verified","complete"].includes(a.status)).length,
  byClass,
  armed:!!snapshot?.state?.controls?.armed,
  emergencyStop:!!snapshot?.state?.controls?.emergencyStop,
  owner:snapshot?.owner||"background-service-worker"
 };
}
function ensurePanel(){
 let el=document.getElementById("titan-dev-workforce");
 if(!el){el=document.createElement("section");el.id="titan-dev-workforce";document.body.appendChild(el)}
 let toggle=document.getElementById("titan-dev-workforce-toggle");
 if(!toggle){toggle=document.createElement("button");toggle.id="titan-dev-workforce-toggle";toggle.type="button";toggle.textContent="Titan";toggle.title="Show Titan controls";toggle.style.cssText="position:fixed;right:8px;top:8px;z-index:2147483647;display:none;padding:6px 10px;border-radius:999px";toggle.addEventListener("click",()=>{el.style.display="block";toggle.style.display="none"});document.body.appendChild(toggle)}
 return el;
}
function serviceSummary(d){
 const entries=Object.entries(d?.services||{});
 if(!entries.length)return "No service status";
 return entries.map(([name,s])=>`${esc(name)}:${s.available?"✓":"–"}${s.source?" "+esc(s.source):""}`).join(" · ");
}
function controlButtons(a){
 const d=diagnosticAgent(a.id)||{},state=d.state||a.status,quarantined=state==="quarantined",paused=state==="paused";
 return `<span class="agent-actions">
  ${paused?`<button data-action="resume-agent" data-agent="${esc(a.id)}">Resume</button>`:`<button data-action="pause-agent" data-agent="${esc(a.id)}">Pause</button>`}
  ${quarantined?`<button data-action="unquarantine-agent" data-agent="${esc(a.id)}">Unquarantine</button>`:`<button data-action="quarantine-agent" data-agent="${esc(a.id)}">Quarantine</button>`}
 </span>`;
}
function bindingUi(a,d){
 if(!["chat_worker","work_supervisor"].includes(a.executionClass))return "";
 const bound=d?.conversation,life=lifecycleFor(a.id);
 const options=conversationCandidates.map(x=>`<option value="${x.tabId}" ${bound?.tabId===x.tabId?"selected":""}>${esc(x.title||x.key)} [${x.tabId}]</option>`).join("");
 const lifeText=life?`<small class="muted">age ${Math.round((life.metrics?.ageMs||0)/3600000)}h · cycles ${life.metrics?.cycles||0} · context ${Math.round((life.metrics?.contextCharacters||0)/1000)}k · failures ${life.metrics?.failures||0}${life.rotate?" · ROTATE: "+esc((life.reasons||[]).join(", ")):""}</small>`:"";
 return `<div class="binding"><span>${bound?`Bound: ${esc(bound.title||bound.key)} [${bound.tabId||"?"}]`:"Unbound conversation"}</span>${bound?`<button data-action="rotate-conversation" data-agent="${esc(a.id)}">Rotate${life?.rotate?" ⚠":""}</button>`:""}${conversationCandidates.length?`<select data-bind-select="${esc(a.id)}"><option value="">Choose conversation…</option>${options}</select><button data-action="bind-agent" data-agent="${esc(a.id)}">Bind</button>`:""}${lifeText}</div>`;
}
function stateDetails(a,d){
 if(a.executionClass==="chat_worker"){
  const x=d?.chat||{};
  return `Cycle ${esc(x.cycleId||"—")} · pass ${x.pass||0}/5 · completed ${x.completedPasses||0} · gate ${fmtGate(x.nextGateAt)} · ${esc(x.schedulerState||"—")}`;
 }
 if(a.executionClass==="work_supervisor"){
  const x=d?.supervisor||{};
  return `Review ${esc(x.reviewStatus||"idle")} · worker ${esc(x.workerId||"—")} · cycle ${esc(x.cycleId||"—")}`;
 }
 if(a.executionClass==="codex_builder"){
  const x=d?.builder||{};
  const pr=typeof x.pr==="object"?(x.pr.number||x.pr.url||"set"):(x.pr||"—");
  const ci=typeof x.ci==="object"?(x.ci.status||x.ci.conclusion||"set"):(x.ci||"—");
  return `Phase ${esc(x.phase||"idle")} · branch ${esc(x.branch||"—")} · PR ${esc(pr)} · CI ${esc(ci)}`;
 }
 const x=d?.orchestrator||{};
 const decision=typeof x.decision==="object"?(x.decision.state||x.decision.decision||JSON.stringify(x.decision)):x.decision;
 return `Phase ${esc(x.phase||"idle")} · decision ${esc(decision||"—")}`;
}
function agentCard(a){
 const d=diagnosticAgent(a.id)||{},mission=missionFor(a.missionId||d.missionId);
 const profiles=(d.profileIds||a.profileIds||[]).join(", ")||"none",reason=mission?.statusReason||mission?.blocker||null;
 return `<article class="agent-card" data-class="${esc(a.executionClass)}"><div class="agent-head"><b>${esc(a.id)}</b><span class="pill">${esc(d.state||a.status||"idle")}</span></div><div class="muted">${esc(a.executionClass)}${a.squad?` · Squad ${esc(a.squad)}`:""} · health ${esc(d.health||a.health||"unknown")}</div><div>Mission: ${esc(d.missionTitle||a.missionId||"—")}${d.missionStatus?` · ${esc(d.missionStatus)}`:""}</div>${mission?`<div><b>Stage:</b> ${esc(missionStage(mission.status))}${reason?` · <span class="blocked-reason">${esc(reason)}</span>`:""}</div>`:""}<div>Profiles: ${esc(profiles)}</div><div class="runtime-line">${stateDetails(a,d)}</div>${bindingUi(a,d)}<div>${controlButtons(a)}</div></article>`;
}
function group(title,list){
 return `<details open><summary><b>${esc(title)}</b> · ${list.length}</summary><div class="agent-grid">${list.map(agentCard).join("")}</div></details>`;
}
function renderStatusBlock(){
 const d=diagnostics(),services=d?.services||snapshot?.services||{},usage=d?.usage||snapshot?.usage||null;
 const extensionRuntime=d?.extensionRuntime||lastExtensionDiagnostics||lastPreflight?.extensionRuntime||null;
 const merge=d?.mergePressure??snapshot?.mergePressure,verification=d?.verification;
 return `<section class="status-grid">
  <div><b>Extension runtime</b><br>${extensionRuntime?(extensionRuntime.ok?"PASS":"FAIL")+" · "+(extensionRuntime.criticalFailures?.length||0)+" critical":"not checked"}</div>
  <div><b>Services</b><br><span class="muted">${serviceSummary({services})}</span></div>
  <div><b>Native execution</b><br>Builders ${d?.nativeExecution?.buildersReady?"✓":"–"} · Orchestrator ${d?.nativeExecution?.orchestratorReady?"✓":"–"} · ${esc(d?.nativeExecution?.codexSource||"no codex source")}</div>
  <div><b>Verification backlog</b><br>${verification?.count??0}${verification?.backlog?.length?` · ${verification.backlog.map(x=>esc(x.id+":"+x.status)).join(", ")}`:""}</div>
  <div><b>Merge pressure</b><br>${esc(typeof merge==="object"?JSON.stringify(merge):merge||"none")}</div>
  ${usage?`<div><b>Usage</b><br>${esc(usage.state||"normal")} · Chat ${usage.policy?.chatConcurrency??"?"}/10 · Codex ${usage.policy?.codexConcurrency??"?"}/2 · Context ${Math.round((usage.policy?.contextScale??1)*100)}%</div>`:""}
 </section>`;
}
function renderMissionOperations(){
 const missions=[...(snapshot?.missions||[])].sort((a,b)=>String(a.priority||"P9").localeCompare(String(b.priority||"P9"))||String(a.id).localeCompare(String(b.id)));
 const raw=snapshot?.state?.approvals||[],approvals=Array.isArray(raw)?raw:Object.values(raw),pending=approvals.filter(x=>x&&["pending","requested"].includes(String(x.status||"pending").toLowerCase()));
 const rows=missions.map(m=>{const scope=[...(m.scopePaths||m.scope_paths||[])],verification=m.verification||snapshot?.state?.verification?.[m.id]||null,gates=verification?.gates?Object.entries(verification.gates).map(([k,v])=>k+":"+String(v?.status||"pending")).join(" · "):"—",reason=m.statusReason||m.blocker||"";return `<div class="mission-row"><b>${esc(m.id)}</b> · ${esc(m.title||"")}<br><span class="muted">${esc(missionStage(m.status))} · ${esc(m.status||"unknown")} · agent ${esc(m.assignedAgent||"—")}${reason?" · "+esc(reason):""}</span><br><span class="muted">Scope: ${esc(scope.join(", ")||"—")} · Git/CI/runtime/acceptance: ${esc(gates)}</span></div>`}).join("");
 return `<details open><summary><b>Mission queue, approvals, scope & evidence</b> · ${missions.length} missions · ${pending.length} approvals</summary><div class="mission-list">${rows||"<span class=\"muted\">No missions</span>"}</div></details>`;
}
function renderPreflight(){
 if(!lastPreflight)return "";
 const failed=lastPreflight.checks?.filter(x=>!x.ok)||[];
 return `<section class="result ${lastPreflight.ok?"ok":"bad"}"><b>Preflight ${lastPreflight.ok?"PASS":"FAIL"}</b> · ${failed.length} failed${failed.length?`<br><span class="muted">${failed.map(x=>esc(x.name+(x.detail?" — "+x.detail:""))).join("<br>")}</span>`:""}</section>`;
}
function renderError(){
 if(!lastUiError)return "";
 return `<section class="result bad"><b>Control error</b><br>${esc(lastUiError.code?lastUiError.code+": ":"")}${esc(lastUiError.message||lastUiError)}</section>`;
}
function renderSingleTabTaskControl(){
 const task=snapshot?.singleTabTasks||snapshot?.state?.singleTabTaskPump||{};
 const bound=task.conversation||null;
 const rows=(task.subtasks||[]).map((x,i)=>`<div class="mission-row"><b>${esc(x.id||"S"+(i+1))}</b> · ${esc(x.title||"")} <span class="pill">${esc(x.status||"queued")}</span></div>`).join("");
 const phase=task.phase||"unbound",status=task.enabled?"RUNNING":"PAUSED";
 return `<details open><summary><b>ChatGPT extension · single-tab runner</b> · ${esc(status)} · ${esc(phase)} · ${task.currentIndex||0}/10</summary>
  <div class="muted">Bind the active browser tab, then choose <b>Use ChatGPT</b> and give the task in this extension's ChatGPT conversation. Keep this side panel open while the timed runner is active.</div>
  <div class="binding">
   <label for="tdw-single-tab-interval">Interval (minutes)</label><input id="tdw-single-tab-interval" type="number" min="1" max="1440" value="${esc(task.intervalMinutes||10)}" style="width:72px">
   <button data-action="single-tab-bind">Bind active tab</button><button data-action="single-tab-start">${task.enabled?"Restart cadence":"Start"}</button><button data-action="single-tab-pause">Pause</button><button data-action="single-tab-clear">Clear</button>
  </div>
  <div class="muted">Bound tab: ${esc(bound?.title||bound?.key||"none")} · next check: ${esc(fmtTime(task.nextRunAt))} · last check: ${esc(fmtTime(task.lastCheckAt))}</div>
  <div class="mission-list">${rows||"<span class=\"muted\">No 10-step plan yet.</span>"}</div>
  ${task.lastError?`<div class="result bad">${esc(task.lastError.code||"Error")}: ${esc(task.lastError.message||"")}</div>`:""}
 </details>`;
}
function render(){
 const el=ensurePanel();
 if(!snapshot){el.innerHTML=`<style>${styles()}</style><b>Developer Workforce</b><div>Background runtime unavailable</div>${renderError()}<button id="tdw-refresh">Retry</button>`;el.querySelector("#tdw-refresh").onclick=()=>refresh();return}
 const s=summary(),list=agents();
 el.innerHTML=`<style>${styles()}</style><header><div><b>Developer Workforce · ${s.total} agents</b><div class="muted">${esc(s.owner)} · ${s.armed?"ARMED":"DISARMED"}${s.emergencyStop?" · E-STOP":""} · active ${s.active}/${s.total}</div></div></header>${renderError()}${renderPreflight()}<nav class="toolbar"><button data-action="use-chatgpt">Use ChatGPT</button><button data-action="${s.armed?"disarm":"arm"}">${s.armed?"Disarm":"Arm"}</button><button data-action="estop" class="danger">E-STOP</button><button data-action="pause-all">Pause all</button><button data-action="resume-all">Resume all</button><button data-action="quarantine-all">Quarantine all</button><button data-action="unquarantine-all">Unquarantine all</button><button data-action="discover">Discover conversations</button><button data-action="diagnostics">Diagnostics</button><button data-action="preflight">Preflight</button><button data-action="refresh">Refresh</button></nav><nav class="toolbar"><b>Squads:</b> A <button data-action="pause-squad" data-squad="A">Pause</button><button data-action="resume-squad" data-squad="A">Resume</button><button data-action="quarantine-squad" data-squad="A">Quarantine</button><button data-action="unquarantine-squad" data-squad="A">Unquarantine</button> B <button data-action="pause-squad" data-squad="B">Pause</button><button data-action="resume-squad" data-squad="B">Resume</button><button data-action="quarantine-squad" data-squad="B">Quarantine</button><button data-action="unquarantine-squad" data-squad="B">Unquarantine</button></nav><div class="topology">Chat workers ${s.byClass.chat_worker||0} · Work supervisors ${s.byClass.work_supervisor||0} · Codex builders ${s.byClass.codex_builder||0} · Codex orchestrator ${s.byClass.codex_orchestrator||0}</div>${renderStatusBlock()}${conversationCandidates.length?`<div class="result ok">Discovered ${conversationCandidates.length} ChatGPT conversations.</div>`:""}${renderMissionOperations()}${renderSingleTabTaskControl()}${group("Squad A · A1–A5 + Supervisor A",list.filter(a=>a.squad==="A"))}${group("Squad B · B1–B5 + Supervisor B",list.filter(a=>a.squad==="B"))}${group("Codex builders",list.filter(a=>a.executionClass==="codex_builder"))}${group("Codex orchestrator",list.filter(a=>a.executionClass==="codex_orchestrator"))}`;
 wire(el,s);
}
function styles(){return `
 #titan-dev-workforce{position:fixed;right:8px;top:8px;z-index:2147483646;width:min(780px,calc(100vw - 16px));max-height:94vh;overflow:auto;background:Canvas;color:CanvasText;border:1px solid #8885;border-radius:12px;padding:10px;font:12px system-ui;box-shadow:0 8px 30px #0003}
 #titan-dev-workforce *{box-sizing:border-box}#titan-dev-workforce header{display:flex;justify-content:space-between;gap:8px;margin-bottom:6px}
 #titan-dev-workforce button,#titan-dev-workforce select{font:inherit;margin:2px;padding:3px 6px}
 #titan-dev-workforce .toolbar{display:flex;align-items:center;gap:2px;flex-wrap:wrap;border-top:1px solid #8883;padding:5px 0}
 #titan-dev-workforce .danger{font-weight:700}.muted{opacity:.72}.topology{padding:5px 0}
 #titan-dev-workforce details{border-top:1px solid #8883;padding:5px 0}#titan-dev-workforce summary{cursor:pointer}
 #titan-dev-workforce .agent-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:5px;margin-top:5px}
 #titan-dev-workforce .agent-card{border:1px solid #8884;border-radius:8px;padding:6px}
 #titan-dev-workforce .agent-head{display:flex;justify-content:space-between}.pill{border:1px solid #8885;border-radius:999px;padding:1px 5px}
 #titan-dev-workforce .runtime-line{margin:3px 0}.binding{display:flex;gap:3px;align-items:center;flex-wrap:wrap}.binding select{max-width:300px}
 #titan-dev-workforce .status-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:4px;border-top:1px solid #8883;padding:5px 0}#titan-dev-workforce .mission-list{display:grid;gap:4px;margin-top:4px}.mission-row{border:1px solid #8884;border-radius:8px;padding:6px}.blocked-reason{font-weight:600}
 #titan-dev-workforce .result{border-radius:6px;padding:5px;margin:4px 0}.result.ok{background:color-mix(in srgb,CanvasText 8%,Canvas)}.result.bad{border:1px solid #c44}
 `}
function wire(el,s){
 el.querySelectorAll("[data-action]").forEach(button=>button.addEventListener("click",()=>safe(async()=>{
  const action=button.dataset.action,agent=button.dataset.agent,squad=button.dataset.squad;
  if(action==="arm")await command("arm");
  else if(action==="disarm")await command("disarm",{reason:"cockpit"});
  else if(action==="estop"){if(confirm("Emergency stop the Titan workforce?"))await command("emergencyStop",{reason:"cockpit"})}
  else if(action==="pause-all")await command("pauseAll",{reason:"cockpit"});
  else if(action==="resume-all")await command("resumeAll");
  else if(action==="quarantine-all"){if(confirm("Quarantine all non-terminal agents?"))await command("quarantineAll",{reason:"cockpit-global"})}
  else if(action==="unquarantine-all"){if(confirm("Unquarantine all agents? This is an explicit approval."))await command("unquarantineAll",{approved:true,reason:"cockpit-global-approval"})}
  else if(action==="pause-squad")await command("pauseSquad",{squad,reason:"cockpit"});
  else if(action==="resume-squad")await command("resumeSquad",{squad});
  else if(action==="quarantine-squad"){if(confirm("Quarantine Squad "+squad+"?"))await command("quarantineSquad",{squad,reason:"cockpit-squad"})}
  else if(action==="unquarantine-squad"){if(confirm("Unquarantine Squad "+squad+"? This is an explicit approval."))await command("unquarantineSquad",{squad,approved:true,reason:"cockpit-squad-approval"})}
  else if(action==="pause-agent")await command("pauseAgent",{id:agent,reason:"cockpit"});
  else if(action==="resume-agent")await command("resumeAgent",{id:agent});
  else if(action==="quarantine-agent"){const reason=prompt("Quarantine reason","manual cockpit quarantine");if(reason!==null)await command("quarantineAgent",{id:agent,reason})}
  else if(action==="unquarantine-agent"){if(confirm("Unquarantine "+agent+"? This is an explicit approval."))await command("unquarantineAgent",{id:agent,approved:true,reason:"cockpit approval"})}
  else if(action==="bind-agent"){const select=el.querySelector(`[data-bind-select="${CSS.escape(agent)}"]`);await bindAgent(agent,select?.value)}
  else if(action==="single-tab-bind"){const intervalMinutes=Number(el.querySelector("#tdw-single-tab-interval")?.value);await command("singleTabBind",{intervalMinutes});}
  else if(action==="single-tab-start"){const intervalMinutes=Number(el.querySelector("#tdw-single-tab-interval")?.value);await command("singleTabStart",{intervalMinutes});}
  else if(action==="use-chatgpt"){el.style.display="none";const toggle=el.ownerDocument.getElementById("titan-dev-workforce-toggle");if(toggle)toggle.style.display="block"}
  else if(action==="single-tab-pause")await command("singleTabPause",{reason:"sidepanel"});
  else if(action==="single-tab-clear"){if(confirm("Clear the single-tab plan and history?"))await command("singleTabClear")}
  else if(action==="rotate-conversation"){if(confirm("Rotate "+agent+" to a fresh conversation using a compact checkpoint?"))await command("rotateConversation",{id:agent,createIfMissing:true,active:false})}
  else if(action==="discover")await discoverConversations();
  else if(action==="diagnostics")await runDiagnostics();
  else if(action==="preflight")await runPreflight();
  else if(action==="refresh")await refresh();
 })));
}
chrome.runtime.onMessage.addListener((message,_sender,sendResponse)=>{
 if(message?.type===PANEL_BRIDGE_TYPE){
  try{
   if(message.action==="probe")sendResponse({ok:true,result:pageProbe()});
   else if(message.action==="send"){
    const before=pageProbe();
    if(before.generating)sendResponse({ok:false,code:"CONVERSATION_BUSY",error:"ChatGPT is still generating"});
    else if(!sendPrompt(String(message.payload?.instruction||"")))sendResponse({ok:false,code:"PANEL_COMPOSER_UNAVAILABLE",error:"ChatGPT composer is unavailable"});
    else sendResponse({ok:true,result:{sent:true}});
   }else sendResponse({ok:false,error:"Unknown panel bridge action"});
  }catch(error){sendResponse({ok:false,error:String(error?.message||error),code:error?.code||"PANEL_BRIDGE_ERROR"})}
  return false;
 }
 if(message?.type!==STATE_TYPE)return false;
 if(message.snapshot){snapshot=message.snapshot;lastDiagnostics=snapshot.diagnostics||lastDiagnostics;render()}
 return false;
});
refresh();
timer=setInterval(refresh,5000);
window.addEventListener("pagehide",()=>{if(timer)clearInterval(timer)},{once:true});
