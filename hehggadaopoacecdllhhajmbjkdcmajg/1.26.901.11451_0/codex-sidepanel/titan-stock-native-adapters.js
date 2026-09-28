/*
 Titan stock native adapters v0.2

 Stable dependency-injected seam between stock extension services and Titan.
 No hashed/minified exports are imported here.

 Host may expose:
 - codex.review/build/orchestrate
 - git.request({method,params})
 - github.verify({mission})
 - repository.query(args)
 - runtime.verify(args)
*/
function publish(kind,service){
 if(!service)return false;
 const legacy=globalThis.TitanNativeServices;
 if(legacy?.publish)legacy.publish(kind,service);
 globalThis.dispatchEvent?.(new CustomEvent("titan:stock-native-service",{detail:{kind,service}}));
 return true;
}
export function installTitanStockAdapters(host){
 if(!host)throw new TypeError("host required");
 let installed=0;

 if(host.codex&&(host.codex.review||host.codex.build||host.codex.orchestrate||host.codex.execute)){
  installed+=publish("codex",{
   source:"stock-native",
   capabilities:["review","build","orchestrate"],
   review:host.codex.review?.bind(host.codex),
   build:(host.codex.build||host.codex.execute)?.bind(host.codex),
   orchestrate:(host.codex.orchestrate||host.codex.review)?.bind(host.codex)
  })?1:0;
 }

 if(host.git?.request||host.github?.verify){
  installed+=publish("github",{
   source:"stock-native",
   capabilities:["verify","branch","commit","pull_request","ci","main_containment"],
   async verify({mission,...rest}){
    if(host.github?.verify)return host.github.verify({mission,...rest});
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
  installed+=publish("repository",{
   source:"stock-native",
   capabilities:["query","files","tests","symbols","dependencies"],
   async query(args){
    if(host.repository?.query)return host.repository.query(args);
    const {mission={},transcript="",limit=12}=args||{};
    const result=await host.git.request({method:"titan-repository-impact",params:{
     repo:mission.repository||mission.repo,branch:mission.branch,goal:mission.goal,title:mission.title,transcript,limit
    }}).catch(()=>null);
    if(!result){const e=new Error("Stock repository service returned no context");e.code="NATIVE_REPOSITORY_NO_EVIDENCE";throw e}
    return {...result,source:result.source||"stock-native"};
   }
  })?1:0;
 }

 if(host.runtime?.verify){
  installed+=publish("runtime",{source:"stock-native",capabilities:["verify"],verify:host.runtime.verify.bind(host.runtime)})?1:0;
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
