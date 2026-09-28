const MAX_CONTENT=120000;
const clone=x=>x==null?x:structuredClone(x);
const normalizePath=p=>String(p||"").replaceAll("\\","/").replace(/^\.\/+/,"").replace(/\/+/g,"/");
const tokenize=x=>String(x||"").toLowerCase().split(/[^a-z0-9_.:/-]+/).filter(t=>t.length>2);

function classify(path){
 const p=path.toLowerCase(),kinds=[];
 if(/(^|\/)(test|tests|__tests__|spec)(\/|$)|\.(test|spec)\.[^.]+$/.test(p))kinds.push("test");
 if(/migration|migrations|schema|\.sql$/.test(p))kinds.push("migration");
 if(/engine/.test(p))kinds.push("engine");
 if(/gateway/.test(p))kinds.push("gateway");
 if(/plugin|plugin\.conf/.test(p))kinds.push("plugin");
 if(/directadmin|server|runtime|deploy|installer|systemd|nginx/.test(p))kinds.push("runtime");
 if(/apps\/|surface|pwa|mobile|frontend|ui\//.test(p))kinds.push("surface");
 return kinds;
}
function extractSymbols(content=""){
 const out=[];
 const patterns=[/\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,/\bclass\s+([A-Za-z_$][\w$]*)/g,/\b(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=/g,/\bdef\s+([A-Za-z_][\w]*)\s*\(/g,/\b(?:class|interface|trait)\s+([A-Za-z_][\w]*)/g];
 for(const re of patterns){let m;while((m=re.exec(content))&&out.length<250)out.push(m[1])}
 return [...new Set(out)];
}
function extractImports(content=""){
 const out=[];
 const patterns=[/\bfrom\s+["']([^"']+)["']/g,/\brequire\(\s*["']([^"']+)["']\s*\)/g,/\bimport\s+["']([^"']+)["']/g,/\buse\s+([A-Za-z_\\][A-Za-z0-9_\\]+)/g];
 for(const re of patterns){let m;while((m=re.exec(content))&&out.length<250)out.push(m[1])}
 return [...new Set(out)];
}
function extractRoutes(content=""){
 const out=[],patterns=[/\b(?:app|router)\.(?:get|post|put|patch|delete)\(\s*["']([^"']+)["']/g,/\bRoute::(?:get|post|put|patch|delete)\(\s*["']([^"']+)["']/g,/@(?:app|router)\.(?:get|post|put|patch|delete)\(\s*["']([^"']+)["']/g];
 for(const re of patterns){let m;while((m=re.exec(content))&&out.length<100)out.push(m[1])}
 return [...new Set(out)];
}
function extractTables(content=""){
 const out=[];let m;const re=/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["']?([A-Za-z0-9_.-]+)/gi;
 while((m=re.exec(content))&&out.length<100)out.push(m[1]);return [...new Set(out)];
}
function resolveRelative(from,dep){
 if(!dep.startsWith("."))return null;
 const parts=normalizePath(from).split("/");parts.pop();
 for(const bit of dep.split("/")){if(bit==="."||!bit)continue;if(bit==="..")parts.pop();else parts.push(bit)}
 return normalizePath(parts.join("/"));
}
function scoreFile(file,tokens){
 let score=0;const path=file.path.toLowerCase();
 for(const token of tokens){if(path.includes(token))score+=4;if(file.symbols.some(s=>s.toLowerCase().includes(token)))score+=3;if(file.kinds.some(k=>k.includes(token)))score+=2;if(file.routes.some(r=>r.toLowerCase().includes(token)))score+=3;if(file.tables.some(t=>t.toLowerCase().includes(token)))score+=3}
 return score;
}

export class TitanRepositoryIntelligence{
 constructor({state=null,audit=()=>{}}={}){this.state=state||{};this.audit=audit;this.state.repositoryIntelligence=this.state.repositoryIntelligence||{indexes:{},latestByRepository:{}}}
 key(repository,commit){return String(repository)+"@"+String(commit)}
 createIndex({repository,commit,files=[],ownership={},history=[]}){
  if(!repository||!commit)throw new Error("repository and commit are required");
  const records={};
  for(const raw of files){
   const path=normalizePath(raw.path||raw.filename);if(!path)continue;
   const source=String(raw.content||"").slice(0,MAX_CONTENT);
   records[path]={path,size:Number(raw.size||source.length||0),sha:raw.sha||null,symbols:raw.symbols?clone(raw.symbols):extractSymbols(source),imports:raw.imports?clone(raw.imports):extractImports(source),routes:raw.routes?clone(raw.routes):extractRoutes(source),tables:raw.tables?clone(raw.tables):extractTables(source),kinds:[...new Set([...(raw.kinds||[]),...classify(path)])],ownership:clone(raw.ownership||ownership[path]||null),updatedAt:Date.now()};
  }
  const index={schemaVersion:1,repository,commit,createdAt:Date.now(),updatedAt:Date.now(),files:records,history:clone(history).slice(-200),edges:[],duplicates:[]};
  this.rebuild(index);const key=this.key(repository,commit);this.state.repositoryIntelligence.indexes[key]=index;this.state.repositoryIntelligence.latestByRepository[repository]=key;
  this.audit("repository-index-created",{repository,commit,files:Object.keys(records).length});return clone(index);
 }
 rebuild(index){
  const paths=new Set(Object.keys(index.files)),edges=[],symbolOwners=new Map();
  for(const file of Object.values(index.files)){
   for(const symbol of file.symbols){if(!symbolOwners.has(symbol))symbolOwners.set(symbol,[]);symbolOwners.get(symbol).push(file.path)}
   for(const dep of file.imports){
    const target=resolveRelative(file.path,dep);if(!target)continue;
    const candidates=[target,target+".js",target+".mjs",target+".ts",target+".tsx",target+"/index.js",target+"/index.ts"];
    const resolved=candidates.find(x=>paths.has(x));if(resolved)edges.push({from:file.path,to:resolved,type:"import"});
   }
  }
  index.edges=edges;
  index.duplicates=[...symbolOwners.entries()].filter(([symbol,owners])=>owners.length>1&&!/^(default|constructor)$/.test(symbol)).map(([symbol,owners])=>({symbol,files:owners})).slice(0,200);
  index.updatedAt=Date.now();return index;
 }
 latest(repository){const key=this.state.repositoryIntelligence.latestByRepository[repository];return key?clone(this.state.repositoryIntelligence.indexes[key]):null}
 get(repository,commit){return clone(this.state.repositoryIntelligence.indexes[this.key(repository,commit)]||null)}
 isStale(repository,commit){const latest=this.latest(repository);return !latest||latest.commit!==commit}
 applyChanges({repository,baseCommit,nextCommit,changes=[]}){
  const base=this.get(repository,baseCommit)||this.latest(repository);if(!base)throw new Error("base repository index is unavailable");
  const next=clone(base);next.commit=nextCommit;next.createdAt=Date.now();
  for(const change of changes){
   const path=normalizePath(change.path||change.filename);
   if(change.status==="removed"||change.deleted===true){delete next.files[path];continue}
   const source=String(change.content||"").slice(0,MAX_CONTENT);
   next.files[path]={path,size:Number(change.size||source.length||0),sha:change.sha||null,symbols:change.symbols?clone(change.symbols):extractSymbols(source),imports:change.imports?clone(change.imports):extractImports(source),routes:change.routes?clone(change.routes):extractRoutes(source),tables:change.tables?clone(change.tables):extractTables(source),kinds:[...new Set([...(change.kinds||[]),...classify(path)])],ownership:clone(change.ownership||next.files[path]?.ownership||null),updatedAt:Date.now()};
  }
  this.rebuild(next);next.history=[...(next.history||[]),{from:base.commit,to:nextCommit,changed:changes.map(x=>normalizePath(x.path||x.filename)),at:Date.now()}].slice(-200);
  const key=this.key(repository,nextCommit);this.state.repositoryIntelligence.indexes[key]=next;this.state.repositoryIntelligence.latestByRepository[repository]=key;
  this.audit("repository-index-incremental",{repository,baseCommit,nextCommit,changes:changes.length});return clone(next);
 }
 impact(repository,commit,changedPaths,{depth=2}={}){
  const index=this.get(repository,commit);if(!index)throw new Error("repository index unavailable");
  const changed=new Set(changedPaths.map(normalizePath)),impacted=new Set(changed);
  for(let d=0;d<depth;d++)for(const edge of index.edges)if(impacted.has(edge.to))impacted.add(edge.from);
  const tests=Object.values(index.files).filter(f=>f.kinds.includes("test")&&[...impacted].some(p=>f.imports.some(dep=>(resolveRelative(f.path,dep)||"").startsWith(p.replace(/\.[^.]+$/,"")))));
  return{changed:[...changed],impacted:[...impacted],tests:tests.map(x=>x.path),edges:index.edges.filter(e=>impacted.has(e.from)||impacted.has(e.to))};
 }
 query(mission,{repository=mission.repository||mission.repo,commit=null,maxFiles=12,maxSymbols=20,maxEdges=20,maxTests=8}={}){
  const index=commit?this.get(repository,commit):this.latest(repository);if(!index)throw new Error("repository index unavailable");
  const tokens=[...new Set(tokenize([mission.title,mission.goal,...(mission.scopePaths||mission.scope_paths||[]),...(mission.constraints||[]),...(mission.acceptanceCriteria||mission.acceptance_criteria||[])].filter(Boolean).join(" ")))];
  const ranked=Object.values(index.files).map(file=>({file,score:scoreFile(file,tokens)})).sort((a,b)=>b.score-a.score||a.file.path.localeCompare(b.file.path));
  const selected=ranked.filter(x=>x.score>0).slice(0,maxFiles);if(!selected.length)selected.push(...ranked.slice(0,Math.min(3,maxFiles)));
  const selectedPaths=new Set(selected.map(x=>x.file.path)),edges=index.edges.filter(e=>selectedPaths.has(e.from)||selectedPaths.has(e.to)).slice(0,maxEdges),symbols=[...new Set(selected.flatMap(x=>x.file.symbols))].slice(0,maxSymbols);
  const tests=Object.values(index.files).filter(f=>f.kinds.includes("test")&&(selectedPaths.has(f.path)||edges.some(e=>e.from===f.path||e.to===f.path))).map(f=>f.path).slice(0,maxTests);
  return{repository:index.repository,commit:index.commit,stale:this.isStale(repository,index.commit),files:selected.map(x=>({path:x.file.path,kinds:x.file.kinds,score:x.score,ownership:x.file.ownership})),symbols,tests,edges,duplicates:index.duplicates.filter(d=>d.files.some(p=>selectedPaths.has(p))).slice(0,10)};
 }
 status(repository){const latest=this.latest(repository);return latest?{repository,commit:latest.commit,files:Object.keys(latest.files).length,edges:latest.edges.length,duplicates:latest.duplicates.length,updatedAt:latest.updatedAt}:null}
 snapshot(){return clone(this.state.repositoryIntelligence)}
}
