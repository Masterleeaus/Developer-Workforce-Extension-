export const DIAGNOSTIC_STATUS=Object.freeze({
 PASS:"pass",
 FAIL:"fail",
 WARN:"warn",
 DISABLED:"disabled",
 UNAVAILABLE:"unavailable",
 PERMISSION_DENIED:"permission-denied",
 MISSING_FILE:"missing-file",
 RUNTIME_FAILURE:"runtime-failure"
});

const STATUS=DIAGNOSTIC_STATUS;
const REQUIRED_RESOURCES=Object.freeze([
 "codex-sidepanel/index.html",
 "codex-work-sidepanel.html",
 "content-scripts/chatgpt-website.js",
 "content-scripts/codex.js",
 "content-scripts/foreign-frame-monitor.js",
 "content-scripts/codex-work-media-permission.js",
 "microphone-permission.html",
 "background.js"
]);
const OPTIONAL_WEBMCP=Object.freeze([
 "content-scripts/webmcp.js",
 "content-scripts/webmcp-bridge.js"
]);
const MSG_STATUS="GET_CHATGPT_EXTENSION_STATUS";

function successful(status){
 return status===STATUS.PASS||status===STATUS.DISABLED||status===STATUS.WARN;
}
function record(name,status,detail="",opts={}){
 return {
  name,
  status,
  ok:successful(status),
  critical:opts.critical!==false,
  category:opts.category||"runtime",
  detail:String(detail||""),
  evidence:opts.evidence??null
 };
}
function errorText(error){return String(error?.message||error||"unknown error")}
function timeout(ms){
 return new Promise((_,reject)=>setTimeout(()=>reject(Object.assign(new Error("timeout"),{code:"TIMEOUT"})),ms));
}
async function safe(promise,ms=3000){
 try{return {ok:true,value:await Promise.race([promise,timeout(ms)])}}
 catch(error){return {ok:false,error}}
}
function failureStatus(error){
 const text=errorText(error).toLowerCase();
 if(text.includes("permission")||text.includes("not allowed"))return STATUS.PERMISSION_DENIED;
 return STATUS.RUNTIME_FAILURE;
}
async function resourceProbe(path,{chromeApi,fetchImpl}){
 if(!chromeApi?.runtime?.getURL||typeof fetchImpl!=="function"){
  return {exists:false,status:STATUS.UNAVAILABLE,error:"runtime.getURL/fetch unavailable"};
 }
 const url=chromeApi.runtime.getURL(path);
 const result=await safe(fetchImpl(url,{cache:"no-store"}));
 if(!result.ok)return {exists:false,status:failureStatus(result.error),error:errorText(result.error),url};
 const http=Number(result.value?.status||0);
 if(!result.value?.ok){
  return {
   exists:false,
   status:http===404?STATUS.MISSING_FILE:STATUS.RUNTIME_FAILURE,
   error:"HTTP "+(http||"failure"),
   httpStatus:http||null,
   url
  };
 }
 return {exists:true,status:STATUS.PASS,httpStatus:http||200,url};
}
async function resourceText(path,ctx){
 const probe=await resourceProbe(path,ctx);
 if(!probe.exists)return {...probe,text:null};
 const result=await safe(ctx.fetchImpl(probe.url,{cache:"no-store"}));
 if(!result.ok)return {...probe,text:null,status:failureStatus(result.error),error:errorText(result.error)};
 try{return {...probe,text:await result.value.text()}}
 catch(error){return {...probe,text:null,status:STATUS.RUNTIME_FAILURE,error:errorText(error)}}
}
async function permission(chromeApi,name){
 if(!chromeApi?.permissions?.contains)return {value:null,status:STATUS.UNAVAILABLE};
 const result=await safe(chromeApi.permissions.contains({permissions:[name]}));
 if(!result.ok)return {value:null,status:failureStatus(result.error),error:errorText(result.error)};
 return {value:!!result.value,status:result.value?STATUS.PASS:STATUS.PERMISSION_DENIED};
}
function serviceCheck(kind,status){
 const service=status?.[kind];
 if(!service?.available){
  return record("Titan service: "+kind,STATUS.UNAVAILABLE,"no provider registered",{critical:false,category:"services",evidence:service||null});
 }
 return record(
  "Titan service: "+kind,
  STATUS.PASS,
  (service.source||"provider")+" · "+(service.capabilities||[]).join(", "),
  {critical:false,category:"services",evidence:service}
 );
}
function capabilityCheck(name,capabilities,{critical=false}={}){
 const available=capabilities?.[name]===true;
 return record(
  "Runtime capability: "+name,
  available?STATUS.PASS:STATUS.UNAVAILABLE,
  available?"advertised by service worker":"not advertised",
  {critical,category:"message-contract"}
 );
}
function requiredContract(checks,name,ok,detail){
 checks.push(record(
  name,
  ok?STATUS.PASS:STATUS.RUNTIME_FAILURE,
  detail|| (ok?"contract present":"contract missing"),
  {critical:true,category:"message-contract"}
 ));
}
function buildIdentity(manifest,buildInfo){
 const declared=String(manifest?.description||"").match(/\bv(\d+\.\d+\.\d+)\b/i)?.[1]||null;
 const mismatch=!!(declared&&manifest?.version&&declared!==manifest.version);
 return {
  ok:!!manifest?.name&&!!manifest?.version&&!!buildInfo?.release_channel&&!mismatch,
  detail:manifest
   ?(manifest.name||"extension")+" "+(manifest.version||"unknown")+" · "+(buildInfo?.release_channel||"build-info missing")+(mismatch?" · description/version mismatch "+declared:"")
   :"manifest unavailable",
  mismatch,
  declaredVersion:declared
 };
}

