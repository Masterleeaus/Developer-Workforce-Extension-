import {createTitanWorkforceRuntime} from "./runtime-core.js";
import {TitanRuntimeOwner,RUNTIME_ALARM} from "./runtime-owner.js";

const MESSAGE_TYPE="TITAN_WORKFORCE_RUNTIME_COMMAND";
const STATE_TYPE="TITAN_WORKFORCE_RUNTIME_STATE";

function notify(payload){
 try{chrome.runtime.sendMessage({type:STATE_TYPE,...payload}).catch(()=>{})}catch{}
}

export const owner=new TitanRuntimeOwner({
 createRuntime:()=>createTitanWorkforceRuntime({startTimer:false}),
 alarms:chrome.alarms,
 runtime:chrome.runtime,
 periodInMinutes:1,
 notify
});

globalThis.TitanBackgroundWorkforceRuntime=owner;

async function start(reason){
 await owner.ensureAlarm();
 const api=await owner.ensure();
 await api.save();
 notify({type:"ready",reason,snapshot:owner.snapshot(api)});
 return api;
}

chrome.alarms.onAlarm.addListener(alarm=>{
 if(alarm?.name!==RUNTIME_ALARM)return;
 owner.tick("alarm").catch(error=>{
  console.error("[Titan Workforce] background tick failed",error);
  notify({type:"error",operation:"tick",message:String(error?.message||error)});
 });
});

chrome.runtime.onStartup?.addListener(()=>{start("startup").catch(()=>{})});
chrome.runtime.onInstalled?.addListener(()=>{start("installed").catch(()=>{})});
chrome.runtime.onSuspend?.addListener(()=>{owner.suspend().catch(()=>{})});

chrome.runtime.onMessage.addListener((message,_sender,sendResponse)=>{
 if(message?.type!==MESSAGE_TYPE)return false;
 owner.command(message.action,message.payload||{}).then(
  result=>sendResponse(result),
  error=>sendResponse({ok:false,error:String(error?.message||error),code:error?.code||null,snapshot:owner.snapshot()})
 );
 return true;
});

start("service-worker-load").catch(error=>{
 console.error("[Titan Workforce] background runtime bootstrap failed",error);
 notify({type:"error",operation:"bootstrap",message:String(error?.message||error)});
});
