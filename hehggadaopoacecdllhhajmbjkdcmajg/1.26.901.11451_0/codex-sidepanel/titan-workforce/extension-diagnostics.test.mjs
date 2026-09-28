import assert from "node:assert/strict";
import {runExtensionDiagnostics,DIAGNOSTIC_STATUS} from "./extension-diagnostics.js";

function fakeRoot({
 missing=new Set(),
 nativeError=null,
 denied=new Set(),
 registeredWebMcp=false,
 statusFailure=false,
 serviceOverrides={}
}={}){
 const resources=new Map();
 resources.set(
  "background.js",
  "GET_CHATGPT_EXTENSION_STATUS CODEX_WORK_SIDE_PANEL_AUTH_OPEN CODEX_WORK_SIDE_PANEL_AUTH_STATE SHOW_CODEX_INSTALLER content-scripts/codex.js content-scripts/foreign-frame-monitor.js"
 );
 resources.set(
  "codex-sidepanel/index.html",
  "titan-workforce/sidepanel-client.js titan-preflight.js"
 );
 resources.set(
  "chunks/codex-work-sidepanel-0JzHpPDf.js",
  "CODEX_WORK_SIDE_PANEL_AUTH_REVALIDATE CODEX_WORK_SIDE_PANEL_AUTH_STATE microphone-permission.html"
 );
 resources.set(
  "codex/build-info.json",
  JSON.stringify({release_channel:"stable",sha:"abc"})
 );
 const required=[
  "codex-sidepanel/index.html",
  "codex-work-sidepanel.html",
  "content-scripts/chatgpt-website.js",
  "content-scripts/codex.js",
  "content-scripts/foreign-frame-monitor.js",
  "content-scripts/codex-work-media-permission.js",
  "microphone-permission.html",
  "background.js"
 ];
 for(const path of required){
  if(!resources.has(path))resources.set(path,"ok");
 }

 const chrome={
  runtime:{
   id:"ext-id",
   getURL:path=>"chrome-extension://ext-id/"+path,
   getManifest:()=>({
    name:"Developer Workforce Extension",
    version:"4.0.0",
    description:"Developer Workforce Extension v4.0.0"
   }),
   async sendMessage(message){
    assert.equal(message.type,"GET_CHATGPT_EXTENSION_STATUS");
    if(statusFailure)throw new Error("service worker unavailable");
    return {ok:true,state:{
     extension:{version:"4.0.0"},
     capabilities:{
      "sidePanel.open":true,
      "website.action.request":true,
      "nativeHost.status":true,
      "extension.update.read":true
     },
     nativeHost:nativeError
      ?{transport:"closed",errorType:nativeError}
      :{transport:"connected"},
     browserContext:{instanceId:"instance-1"}
    }};
   }
  },
  sidePanel:{},
  storage:{local:{},session:{}},
  scripting:{
   async getRegisteredContentScripts(){
    return registeredWebMcp
     ?[{id:"codex-webmcp"},{id:"codex-webmcp-bridge"}]
     :[];
   }
  },
  tabs:{},
  debugger:{},
  declarativeNetRequest:{},
  permissions:{
   async contains({permissions}){
    return !denied.has(permissions[0]);
   }
  }
 };

 const fetch=async url=>{
  const path=new URL(url).pathname.replace(/^\//,"");
  const isWebMcp=path.startsWith("content-scripts/webmcp");
  if(missing.has(path)||(!registeredWebMcp&&isWebMcp)){
   return {ok:false,status:404,async text(){return ""}};
  }
  return {
   ok:true,
   status:200,
   async text(){return resources.get(path)||"ok"}
  };
 };

 const services={};
 for(const kind of ["chat","work","codex","github","repository","runtime"]){
  services[kind]={
   available:true,
   source:kind==="codex"?"native":"test",
   capabilities:["x"]
  };
 }
 Object.assign(services,serviceOverrides);
 const agents=Array.from({length:15},(_,i)=>({id:String(i)}));

 return {
  chrome,
  fetch,
  TitanDeveloperWorkforce:{
   services:{status:()=>services},
   controller:{registry:{list:()=>agents}}
  }
 };
}

{
 const root=fakeRoot();
 const result=await runExtensionDiagnostics({
  root,
  chromeApi:root.chrome,
  fetchImpl:root.fetch
 });
 assert.equal(result.ok,true);
 assert.equal(result.workforce.ready,true);
 assert.equal(
  result.checks.find(x=>x.name==="Upstream WebMCP content scripts").status,
  DIAGNOSTIC_STATUS.DISABLED
 );
 console.log("ok - healthy runtime with dormant feature gate");
}

{
 const root=fakeRoot({missing:new Set(["content-scripts/codex.js"])});
 const result=await runExtensionDiagnostics({
  root,
  chromeApi:root.chrome,
  fetchImpl:root.fetch
 });
 assert.equal(result.ok,false);
 assert.equal(
  result.checks.find(x=>x.name==="Resource: content-scripts/codex.js").status,
  DIAGNOSTIC_STATUS.MISSING_FILE
 );
 console.log("ok - missing critical runtime resource fails");
}

{
 const root=fakeRoot({denied:new Set(["scripting"])});
 const result=await runExtensionDiagnostics({
  root,
  chromeApi:root.chrome,
  fetchImpl:root.fetch
 });
 assert.equal(result.ok,false);
 assert.equal(
  result.checks.find(x=>x.name==="Permission: scripting").status,
  DIAGNOSTIC_STATUS.PERMISSION_DENIED
 );
 console.log("ok - permission denial is distinct");
}

{
 const root=fakeRoot({statusFailure:true});
 const result=await runExtensionDiagnostics({
  root,
  chromeApi:root.chrome,
  fetchImpl:root.fetch
 });
 assert.equal(result.ok,false);
 assert.equal(
  result.checks.find(x=>x.name==="Background/service-worker status message").status,
  DIAGNOSTIC_STATUS.RUNTIME_FAILURE
 );
 console.log("ok - service-worker failure is distinct");
}

{
 const root=fakeRoot({nativeError:"native_host_unreachable"});
 const result=await runExtensionDiagnostics({
  root,
  chromeApi:root.chrome,
  fetchImpl:root.fetch
 });
 const native=result.checks.find(x=>x.name==="Stock native host / AppServer");
 assert.equal(native.status,DIAGNOSTIC_STATUS.UNAVAILABLE);
 assert.equal(native.critical,false);
 assert.equal(result.ok,true);
 console.log("ok - native host failure is surfaced without conflating extension health");
}

{
 const missing=new Set([
  "content-scripts/webmcp.js",
  "content-scripts/webmcp-bridge.js"
 ]);
 const root=fakeRoot({missing,registeredWebMcp:true});
 const result=await runExtensionDiagnostics({
  root,
  chromeApi:root.chrome,
  fetchImpl:root.fetch
 });
 const webmcp=result.checks.find(x=>x.name==="Upstream WebMCP content scripts");
 assert.equal(webmcp.status,DIAGNOSTIC_STATUS.MISSING_FILE);
 assert.equal(result.ok,false);
 console.log("ok - enabled feature with missing files fails");
}

{
 const root=fakeRoot({
  serviceOverrides:{
   codex:{available:false,source:null,capabilities:[]}
  }
 });
 const result=await runExtensionDiagnostics({
  root,
  chromeApi:root.chrome,
  fetchImpl:root.fetch
 });
 assert.equal(
  result.ok,
  true,
  "extension preflight must remain separate from workforce provider readiness"
 );
 assert.equal(result.workforce.ready,false);
 console.log("ok - workforce readiness is reported separately");
}

console.log("extension diagnostics tests passed");
