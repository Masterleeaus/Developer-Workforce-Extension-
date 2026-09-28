export function workforceSummary(api){
 const agents=api.controller.registry.list(),missions=api.missions.list();
 const byClass=Object.fromEntries(["chat_worker","work_supervisor","codex_builder","codex_orchestrator"].map(c=>[c,agents.filter(a=>a.executionClass===c).length]));
 const preflight=globalThis.__titanPreflight||null;
 return {
  agents:agents.length,
  byClass,
  active:agents.filter(a=>!["idle","verified","complete"].includes(a.status)).length,
  missions:missions.length,
  missionStates:Object.fromEntries([...new Set(missions.map(m=>m.status))].map(s=>[s,missions.filter(m=>m.status===s).length])),
  services:api.services.status(),
  armed:api.state.controls.armed,
  emergencyStop:api.state.controls.emergencyStop,
  preflight:{ran:!!preflight,ok:preflight?.ok===true,criticalFailures:preflight?.criticalFailures||[]}
 };
}
export function installEngineeringCockpit(api){
 let el=document.getElementById("titan-dev-workforce");
 if(!el){el=document.createElement("div");el.id="titan-dev-workforce";document.body.appendChild(el)}
 const render=()=>{
  const s=workforceSummary(api),agents=api.controller.registry.list();
  el.innerHTML=`<style>#titan-dev-workforce{position:fixed;right:10px;top:10px;z-index:2147483646;width:360px;max-height:80vh;overflow:auto;background:Canvas;color:CanvasText;border:1px solid #8885;border-radius:12px;padding:10px;font:12px system-ui;box-shadow:0 8px 30px #0003}#titan-dev-workforce .a{display:flex;justify-content:space-between;border-top:1px solid #8883;padding:3px 0}#titan-dev-workforce button{margin:2px}</style><b>Developer Workforce · 15 agents</b><div>${s.armed?"ARMED":"DISARMED"}${s.emergencyStop?" · E-STOP":""} · active ${s.active}/${s.agents}</div><div>Chat ${s.byClass.chat_worker} · Work ${s.byClass.work_supervisor} · Builders ${s.byClass.codex_builder} · Orch ${s.byClass.codex_orchestrator}</div><div>Preflight ${s.preflight.ran?(s.preflight.ok?"PASS":"FAIL"):"NOT RUN"}${s.preflight.criticalFailures.length?" · "+s.preflight.criticalFailures.length+" critical":""}</div><div>${agents.map(a=>`<div class="a"><span>${a.id}<br><small>${a.executionClass} · ${a.status} ${a.missionId?"· "+a.missionId:""}</small></span></div>`).join("")}</div><button id="tdw-arm">${s.armed?"Disarm":"Arm"}</button><button id="tdw-stop">E-STOP</button><button id="tdw-preflight">Preflight</button>`;
  el.querySelector("#tdw-arm").onclick=()=>{s.armed?api.controller.disarm():api.controller.arm();api.save();render()};
  el.querySelector("#tdw-stop").onclick=()=>{api.controller.emergencyStop();api.save();render()};
  el.querySelector("#tdw-preflight").onclick=async()=>{
   const r=await globalThis.runTitanPreflight?.();
   render();
   if(r){
    const failures=(r.checks||[]).filter(x=>x.status==="fail"||(x.status==="unavailable"&&x.critical));
    alert(`Titan preflight ${r.ok?"PASS":"FAIL"}\n${failures.length?failures.map(x=>`• ${x.name}: ${x.detail}`).join("\n"):"No critical failures"}`);
   }
  };
 };
 render();
 window.addEventListener("titan-workforce:audit",render);
 window.addEventListener("titan:preflight",render);
 return {render,element:el};
}
