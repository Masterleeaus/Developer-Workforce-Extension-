export function createAuthoritativeChangedPathResolver(services,{audit=()=>{}}={}){
 return async ({builderId,packet,result})=>{
  const repository=services.get("repository"),github=services.get("github");
  let paths=[];
  if(repository?.changedPaths)paths=await repository.changedPaths({builderId,packet,result});
  else if(github?.changedPaths)paths=await github.changedPaths({builderId,packet,result});
  else if(github?.pullRequestFiles&&result?.pr)paths=await github.pullRequestFiles({pr:result.pr,repository:packet?.repository||packet?.mission?.repository});
  else if(repository?.diff&&result?.commit){const d=await repository.diff({commit:result.commit,repository:packet?.repository||packet?.mission?.repository});paths=d?.files||d?.changedPaths||[]}
  if(!Array.isArray(paths)||!paths.length){const e=new Error("Authoritative changed-path evidence unavailable");e.code="CHANGED_PATH_EVIDENCE_UNAVAILABLE";throw e}
  const normalized=[...new Set(paths.map(x=>typeof x==="string"?x:(x.path||x.filename)).filter(Boolean))];
  audit("authoritative-changed-paths",{builderId,missionId:packet?.mission?.id||packet?.mission_id,paths:normalized,source:repository?.changedPaths?"repository":github?.changedPaths||github?.pullRequestFiles?"github":"repository-diff"});
  return normalized;
 };
}
