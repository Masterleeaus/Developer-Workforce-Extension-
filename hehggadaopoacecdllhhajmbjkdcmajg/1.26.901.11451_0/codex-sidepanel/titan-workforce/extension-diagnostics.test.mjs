import assert from "node:assert/strict";
import {runExtensionDiagnostics,DIAGNOSTIC_STATUS} from "./extension-diagnostics.js";

function fakeRoot({missing=new Set(),nativeError=null}={}){
 const resources=new Map();
 resources.set("background.js",'CODEX_WORK_SIDE_PANEL_AUTH_OPEN CODEX_WORK_SIDE_PANEL_AUTH_STATE SHOW_CODEX_INSTALLER content-scripts/codex.js content-scripts/foreign-frame-monitor.js');
 resources.set("chunks/codex-work-sidepanel-0JzHpPDf.js",'CODEX_WORK_SIDE_PANEL_AUTH_REVALIDATE CODEX_WORK_SIDE_PANEL_AUTH_STATE microphone-permission.html');
 resources.set("codex/build-info.json",JSON.stringify({release_channel:"stable",sha:"abc"}));
 const required=[
  "codex-sidepanel/index.html","codex-work-sidepanel.html","content-scripts/chatgpt-website.js",
  "content-scripts/codex.js","content-scripts/foreign-frame-monitor.js",
  "content-scripts/codex-work-media-permission.js","microphone-permission.html"
 ];
 for(const p of required)if(!resources.has(p))resources.set(p,"ok");
 const chrome={
  runtime:{
   id:"ext-id",
   getURL:p=>"chrome-extension://ext-id/"+p,
   getManifest:()=>({name:"Developer Workforce Extension",version:"4.0.0"}),
   async sendMessage(msg){
    assert.equal(msg.type,"GET_CHATGPT_EXTENSION_STATUS");
    return {ok:true,state:{
     extension:{version:"4.0.0"},
     capabilities:{"sidePanel.open":true,"website.action.request":true,"nativeHost.status":true,"extension.update.read":true},
     nativeHost:nativeError?{transport:"closed",errorType:nativeError}:{transport:"connected"},
     browserContext:{instanceId:"instance-1"}
    }};
   }
  },
  sidePanel:{},storage:{local:{},session:{}},scripting:{},tabs:{},debugger:{},declarativeNetRequest:{},
  permissions:{async contains(){return true}}
 };
 const fetch=async url=>{
  const p=new URL(url).pathname.replace(/^\//,"");
  if(missing.has(p)||p.startsWith("content-scripts/webmcp"))return {ok:false,status:404,async text(){return""}};
  return {ok:true,status:200,async text(){return resources.get(p)||"ok"}};
 };
 const services={};
 for(const k of ["chat","work","codex","github","repository","runtime"])services[k]={available:true,source:k==="codex"?"conversation-fallback":"test",capabilities:["x"]};
 const agents=Array.from({length:15},(_,i)=>({id:String(i)}));
 return {
  chrome,fetch,
  TitanDeveloperWorkforce:{services:{status:()=>services},controller:{registry:{list:()=>agents}}}
 };
}

{
 const root=fakeRoot();
 const r=await runExtensionDiagnostics({root,chromeApi:root.chrome,fetchImpl:root.fetch});
 assert.equal(r.ok,true);
 const webmcp=r.checks.find(x=>x.name==="Upstream WebMCP content scripts");
 assert.equal(webmcp.status,DIAGNOSTIC_STATUS.DISABLED);
 assert(!r.criticalFailures.length);
 console.log("ok - healthy runtime with dormant WebMCP");
}
{
 const root=fakeRoot({missing:new Set(["content-scripts/codex.js"])});
 const r=await runExtensionDiagnostics({root,chromeApi:root.chrome,fetchImpl:root.fetch});
 assert.equal(r.ok,false);
 assert(r.criticalFailures.includes("Resource: content-scripts/codex.js"));
 console.log("ok - missing critical runtime resource fails preflight");
}
{
 const root=fakeRoot({nativeError:"native_host_unreachable"});
 const r=await runExtensionDiagnostics({root,chromeApi:root.chrome,fetchImpl:root.fetch});
 const nh=r.checks.find(x=>x.name==="Stock native host / AppServer");
 assert.equal(nh.status,DIAGNOSTIC_STATUS.UNAVAILABLE);
 assert.equal(nh.critical,false);
 assert.equal(r.ok,true);
 console.log("ok - native host failure is surfaced but fallback-capable");
}
{
 const root=fakeRoot();
 const original=root.TitanDeveloperWorkforce.services.status;
 root.TitanDeveloperWorkforce.services.status=()=>({...original(),codex:{available:false,source:null,capabilities:[]}});
 const r=await runExtensionDiagnostics({root,chromeApi:root.chrome,fetchImpl:root.fetch});
 assert.equal(r.ok,false);
 assert(r.criticalFailures.includes("Titan service: codex"));
 console.log("ok - missing critical Titan service fails");
}
console.log("extension diagnostics tests passed");
