const COCKPIT_CSS="#titan-dev-workforce{position:fixed;right:10px;top:10px;z-index:2147483646;width:360px;max-height:80vh;overflow:auto;background:Canvas;color:CanvasText;border:1px solid #8885;border-radius:12px;padding:10px;font:12px system-ui;box-shadow:0 8px 30px #0003}#titan-dev-workforce .a{display:flex;justify-content:space-between;border-top:1px solid #8883;padding:3px 0}#titan-dev-workforce button{margin:2px}";

export function workforceSummary(api){
 const agents=api.controller.registry.list(),missions=api.missions.list();
 const byClass=Object.fromEntries(["chat_worker","work_supervisor","codex_builder","codex_orchestrator"].map(c=>[c,agents.filter(a=>a.executionClass===c).length]));
 return {agents:agents.length,byClass,active:agents.filter(a=>!["idle","verified","complete"].includes(a.status)).length,missions:missions.length,missionStates:Object.fromEntries([...new Set(missions.map(m=>m.status))].map(s=>[s,missions.filter(m=>m.status===s).length])),services:api.services.status(),armed:api.state.controls.armed,emergencyStop:api.state.controls.emergencyStop};
}

export function agentSummaryText(agent){
 return `${String(agent?.executionClass||"unknown")} · ${String(agent?.status||"unknown")}${agent?.missionId?" · "+String(agent.missionId):""}`;
}

function addTextElement(parent,tag,text,{className=null,id=null}={}){
 const node=document.createElement(tag);
 if(className)node.className=className;
 if(id)node.id=id;
 node.textContent=String(text);
 parent.appendChild(node);
 return node;
}

export function renderEngineeringCockpit(element,api){
 const s=workforceSummary(api),agents=api.controller.registry.list();
 element.replaceChildren();

 const style=document.createElement("style");style.textContent=COCKPIT_CSS;element.appendChild(style);
 addTextElement(element,"b","Developer Workforce · 15 agents");
 addTextElement(element,"div",`${s.armed?"ARMED":"DISARMED"}${s.emergencyStop?" · E-STOP":""} · active ${s.active}/${s.agents}`);
 addTextElement(element,"div",`Chat ${s.byClass.chat_worker} · Work ${s.byClass.work_supervisor} · Builders ${s.byClass.codex_builder} · Orch ${s.byClass.codex_orchestrator}`);

 const agentsBox=document.createElement("div");element.appendChild(agentsBox);
 for(const agent of agents){
  const row=document.createElement("div");row.className="a";
  const span=document.createElement("span");
  const id=document.createElement("span");id.textContent=String(agent.id||"");span.appendChild(id);
  span.appendChild(document.createElement("br"));
  const small=document.createElement("small");small.textContent=agentSummaryText(agent);span.appendChild(small);
  row.appendChild(span);agentsBox.appendChild(row);
 }

 const arm=document.createElement("button");arm.id="tdw-arm";arm.textContent=s.armed?"Disarm":"Arm";
 arm.onclick=()=>{s.armed?api.controller.disarm():api.controller.arm();api.save();renderEngineeringCockpit(element,api)};
 element.appendChild(arm);

 const stop=document.createElement("button");stop.id="tdw-stop";stop.textContent="E-STOP";
 stop.onclick=()=>{api.controller.emergencyStop();api.save();renderEngineeringCockpit(element,api)};
 element.appendChild(stop);
 return element;
}

export function installEngineeringCockpit(api){
 let el=document.getElementById("titan-dev-workforce");
 if(!el){el=document.createElement("div");el.id="titan-dev-workforce";document.body.appendChild(el)}
 const render=()=>renderEngineeringCockpit(el,api);
 render();window.addEventListener("titan-workforce:audit",render);return {render,element:el};
}
