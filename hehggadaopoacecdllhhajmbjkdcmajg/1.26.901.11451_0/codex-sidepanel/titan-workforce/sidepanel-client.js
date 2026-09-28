const COMMAND_TYPE="TITAN_WORKFORCE_RUNTIME_COMMAND";
const STATE_TYPE="TITAN_WORKFORCE_RUNTIME_STATE";
let snapshot=null;
let timer=null;

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}
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
  render();
  return snapshot;
 }catch(error){
  renderError(error);
  return null;
 }
}
function agents(executionClass=null){
 const list=snapshot?.agents||Object.values(snapshot?.state?.agents||{});
 return executionClass?list.filter(a=>a.executionClass===executionClass):list;
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
 liveChat:{
  bindConversation:(workerId,conversation)=>command("bindConversation",{workerId,conversation}),
  startCycle:(workerId,contract)=>command("startCycle",{workerId,contract})
 },
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
 if(!el){el=document.createElement("div");el.id="titan-dev-workforce";document.body.appendChild(el)}
 return el;
}
function renderError(error){
 const el=ensurePanel();
 el.innerHTML=`<style>#titan-dev-workforce{position:fixed;right:10px;top:10px;z-index:2147483646;width:360px;background:Canvas;color:CanvasText;border:1px solid #8885;border-radius:12px;padding:10px;font:12px system-ui}</style><b>Developer Workforce</b><div>Background runtime unavailable</div><small>${String(error?.message||error)}</small><br><button id="tdw-refresh">Retry</button>`;
 el.querySelector("#tdw-refresh").onclick=()=>refresh();
}
function render(){
 if(!snapshot){renderError(new Error("Waiting for background workforce runtime"));return}
 const el=ensurePanel(),s=summary(),list=agents(),services=snapshot.services||{};
 const mcp=snapshot.mcp||{count:0,online:0,tools:0},caps=snapshot.capabilities||{count:0,healthy:0,failing:0};
 el.innerHTML=`<style>#titan-dev-workforce{position:fixed;right:10px;top:10px;z-index:2147483646;width:360px;max-height:80vh;overflow:auto;background:Canvas;color:CanvasText;border:1px solid #8885;border-radius:12px;padding:10px;font:12px system-ui;box-shadow:0 8px 30px #0003}#titan-dev-workforce .a{display:flex;justify-content:space-between;border-top:1px solid #8883;padding:3px 0}#titan-dev-workforce button{margin:2px}</style><b>Developer Workforce · ${s.total} agents</b><div>${s.armed?"ARMED":"DISARMED"}${s.emergencyStop?" · E-STOP":""} · active ${s.active}/${s.total}</div><div>Owner: ${s.owner}</div><div>Chat ${s.byClass.chat_worker||0} · Work ${s.byClass.work_supervisor||0} · Builders ${s.byClass.codex_builder||0} · Orch ${s.byClass.codex_orchestrator||0}</div><div>Services ${Object.entries(services).filter(([,v])=>v.available).map(([k])=>k).join(" · ")||"none"}<br>MCP ${mcp.online||0}/${mcp.count||0} online · ${mcp.tools||0} tools<br>Capabilities ${caps.healthy||0}/${caps.count||0} healthy · ${caps.failing||0} failing</div><div>${list.map(a=>`<div class="a"><span>${a.id}<br><small>${a.executionClass} · ${a.status} ${a.missionId?"· "+a.missionId:""}</small></span></div>`).join("")}</div><button id="tdw-arm">${s.armed?"Disarm":"Arm"}</button><button id="tdw-stop">E-STOP</button><button id="tdw-refresh">Refresh</button>`;
 el.querySelector("#tdw-arm").onclick=async()=>{try{s.armed?await command("disarm",{reason:"cockpit"}):await command("arm")}catch(e){renderError(e)}};
 el.querySelector("#tdw-stop").onclick=async()=>{try{await command("emergencyStop",{reason:"cockpit"})}catch(e){renderError(e)}};
 el.querySelector("#tdw-refresh").onclick=()=>refresh();
}
chrome.runtime.onMessage.addListener(message=>{
 if(message?.type!==STATE_TYPE)return false;
 if(message.snapshot){snapshot=message.snapshot;render()}
 return false;
});
refresh();
timer=setInterval(refresh,5000);
window.addEventListener("pagehide",()=>{if(timer)clearInterval(timer)},{once:true});
