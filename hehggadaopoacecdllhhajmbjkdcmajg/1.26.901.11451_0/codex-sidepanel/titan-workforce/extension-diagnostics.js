export const DIAGNOSTIC_STATUS=Object.freeze({
 PASS:"pass",FAIL:"fail",WARN:"warn",DISABLED:"disabled",UNAVAILABLE:"unavailable"
});
const STATUS=DIAGNOSTIC_STATUS;
const REQUIRED_RESOURCES=Object.freeze([
 "codex-sidepanel/index.html",
 "codex-work-sidepanel.html",
 "content-scripts/chatgpt-website.js",
 "content-scripts/codex.js",
 "content-scripts/foreign-frame-monitor.js",
 "content-scripts/codex-work-media-permission.js",
 "microphone-permission.html"
]);
const OPTIONAL_WEBMCP=Object.freeze(["content-scripts/webmcp.js","content-scripts/webmcp-bridge.js"]);
const MSG_STATUS="GET_CHATGPT_EXTENSION_STATUS";

function record(name,status,detail="",opts={}){
 return {name,status,ok:status===STATUS.PASS||status===STATUS.DISABLED,critical:opts.critical!==false,category:opts.category||"runtime",detail:String(detail||""),evidence:opts.evidence??null};
}
function errorText(e){return String(e?.message||e||"unknown error")}
function timeout(ms){return new Promise((_,reject)=>setTimeout(()=>reject(new Error("timeout")),ms))}
async function safe(promise,ms=3000){try{return {ok:true,value:await Promise.race([promise,timeout(ms)])}}catch(error){return {ok:false,error}}}
async function resourceProbe(path,{chromeApi,fetchImpl}){
 if(!chromeApi?.runtime?.getURL||typeof fetchImpl!=="function")return {exists:false,error:"runtime.getURL/fetch unavailable"};
 const url=chromeApi.runtime.getURL(path),r=await safe(fetchImpl(url,{cache:"no-store"}));
 if(!r.ok)return {exists:false,error:errorText(r.error),url};
 return {exists:!!r.value?.ok,status:r.value?.status??null,url};
}
async function resourceText(path,ctx){
 const probe=await resourceProbe(path,ctx);if(!probe.exists)return {...probe,text:null};
 const r=await safe(ctx.fetchImpl(probe.url,{cache:"no-store"}));if(!r.ok)return {...probe,text:null,error:errorText(r.error)};
 try{return {...probe,text:await r.value.text()}}catch(error){return {...probe,text:null,error:errorText(error)}}
}
async function permission(chromeApi,name){
 if(!chromeApi?.permissions?.contains)return null;
 const r=await safe(chromeApi.permissions.contains({permissions:[name]}));return r.ok?!!r.value:null;
}
function serviceCheck(kind,status){
 const s=status?.[kind];
 if(!s?.available)return record("Titan service: "+kind,STATUS.UNAVAILABLE,"no provider registered",{critical:["chat","work","codex","github","repository"].includes(kind),category:"services"});
 return record("Titan service: "+kind,STATUS.PASS,(s.source||"provider")+" · "+(s.capabilities||[]).join(", "),{category:"services",evidence:s});
}
function capabilityCheck(name,capabilities,critical=false){
 const available=capabilities?.[name]===true;
 return record("Runtime capability: "+name,available?STATUS.PASS:STATUS.UNAVAILABLE,available?"advertised by service worker":"not advertised",{critical,category:"message-contract"});
}
export async function runExtensionDiagnostics({root=globalThis,chromeApi=root.chrome,fetchImpl=root.fetch}={}){
 const checks=[];
 const add=x=>checks.push(x);
 const runtime=chromeApi?.runtime;
 add(record("Chrome extension runtime",runtime?.id?STATUS.PASS:STATUS.FAIL,runtime?.id||"runtime unavailable",{category:"api"}));
 add(record("Chrome sidePanel API",chromeApi?.sidePanel?STATUS.PASS:STATUS.FAIL,chromeApi?.sidePanel?"available":"missing",{category:"api"}));
 add(record("Chrome storage.local",chromeApi?.storage?.local?STATUS.PASS:STATUS.FAIL,chromeApi?.storage?.local?"available":"missing",{category:"api"}));
 add(record("Chrome storage.session",chromeApi?.storage?.session?STATUS.PASS:STATUS.FAIL,chromeApi?.storage?.session?"available":"missing",{category:"api"}));
 add(record("Chrome scripting API",chromeApi?.scripting?STATUS.PASS:STATUS.FAIL,chromeApi?.scripting?"available":"missing",{category:"api"}));
 add(record("Chrome tabs API",chromeApi?.tabs?STATUS.PASS:STATUS.FAIL,chromeApi?.tabs?"available":"missing",{category:"api"}));
 add(record("Chrome debugger API",chromeApi?.debugger?STATUS.PASS:STATUS.UNAVAILABLE,chromeApi?.debugger?"available":"missing",{critical:false,category:"api"}));
 add(record("Chrome DNR API",chromeApi?.declarativeNetRequest?STATUS.PASS:STATUS.UNAVAILABLE,chromeApi?.declarativeNetRequest?"available":"missing",{critical:false,category:"api"}));

 const perms={};
 for(const name of ["nativeMessaging","debugger","scripting","tabs","sidePanel"]){perms[name]=await permission(chromeApi,name)}
 for(const [name,value] of Object.entries(perms))add(record("Permission: "+name,value===true?STATUS.PASS:value===false?STATUS.FAIL:STATUS.UNAVAILABLE,value===null?"permission query unavailable":String(value),{critical:["scripting","tabs","sidePanel"].includes(name),category:"permissions"}));

 const statusReply=runtime?.sendMessage?await safe(runtime.sendMessage({type:MSG_STATUS}),4000):{ok:false,error:new Error("runtime messaging unavailable")};
 const status=statusReply.ok&&statusReply.value?.ok===true?statusReply.value.state:null;
 add(record("Background/service-worker status message",status?STATUS.PASS:STATUS.FAIL,status?("version "+(status.extension?.version||"unknown")):errorText(statusReply.error||statusReply.value?.error||"invalid response"),{category:"message-contract",evidence:status}));
 if(status){
  add(capabilityCheck("sidePanel.open",status.capabilities,true));
  add(capabilityCheck("website.action.request",status.capabilities,true));
  add(capabilityCheck("nativeHost.status",status.capabilities,false));
  add(capabilityCheck("extension.update.read",status.capabilities,false));
  const nh=status.nativeHost||{};
  const nhStatus=nh.transport==="connected"?STATUS.PASS:nh.errorType?STATUS.UNAVAILABLE:STATUS.WARN;
  add(record("Stock native host / AppServer",nhStatus,nh.transport+(nh.errorType?" · "+nh.errorType:""),{critical:false,category:"native-host",evidence:nh}));
  add(record("Extension instance identity",status.browserContext?.instanceId?STATUS.PASS:STATUS.WARN,status.browserContext?.instanceId||"instance id not reported",{critical:false,category:"identity"}));
 }

 const probes={};
 for(const path of REQUIRED_RESOURCES){
  const p=await resourceProbe(path,{chromeApi,fetchImpl});probes[path]=p;
  add(record("Resource: "+path,p.exists?STATUS.PASS:STATUS.FAIL,p.exists?"present":(p.error||"missing"),{category:"resources",evidence:p}));
 }
 const webmcp=[];
 for(const path of OPTIONAL_WEBMCP)webmcp.push(await resourceProbe(path,{chromeApi,fetchImpl}));
 const webmcpPresent=webmcp.every(x=>x.exists);
 add(record("Upstream WebMCP content scripts",webmcpPresent?STATUS.PASS:STATUS.DISABLED,webmcpPresent?"present":"feature-gated upstream scripts absent in this build",{critical:false,category:"feature-gate",evidence:webmcp}));

 const background=await resourceText("background.js",{chromeApi,fetchImpl});
 if(background.text){
  const contracts=[
   ["Dynamic Codex injection",background.text.includes("content-scripts/codex.js")],
   ["Foreign-frame monitor registration",background.text.includes("content-scripts/foreign-frame-monitor.js")],
   ["Work auth open handler",background.text.includes("CODEX_WORK_SIDE_PANEL_AUTH_OPEN")],
   ["Work auth state handler",background.text.includes("CODEX_WORK_SIDE_PANEL_AUTH_STATE")],
   ["Installer handler",background.text.includes("SHOW_CODEX_INSTALLER")]
  ];
  for(const [name,ok] of contracts)add(record(name,ok?STATUS.PASS:STATUS.FAIL,ok?"contract present":"handler signature missing",{category:"message-contract"}));
 }else add(record("Background contract inspection",STATUS.FAIL,background.error||"background.js unavailable",{category:"message-contract"}));

 const work=await resourceText("chunks/codex-work-sidepanel-0JzHpPDf.js",{chromeApi,fetchImpl});
 if(work.text){
  add(record("Work sidepanel auth handshake",work.text.includes("CODEX_WORK_SIDE_PANEL_AUTH_REVALIDATE")&&work.text.includes("CODEX_WORK_SIDE_PANEL_AUTH_STATE")?STATUS.PASS:STATUS.FAIL,"open/revalidate/state contract",{category:"message-contract"}));
  add(record("Media permission handoff",work.text.includes("microphone-permission.html")?STATUS.PASS:STATUS.FAIL,"Work sidepanel → permission page",{category:"message-contract"}));
 }else add(record("Work sidepanel contract inspection",STATUS.FAIL,work.error||"work chunk unavailable",{category:"message-contract"}));

 const manifest=runtime?.getManifest?.()||null;
 const build=await resourceText("codex/build-info.json",{chromeApi,fetchImpl});
 let buildInfo=null;if(build.text)try{buildInfo=JSON.parse(build.text)}catch{}
 add(record("Manifest/build identity",manifest?.version&&buildInfo?.release_channel?STATUS.PASS:STATUS.FAIL,manifest?((manifest.name||"extension")+" "+manifest.version+" · "+(buildInfo?.release_channel||"build-info missing")):"manifest unavailable",{category:"build",evidence:{manifestVersion:manifest?.version||null,releaseChannel:buildInfo?.release_channel||null,sha:buildInfo?.sha||null}}));

 const workforce=root.TitanDeveloperWorkforce;
 add(record("Developer Workforce v4 bootstrap",workforce?STATUS.PASS:STATUS.FAIL,workforce?"ready":"global unavailable",{category:"titan"}));
 const serviceStatus=workforce?.services?.status?.()||{};
 for(const kind of ["chat","work","codex","github","repository","runtime"])add(serviceCheck(kind,serviceStatus));
 const agents=workforce?.controller?.registry?.list?.()||[];
 add(record("15-agent topology",agents.length===15?STATUS.PASS:STATUS.FAIL,String(agents.length),{category:"titan"}));

 const criticalFailures=checks.filter(x=>x.critical&&x.status!==STATUS.PASS&&x.status!==STATUS.DISABLED);
 const result={ok:criticalFailures.length===0,at:Date.now(),checks,criticalFailures:criticalFailures.map(x=>x.name),nativeHost:status?.nativeHost||null,serviceStatus,manifest:{name:manifest?.name||null,version:manifest?.version||null},buildInfo};
 return result;
}