export async function runExtensionDiagnostics({root=globalThis,chromeApi=root.chrome,fetchImpl=root.fetch}={}){
 const checks=[];
 const runtime=chromeApi?.runtime;

 checks.push(record("Chrome extension runtime",runtime?.id?STATUS.PASS:STATUS.UNAVAILABLE,runtime?.id||"runtime unavailable",{category:"api"}));

 for(const [name,value,critical] of [
  ["Chrome sidePanel API",chromeApi?.sidePanel,true],
  ["Chrome storage.local",chromeApi?.storage?.local,true],
  ["Chrome storage.session",chromeApi?.storage?.session,true],
  ["Chrome scripting API",chromeApi?.scripting,true],
  ["Chrome tabs API",chromeApi?.tabs,true],
  ["Chrome debugger API",chromeApi?.debugger,false],
  ["Chrome DNR API",chromeApi?.declarativeNetRequest,false]
 ]){
  checks.push(record(name,value?STATUS.PASS:STATUS.UNAVAILABLE,value?"available":"missing",{critical,category:"api"}));
 }

 const permissions={};
 for(const name of ["nativeMessaging","debugger","scripting","tabs","sidePanel"]){
  const p=await permission(chromeApi,name);
  permissions[name]=p;
  checks.push(record(
   "Permission: "+name,
   p.status,
   p.error||String(p.value),
   {critical:["scripting","tabs","sidePanel"].includes(name),category:"permissions"}
  ));
 }

 const statusReply=runtime?.sendMessage
  ?await safe(runtime.sendMessage({type:MSG_STATUS}),4000)
  :{ok:false,error:new Error("runtime messaging unavailable")};
 const status=statusReply.ok&&statusReply.value?.ok===true?statusReply.value.state:null;
 checks.push(record(
  "Background/service-worker status message",
  status?STATUS.PASS:failureStatus(statusReply.error||new Error(statusReply.value?.error||"invalid response")),
  status?"version "+(status.extension?.version||"unknown"):errorText(statusReply.error||statusReply.value?.error||"invalid response"),
  {category:"message-contract",evidence:status}
 ));

 if(status){
  checks.push(capabilityCheck("sidePanel.open",status.capabilities,{critical:true}));
  checks.push(capabilityCheck("website.action.request",status.capabilities,{critical:true}));
  checks.push(capabilityCheck("nativeHost.status",status.capabilities));
  checks.push(capabilityCheck("extension.update.read",status.capabilities));

  const nativeHost=status.nativeHost||{};
  const nativeStatus=nativeHost.transport==="connected"
   ?STATUS.PASS
   :nativeHost.errorType?STATUS.UNAVAILABLE:STATUS.WARN;
  checks.push(record(
   "Stock native host / AppServer",
   nativeStatus,
   (nativeHost.transport||"unknown")+(nativeHost.errorType?" · "+nativeHost.errorType:""),
   {critical:false,category:"native-host",evidence:nativeHost}
  ));
  checks.push(record(
   "Extension instance identity",
   status.browserContext?.instanceId?STATUS.PASS:STATUS.WARN,
   status.browserContext?.instanceId||"instance id not reported",
   {critical:false,category:"identity"}
  ));
 }

 for(const path of REQUIRED_RESOURCES){
  const probe=await resourceProbe(path,{chromeApi,fetchImpl});
  checks.push(record(
   "Resource: "+path,
   probe.exists?STATUS.PASS:probe.status,
   probe.exists?"present":(probe.error||"missing"),
   {category:"resources",evidence:probe}
  ));
 }

 let registrations=[];
 if(chromeApi?.scripting?.getRegisteredContentScripts){
  const result=await safe(chromeApi.scripting.getRegisteredContentScripts({
   ids:["codex-webmcp","codex-webmcp-bridge"]
  }),3000);
  if(result.ok&&Array.isArray(result.value))registrations=result.value;
 }
 const webmcp=[];
 for(const path of OPTIONAL_WEBMCP){
  webmcp.push(await resourceProbe(path,{chromeApi,fetchImpl}));
 }
 const webmcpPresent=webmcp.every(item=>item.exists);
 const webmcpRegistered=registrations.length>0;
 const webmcpStatus=webmcpPresent
  ?STATUS.PASS
  :webmcpRegistered?STATUS.MISSING_FILE:STATUS.DISABLED;
 checks.push(record(
  "Upstream WebMCP content scripts",
  webmcpStatus,
  webmcpPresent
   ?"present"
   :webmcpRegistered
    ?"registered but package files are missing"
    :"feature gate inactive; upstream scripts absent in this build",
  {critical:webmcpRegistered,category:"feature-gate",evidence:{resources:webmcp,registrations}}
 ));

 const background=await resourceText("background.js",{chromeApi,fetchImpl});
 if(background.text){
  for(const [name,ok] of [
   ["Dynamic Codex injection",background.text.includes("content-scripts/codex.js")],
   ["Foreign-frame monitor registration",background.text.includes("content-scripts/foreign-frame-monitor.js")],
   ["Work auth open handler",background.text.includes("CODEX_WORK_SIDE_PANEL_AUTH_OPEN")],
   ["Work auth state handler",background.text.includes("CODEX_WORK_SIDE_PANEL_AUTH_STATE")],
   ["Extension status handler",background.text.includes(MSG_STATUS)],
   ["Installer handler",background.text.includes("SHOW_CODEX_INSTALLER")]
  ])requiredContract(checks,name,ok,ok?"contract present":"handler signature missing");
 }else{
  checks.push(record(
   "Background contract inspection",
   background.status||STATUS.RUNTIME_FAILURE,
   background.error||"background.js unavailable",
   {category:"message-contract"}
  ));
 }

 const sidepanel=await resourceText("codex-sidepanel/index.html",{chromeApi,fetchImpl});
 if(sidepanel.text){
  requiredContract(checks,"Local sidepanel bootstrap",sidepanel.text.includes("titan-workforce/sidepanel-client.js"),"v4 sidepanel-client module");
  requiredContract(checks,"Preflight bootstrap",sidepanel.text.includes("titan-preflight.js"),"preflight module reference");
 }else{
  checks.push(record(
   "Local sidepanel contract inspection",
   sidepanel.status||STATUS.RUNTIME_FAILURE,
   sidepanel.error||"sidepanel unavailable",
   {category:"message-contract"}
  ));
 }

 const work=await resourceText("chunks/codex-work-sidepanel-0JzHpPDf.js",{chromeApi,fetchImpl});
 if(work.text){
  requiredContract(
   checks,
   "Work sidepanel auth handshake",
   work.text.includes("CODEX_WORK_SIDE_PANEL_AUTH_REVALIDATE")&&work.text.includes("CODEX_WORK_SIDE_PANEL_AUTH_STATE"),
   "open/revalidate/state contract"
  );
  requiredContract(
   checks,
   "Media permission handoff",
   work.text.includes("microphone-permission.html"),
   "Work sidepanel → permission page"
  );
 }else{
  checks.push(record(
   "Work sidepanel contract inspection",
   work.status||STATUS.RUNTIME_FAILURE,
   work.error||"work chunk unavailable",
   {category:"message-contract"}
  ));
 }

 const manifest=runtime?.getManifest?.()||null;
 const build=await resourceText("codex/build-info.json",{chromeApi,fetchImpl});
 let buildInfo=null;
 if(build.text){try{buildInfo=JSON.parse(build.text)}catch{}}
 const identity=buildIdentity(manifest,buildInfo);
 checks.push(record(
  "Manifest/build identity",
  identity.ok?STATUS.PASS:STATUS.FAIL,
  identity.detail,
  {category:"build",evidence:{
   manifestVersion:manifest?.version||null,
   descriptionVersion:identity.declaredVersion,
   releaseChannel:buildInfo?.release_channel||null,
   sha:buildInfo?.sha||null
  }}
 ));

 const workforce=root.TitanDeveloperWorkforce;
 const serviceStatus=workforce?.services?.status?.()||{};
 const agents=workforce?.controller?.registry?.list?.()||[];
 const workforceChecks=[
  record("Developer Workforce v4 bootstrap",workforce?STATUS.PASS:STATUS.UNAVAILABLE,workforce?"ready":"global unavailable",{critical:false,category:"workforce"}),
  record("15-agent topology",agents.length===15?STATUS.PASS:STATUS.UNAVAILABLE,String(agents.length),{critical:false,category:"workforce"})
 ];
 for(const kind of ["chat","work","codex","github","repository","runtime"]){
  workforceChecks.push(serviceCheck(kind,serviceStatus));
 }
 checks.push(...workforceChecks);

 const criticalFailures=checks.filter(item=>item.critical&&!successful(item.status));
 return {
  ok:criticalFailures.length===0,
  at:Date.now(),
  checks,
  criticalFailures:criticalFailures.map(item=>item.name),
  nativeHost:status?.nativeHost||null,
  serviceStatus,
  workforce:{
   ready:workforceChecks.every(item=>successful(item.status)),
   checks:workforceChecks
  },
  permissions,
  manifest:{name:manifest?.name||null,version:manifest?.version||null},
  buildInfo
 };
}

if(typeof globalThis!=="undefined"){
 globalThis.runTitanExtensionDiagnostics=runExtensionDiagnostics;
}
