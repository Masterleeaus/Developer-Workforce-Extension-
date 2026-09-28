const DEFAULT_TIMEOUT_MS=180000;
const DEFAULT_POLL_MS=750;
const STOP_WORDS=new Set(["the","and","for","with","from","that","this","into","your","their","mission","titan","work","code","repo","repository","branch","files","file","test","tests"]);

function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
function clamp(n,min,max){return Math.max(min,Math.min(max,n))}
function cleanToken(v){return String(v||"").toLowerCase().replace(/[^a-z0-9_./-]+/g," ").trim()}
function missionText(mission={},transcript=""){
 return [mission.title,mission.goal,mission.repository,mission.repo,mission.branch,...(mission.constraints||[]),...(mission.acceptanceCriteria||mission.acceptance||[]),transcript].filter(Boolean).join(" ");
}
function keywords(text){
 return [...new Set(cleanToken(text).split(/\s+/).filter(x=>x.length>2&&!STOP_WORDS.has(x)))].slice(0,40);
}
function parseRepo(value){
 const raw=String(value||"").trim();
 if(!raw)throw new Error("Repository is required");
 if(/^https?:\/\/github\.com\//i.test(raw)){
  const u=new URL(raw),parts=u.pathname.replace(/^\/|\.git$/g,"").split("/").filter(Boolean);
  if(parts.length<2)throw new Error("Invalid GitHub repository URL");
  return {owner:parts[0],repo:parts[1],fullName:parts[0]+"/"+parts[1]};
 }
 const parts=raw.replace(/\.git$/,"").split("/").filter(Boolean);
 if(parts.length!==2)throw new Error("Repository must be owner/repo or a GitHub URL");
 return {owner:parts[0],repo:parts[1],fullName:parts[0]+"/"+parts[1]};
}
function apiUrl(owner,repo,path=""){return "https://api.github.com/repos/"+encodeURIComponent(owner)+"/"+encodeURIComponent(repo)+(path?"/"+path:"")}
async function jsonRequest(fetchImpl,url,{optional=false,headers={}}={}){
 let res;
 try{res=await fetchImpl(url,{headers:{Accept:"application/vnd.github+json",...headers}})}catch(error){
  if(optional)return null;
  const e=new Error("GitHub request failed: "+(error?.message||error));e.code="GITHUB_NETWORK_ERROR";throw e;
 }
 if(!res?.ok){
  if(optional&&(res?.status===404||res?.status===422))return null;
  const e=new Error("GitHub request failed: HTTP "+(res?.status??"unknown"));e.code="GITHUB_HTTP_ERROR";e.status=res?.status??null;throw e;
 }
 return await res.json();
}
function statusChecksPassed(status,checks){
 const statusKnown=Array.isArray(status?.statuses)&&status.statuses.length>0;
 const checksKnown=Array.isArray(checks?.check_runs)&&checks.check_runs.length>0;
 if(!statusKnown&&!checksKnown)return false;
 const statusOK=!statusKnown||status.state==="success";
 const accepted=new Set(["success","neutral","skipped"]);
 const checksOK=!checksKnown||checks.check_runs.every(r=>r.status==="completed"&&accepted.has(r.conclusion));
 return statusOK&&checksOK;
}
export function createGitHubRestService({fetchImpl=globalThis.fetch}={}){
 if(typeof fetchImpl!=="function")return null;
 return {
  source:"github-rest-fallback",
  capabilities:["verify","branch","commit","pull_request","ci","main_containment"],
  async verify({mission}={}){
   const repoRef=parseRepo(mission?.repository||mission?.repo);
   const meta=await jsonRequest(fetchImpl,apiUrl(repoRef.owner,repoRef.repo));
   const defaultBranch=meta.default_branch||"main";
   const branch=mission?.branch||defaultBranch;
   const branchInfo=await jsonRequest(fetchImpl,apiUrl(repoRef.owner,repoRef.repo,"branches/"+encodeURIComponent(branch)));
   const sha=branchInfo?.commit?.sha;
   if(!sha){const e=new Error("GitHub branch has no commit SHA");e.code="GITHUB_BRANCH_INVALID";throw e}
   const [prs,status,checks,compare]=await Promise.all([
    jsonRequest(fetchImpl,apiUrl(repoRef.owner,repoRef.repo,"pulls?state=all&head="+encodeURIComponent(repoRef.owner+":"+branch)+"&per_page=20"),{optional:true}),
    jsonRequest(fetchImpl,apiUrl(repoRef.owner,repoRef.repo,"commits/"+sha+"/status"),{optional:true}),
    jsonRequest(fetchImpl,apiUrl(repoRef.owner,repoRef.repo,"commits/"+sha+"/check-runs"),{optional:true}),
    jsonRequest(fetchImpl,apiUrl(repoRef.owner,repoRef.repo,"compare/"+encodeURIComponent(defaultBranch)+"..."+sha),{optional:true})
   ]);
   const pr=Array.isArray(prs)?prs.find(x=>x?.head?.ref===branch)||prs[0]||null:null;
   const presentOnMain=branch===defaultBranch||["behind","identical"].includes(compare?.status);
   return {
    branchExists:true,
    commitExists:true,
    prExists:!!pr?.number,
    ciPassed:statusChecksPassed(status,checks),
    merged:!!pr?.merged_at,
    presentOnMain,
    commit:sha,
    pr:pr?.number||null,
    url:pr?.html_url||null,
    source:"github-rest-fallback",
    checkedAt:Date.now(),
    evidence:{repository:repoRef.fullName,branch,defaultBranch,sha,combinedStatus:status?.state||null,checkRuns:checks?.total_count??0,compareStatus:compare?.status||null,pr:pr?{number:pr.number,mergedAt:pr.merged_at,url:pr.html_url}:null}
   };
  }
 };
}
function decodeBase64(v){
 if(typeof atob==="function")return decodeURIComponent(Array.prototype.map.call(atob(v.replace(/\n/g,"")),c=>"%"+c.charCodeAt(0).toString(16).padStart(2,"0")).join(""));
 if(typeof Buffer!=="undefined")return Buffer.from(v,"base64").toString("utf8");
 return "";
}
function extractCodeFacts(path,text){
 const symbols=[],edges=[];
 const symbolRe=/\b(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|enum|const|let|var)\s+([A-Za-z_$][\w$]*)/g;
 let m;while((m=symbolRe.exec(text))&&symbols.length<12)symbols.push({path,name:m[1]});
 const depRes=[
  /\bfrom\s+["']([^"']+)["']/g,
  /\brequire\(\s*["']([^"']+)["']\s*\)/g,
  /\bimport\(\s*["']([^"']+)["']\s*\)/g
 ];
 for(const re of depRes){while((m=re.exec(text))&&edges.length<12)edges.push({from:path,to:m[1]})}
 return {symbols,edges};
}
function scorePath(path,terms){
 const low=path.toLowerCase();let score=0;
 for(const t of terms){if(low.includes(t))score+=t.includes("/")?8:3}
 if(/(?:^|\/)(?:src|lib|app|packages|server|client|codex-sidepanel|titan-workforce)\//.test(low))score+=2;
 if(/(?:test|spec|__tests__)/.test(low))score+=1;
 return score;
}
export function createRepositoryRestService({fetchImpl=globalThis.fetch,maxFiles=12,maxContentFiles=6}={}){
 if(typeof fetchImpl!=="function")return null;
 return {
  source:"github-rest-fallback",
  capabilities:["query","files","tests","symbols","dependencies"],
  async query({mission={},transcript="",limit=maxFiles}={}){
   const repoRef=parseRepo(mission.repository||mission.repo);
   const meta=await jsonRequest(fetchImpl,apiUrl(repoRef.owner,repoRef.repo));
   const branch=mission.branch||meta.default_branch||"main";
   const tree=await jsonRequest(fetchImpl,apiUrl(repoRef.owner,repoRef.repo,"git/trees/"+encodeURIComponent(branch)+"?recursive=1"));
   const terms=keywords(missionText(mission,transcript));
   const blobs=(tree?.tree||[]).filter(x=>x.type==="blob"&&x.path).map(x=>({path:x.path,size:x.size||0,score:scorePath(x.path,terms)}));
   blobs.sort((a,b)=>b.score-a.score||a.path.localeCompare(b.path));
   const chosen=blobs.slice(0,clamp(Number(limit)||maxFiles,1,maxFiles));
   const tests=chosen.filter(x=>/(?:test|spec|__tests__)/i.test(x.path)).map(x=>x.path);
   const codeCandidates=chosen.filter(x=>/\.(?:m?[jt]sx?|tsx?|json|py|php|go|rs|java|kt|rb|sh)$/i.test(x.path)).slice(0,maxContentFiles);
   const facts=await Promise.all(codeCandidates.map(async x=>{
    const data=await jsonRequest(fetchImpl,apiUrl(repoRef.owner,repoRef.repo,"contents/"+x.path+"?ref="+encodeURIComponent(branch)),{optional:true});
    if(!data?.content||data.encoding!=="base64")return {symbols:[],edges:[]};
    try{return extractCodeFacts(x.path,decodeBase64(data.content))}catch{return {symbols:[],edges:[]}}
   }));
   const symbols=facts.flatMap(x=>x.symbols).slice(0,12);
   const edges=facts.flatMap(x=>x.edges).slice(0,12);
   return {
    source:"github-rest-fallback",
    repository:repoRef.fullName,
    branch,
    files:chosen.map(x=>x.path),
    tests:tests.slice(0,8),
    symbols,
    edges,
    summary:"Repository context from GitHub REST: "+chosen.length+" files, "+symbols.length+" symbols, "+edges.length+" dependency edges."
   };
  }
 };
}
function extractJson(text){
 const raw=String(text||"").trim();
 const fenced=raw.match(/\x60\x60\x60(?:json)?\s*([\s\S]*?)\x60\x60\x60/i);
 const candidate=(fenced?.[1]||raw).trim();
 try{return JSON.parse(candidate)}catch{}
 const obj=candidate.match(/\{[\s\S]*\}/);
 if(obj)try{return JSON.parse(obj[0])}catch{}
 return null;
}
export function createConversationCodexService({registry,conversationService,pollMs=DEFAULT_POLL_MS,timeoutMs=DEFAULT_TIMEOUT_MS,sleepFn=sleep}={}){
 if(!registry||!conversationService)return null;
 async function run(slotId,payload,kind){
  const slot=registry.get(slotId);if(!slot)throw new Error("Unknown Codex slot "+slotId);
  if(!slot.conversation){const e=new Error("Codex slot conversation is not bound: "+slotId);e.code="CODEX_CONVERSATION_UNBOUND";throw e}
  const before=await conversationService.observe(slot.conversation);
  const instruction=[
   "TITAN "+kind.toUpperCase()+" REQUEST",
   "Return machine-readable JSON when the request specifies an output contract.",
   JSON.stringify(payload,null,2)
  ].join("\n\n");
  await conversationService.send({conversation:slot.conversation,instruction,idempotencyKey:payload?.packet_id||payload?.packetId||payload?.id||kind+":"+Date.now()});
  const started=Date.now();
  while(Date.now()-started<timeoutMs){
   await sleepFn(pollMs);
   const now=await conversationService.observe(slot.conversation);
   if((now?.assistantCount||0)>(before?.assistantCount||0)&&!now?.generating&&String(now?.lastText||"").trim()){
    return {text:String(now.lastText).trim(),parsed:extractJson(now.lastText)};
   }
  }
  const e=new Error("Codex response timed out for "+slotId);e.code="CODEX_RESPONSE_TIMEOUT";throw e;
 }
 return {
  source:"conversation-fallback",
  capabilities:["review","build","orchestrate"],
  async review(job={}){
   const out=await run(job.orchestratorId||"ORCHESTRATOR",job,"review");
   return out.parsed?.instruction||out.text;
  },
  async build({builderId,packet}={}){
   const out=await run(builderId,packet,"build");
   return out.parsed||{files_changed:[],diff:"",tests:[],blockers:[],remaining_implementation:[],summary:out.text,source:"conversation-fallback"};
  },
  async orchestrate({orchestratorId="ORCHESTRATOR",bundle}={}){
   const out=await run(orchestratorId,bundle,"orchestrate");
   return out.parsed||{summary:out.text,source:"conversation-fallback"};
  }
 };
}
export function installStockServiceFallbacks(services,{registry=null,conversationService=null,fetchImpl=globalThis.fetch,audit=()=>{}}={}){
 const installed=[];
 if(!services.available("codex")){
  const codex=createConversationCodexService({registry,conversationService});
  if(codex){services.register("codex",codex);installed.push("codex")}
 }
 if(!services.available("github")){
  const github=createGitHubRestService({fetchImpl});
  if(github){services.register("github",github);installed.push("github")}
 }
 if(!services.available("repository")){
  const repository=createRepositoryRestService({fetchImpl});
  if(repository){services.register("repository",repository);installed.push("repository")}
 }
 audit("stock-service-fallbacks-installed",{installed,status:services.status()});
 return {installed,status:services.status()};
}
