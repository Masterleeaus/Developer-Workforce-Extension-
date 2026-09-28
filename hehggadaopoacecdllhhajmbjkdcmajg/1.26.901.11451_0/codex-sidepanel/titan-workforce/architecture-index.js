export const TITAN_ARCHITECTURE_INDEX_VERSION="2026.09-v1";

const ENTRIES=Object.freeze([
 {id:"tenancy",domains:["tenant","company","crm","security","database"],patterns:["tenant_company_id","company_id","tenant","company scope","cross-company"],summary:"Canonical Titan tenancy separates the operating business tenant from CRM customer companies.",invariants:["Resolve tenant_company_id before company-scoped business access and fail closed when unresolved.","Do not use actor user_id as the tenant boundary.","Cross-company access must be explicitly authorized."]},
 {id:"mutation-path",domains:["authority","execution","workforce","crm","field"],patterns:["authority","executiongateway","mutation","write","command","work order","field action"],summary:"Business mutations preserve the Authority -> ExecutionGateway execution path and evidence.",invariants:["Do not bypass Authority for protected business mutations.","ExecutionGateway remains the canonical side-effect boundary.","Preserve actor, correlation, idempotency and evidence references."]},
 {id:"business-state",domains:["architecture","state","crm","commerce","workforce"],patterns:["source of truth","state","duplicate","engine","repository","canonical"],summary:"Titan avoids duplicate engines and parallel business-state sources of truth.",invariants:["Extend canonical engines/state rather than creating competing stores.","Adapters may cache derived data but must not become authoritative business state."]},
 {id:"mobile-pwa",domains:["mobile","pwa","offline","titan go","titan command","titan hub"],patterns:["pwa","offline","titan go","titan command","titan hub","mobile"],summary:"Mobile/PWA surfaces consume canonical platform capabilities and preserve offline/reconciliation contracts.",invariants:["PWA and full web application are distinct surfaces.","Offline mutations require durable identity, revision/idempotency and reconciliation."]},
 {id:"directadmin",domains:["directadmin","server","plugin","hosting","runtime"],patterns:["directadmin","plugin.conf","server","domain","email","hosting"],summary:"DirectAdmin is Titan's server-adjacent control surface and plugin host for infrastructure/business capabilities.",invariants:["Keep user-facing products separate from server-side plugin infrastructure.","Server capabilities expose bounded audited interfaces to the workforce."]},
 {id:"workforce",domains:["workforce","agents","codex","chat","work"],patterns:["agent","workforce","chat_worker","work_supervisor","codex_builder","orchestrator"],summary:"The Developer Workforce uses 10 Chat workers, 2 Work supervisors, 2 Codex builders and 1 Orchestrator under deterministic Titan control.",invariants:["Models do not own scheduling clocks or authoritative mission state.","Preserve provenance Mission -> Chat -> Work -> Approved Delta -> Codex -> Orchestrator -> verification.","Git/CI/runtime evidence outrank agent completion claims."]},
 {id:"commerce",domains:["commerce","inventory","orders","payments","marketplace"],patterns:["commerce","inventory","order","listing","amazon","ebay","etsy","shopify","payment"],summary:"Titan Commerce maintains unified catalogue/order/inventory semantics across external channels.",invariants:["Channel adapters do not become independent sources of truth.","Writes require preview/idempotency and reconciliation evidence."]},
 {id:"verification",domains:["verification","git","ci","runtime","acceptance","evidence"],patterns:["test","ci","runtime","verify","acceptance","evidence","deploy"],summary:"Completion requires authoritative Git, CI, runtime and acceptance evidence appropriate to the mission.",invariants:["Merged code is not equivalent to runtime success.","Missing required evidence remains pending/fail-closed rather than inferred as passing."]}
]);

function words(input){return new Set(String(input||"").toLowerCase().split(/[^a-z0-9_.:/-]+/).filter(x=>x.length>2))}
function missionText(mission={}){return [mission.id,mission.title,mission.goal,mission.repository,...(mission.scopePaths||mission.scope_paths||[]),...(mission.constraints||[]),...(mission.acceptanceCriteria||mission.acceptance_criteria||[]),...(mission.verificationRequirements||mission.runtime_requirements||[]),...(mission.tags||[])].filter(Boolean).join(" ").toLowerCase()}
function score(text,entry){let n=0;for(const pattern of entry.patterns)if(text.includes(pattern.toLowerCase()))n+=pattern.includes(" ")?5:3;const set=words(text);for(const d of entry.domains)if(set.has(d.toLowerCase()))n+=2;return n}

export class TitanArchitectureIndex{
 constructor({version=TITAN_ARCHITECTURE_INDEX_VERSION,entries=ENTRIES,audit=()=>{}}={}){this.version=version;this.entries=entries.map(x=>structuredClone(x));this.audit=audit}
 list(){return structuredClone(this.entries)}
 get(id){const x=this.entries.find(e=>e.id===id);return x?structuredClone(x):null}
 relevant(mission,{limit=5}={}){
  const text=missionText(mission);
  const ranked=this.entries.map(entry=>({entry,score:score(text,entry)})).sort((a,b)=>b.score-a.score||a.entry.id.localeCompare(b.entry.id));
  const selected=ranked.filter(x=>x.score>0).slice(0,Math.max(1,limit));
  if(!selected.length)selected.push({entry:this.entries.find(x=>x.id==="business-state")||this.entries[0],score:0});
  return{version:this.version,entryIds:selected.map(x=>x.entry.id),entries:selected.map(x=>structuredClone(x.entry))};
 }
 compile(mission,options={}){
  const slice=this.relevant(mission,options),lines=["TITAN ARCHITECTURE INDEX "+slice.version];
  for(const e of slice.entries){lines.push("",e.id+": "+e.summary);for(const invariant of e.invariants)lines.push("- "+invariant)}
  return{...slice,text:lines.join("\n")};
 }
 snapshot(){return{version:this.version,entries:this.list()}}
}
