/*
 Titan stock native adapters v0.3

 Stable dependency-injected seam between stock extension services and Titan.
 No hashed/minified exports are imported here.

 Host may expose:
 - codex.review/build/orchestrate/request(method, params, options)
 - appServer.request(method, params, options)
 - git.request({method,params,signal})
 - github.verify/status/issue/pr/actions
 - repository.query/read/diff
 - terminal.exec/run/test/build
 - browser.inspect/console/logs/network/screenshot
 - runtime.verify
 - server.inspect/deploy
*/
function publish(kind,service){
 if(!service)return false;
 const legacy=globalThis.TitanNativeServices;
 if(legacy?.publish)legacy.publish(kind,service);
 globalThis.dispatchEvent?.(new CustomEvent("titan:stock-native-service",{detail:{kind,service}}));
 return true;
}
function bind(obj,name){return typeof obj?.[name]==="function"?obj[name].bind(obj):null}
function normalizeRequest(fn,ctx){
 if(typeof fn!=="function")return null;
 return (method,params,options={})=>fn.call(ctx,method,params,options);
}
export function installTitanStockAdapters(host){
 if(!host)throw new TypeError("host required");
 let installed=0;

 const codexRequest=
  normalizeRequest(host.codex?.request,host.codex)||
  normalizeRequest(host.appServer?.request,host.appServer);
 if(host.codex&&(host.codex.review||host.codex.build||host.codex.orchestrate||host.codex.execute||codexRequest)||codexRequest){
  const codex=host.codex||{};
  installed+=publish("codex",{
   source:"stock-native",
   capabilities:[
    codexRequest&&"request",
    codex.review&&"review",
    (codex.build||codex.execute)&&"build",
    (codex.orchestrate||codex.review)&&"orchestrate"
   ].filter(Boolean),
   request:codexRequest||undefined,
   review:bind(codex,"review")||undefined,
   build:bind(codex,"build")||bind(codex,"execute")||undefined,
   orchestrate:bind(codex,"orchestrate")||bind(codex,"review")||undefined
  })?1:0;
 }

 if(host.git?.request){
  installed+=publish("git",{
   source:"stock-native",
   capabilities:["request","status","branch","commit","merge","worktree","diff"],
   request:host.git.request.bind(host.git)
  })?1:0;
 }

 if(host.git?.request||host.github){
  const github=host.github||{};
  installed+=publish("github",{
   source:"stock-native",
   capabilities:["verify","status","issue","pr","actions"].filter(name=>name==="verify"||typeof github[name]==="function"),
   status:bind(github,"status")||undefined,
   issue:bind(github,"issue")||undefined,
   pr:bind(github,"pr")||bind(github,"pullRequest")||undefined,
   actions:bind(github,"actions")||undefined,
   request:bind(github,"request")||undefined,
   async verify({mission,...rest}){
    if(typeof github.verify==="function")return github.verify({mission,...rest});
    if(!host.git?.request){const e=new Error("Stock Git/GitHub verification unavailable");e.code="NATIVE_GITHUB_UNAVAILABLE";throw e}
    const repo=mission?.repository||mission?.repo,branch=mission?.branch;
    const evidence={repo,branch};
    const [commit,pr,main]=await Promise.all([
     host.git.request({method:"titan-commit-status",params:{repo,branch,...rest}}).catch(()=>null),
     host.git.request({method:"titan-pr-status",params:{repo,branch,...rest}}).catch(()=>null),
     host.git.request({method:"titan-main-containment",params:{repo,branch,...rest}}).catch(()=>null)
    ]);
    if(!commit&&!pr&&!main){const e=new Error("Stock Git service returned no verification evidence");e.code="NATIVE_GITHUB_NO_EVIDENCE";throw e}
    return {
     branchExists:commit?.branchExists===true,
     commitExists:!!commit?.sha,
     prExists:!!pr?.number,
     ciPassed:pr?.ciPassed===true||commit?.ciPassed===true,
     merged:pr?.merged===true,
     presentOnMain:main?.present===true,
     commit:commit?.sha||null,
     pr:pr?.number||null,
     evidence:{...evidence,commit,pr,main},
     url:pr?.url||null,
     source:"stock-native"
    };
   }
  })?1:0;
 }

 if(host.repository?.query||host.git?.request){
  const repository=host.repository||{};
  installed+=publish("repository",{
   source:"stock-native",
   capabilities:["query",repository.read&&"read",repository.diff&&"diff"].filter(Boolean),
   read:bind(repository,"read")||undefined,
   diff:bind(repository,"diff")||undefined,
   async query(args){
    if(typeof repository.query==="function")return repository.query(args);
    const {mission={},transcript="",limit=12}=args||{};
    const result=await host.git.request({method:"titan-repository-impact",params:{
     repo:mission.repository||mission.repo,branch:mission.branch,goal:mission.goal,title:mission.title,transcript,limit
    }}).catch(()=>null);
    if(!result){const e=new Error("Stock repository service returned no context");e.code="NATIVE_REPOSITORY_NO_EVIDENCE";throw e}
    return {...result,source:result.source||"stock-native"};
   }
  })?1:0;
 }

 const terminal=host.terminal;
 if(terminal&&(terminal.exec||terminal.run||terminal.test||terminal.build)){
  installed+=publish("terminal",{
   source:"stock-native",
   capabilities:["exec","test","build"].filter(name=>name==="exec"?(terminal.exec||terminal.run):terminal[name]),
   exec:bind(terminal,"exec")||bind(terminal,"run")||undefined,
   test:bind(terminal,"test")||undefined,
   build:bind(terminal,"build")||undefined
  })?1:0;
 }

 const browser=host.browser;
 if(browser&&(browser.inspect||browser.console||browser.logs||browser.network||browser.screenshot)){
  installed+=publish("browser",{
   source:"stock-native",
   capabilities:["inspect","console","network","screenshot"].filter(name=>name==="console"?(browser.console||browser.logs):browser[name]),
   inspect:bind(browser,"inspect")||undefined,
   console:bind(browser,"console")||bind(browser,"logs")||undefined,
   network:bind(browser,"network")||undefined,
   screenshot:bind(browser,"screenshot")||undefined
  })?1:0;
 }

 if(host.runtime?.verify){
  installed+=publish("runtime",{source:"stock-native",capabilities:["verify"],verify:host.runtime.verify.bind(host.runtime)})?1:0;
 }

 const server=host.server;
 if(server&&(server.inspect||server.deploy)){
  installed+=publish("server",{
   source:"stock-native",
   capabilities:["inspect","deploy"].filter(name=>server[name]),
   inspect:bind(server,"inspect")||undefined,
   deploy:bind(server,"deploy")||undefined
  })?1:0;
 }

 return {ok:installed>0,installed};
}
export function discoverTitanStockHost(root=globalThis){
 return root.__titanStockHost||root.__codexNativeServices||root.__chatgptNativeServices||root.__titanNativeBridge||null;
}
export function startTitanStockAdapterDiscovery({root=globalThis,intervalMs=5000}={}){
 let current=null,stopped=false,timer=null;
 const attempt=()=>{
  if(stopped)return null;
  const host=discoverTitanStockHost(root);
  if(host&&host!==current){current=host;try{installTitanStockAdapters(host)}catch(error){root.dispatchEvent?.(new CustomEvent("titan:stock-native-error",{detail:{message:String(error?.message||error)}}))}}
  return host;
 };
 const onReady=e=>{const host=e?.detail?.host||e?.detail;if(host&&host!==current){current=host;installTitanStockAdapters(host)}};
 root.addEventListener?.("titan:stock-host-ready",onReady);
 attempt();
 if(typeof root.setInterval==="function")timer=root.setInterval(attempt,intervalMs);
 return ()=>{
  stopped=true;
  if(timer!=null)root.clearInterval?.(timer);
  root.removeEventListener?.("titan:stock-host-ready",onReady);
 };
}

globalThis.installTitanStockAdapters=installTitanStockAdapters;
globalThis.startTitanStockAdapterDiscovery=startTitanStockAdapterDiscovery;
if(typeof window!=="undefined")startTitanStockAdapterDiscovery();
