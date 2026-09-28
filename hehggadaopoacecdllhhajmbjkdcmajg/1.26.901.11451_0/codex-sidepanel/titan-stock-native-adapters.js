/*
 Titan stock native adapters v0.1

 This module is intentionally dependency-injected. The stock bundle supplies:
 - appServer.request(method, params) / notifications
 - git.request({method, params})
 - github PR/status fetchers when available
 - workspace repository roots

 No hashed/minified exports are imported here.
*/
export function installTitanStockAdapters(host){
 if(!host)throw new TypeError('host required');

 if(host.codex?.review){
  window.TitanNativeServices.publish('codex',{review:host.codex.review});
 }

 if(host.git?.request || host.github?.verify){
  window.TitanNativeServices.publish('github',{
   async verify({mission}){
    if(host.github?.verify)return host.github.verify({mission});
    const repo=mission.repo, branch=mission.branch;
    const evidence={repo,branch};
    // Generic stable host contract. The host maps these onto stock git/GitHub services.
    const commit=await host.git.request({method:'titan-commit-status',params:{repo,branch}}).catch(()=>null);
    const pr=await host.git.request({method:'titan-pr-status',params:{repo,branch}}).catch(()=>null);
    const main=await host.git.request({method:'titan-main-containment',params:{repo,branch,commit:commit?.sha}}).catch(()=>null);
    return {
     branchExists:commit?.branchExists===true,
     commitExists:!!commit?.sha,
     prExists:!!pr?.number,
     ciPassed:pr?.ciPassed===true||commit?.ciPassed===true,
     merged:pr?.merged===true,
     presentOnMain:main?.present===true,
     evidence:{...evidence,commit,pr,main},
     url:pr?.url||null
    };
   }
  });
 }

 if(host.repository?.query || host.git?.request){
  window.TitanNativeServices.publish('repository',{
   async query(args){
    if(host.repository?.query)return host.repository.query(args);
    const {mission,transcript,limit}=args;
    return await host.git.request({method:'titan-repository-impact',params:{
     repo:mission.repo,branch:mission.branch,goal:mission.goal,title:mission.title,
     transcript,limit
    }}).catch(()=>null);
   }
  });
 }

 if(host.runtime?.verify){
  window.TitanNativeServices.publish('runtime',{verify:host.runtime.verify});
 }
 return true;
}

window.installTitanStockAdapters=installTitanStockAdapters;
