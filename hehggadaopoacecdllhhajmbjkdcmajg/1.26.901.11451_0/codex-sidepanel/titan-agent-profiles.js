(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  if(root)root.TitanAgentProfiles=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
"use strict";

const EXECUTION_CLASSES=Object.freeze(["chat_worker","work_supervisor","codex_builder","codex_orchestrator"]);
const GLOBAL_INVARIANTS=Object.freeze([
  "Fail closed when tenant/company scope is unresolved.",
  "Reuse existing Titan engines, gateways and state; do not create duplicate business state or sources of truth.",
  "Preserve Authority and ExecutionGateway mutation paths for governed side effects.",
  "Preserve idempotency, actor, correlation, provenance and evidence across work.",
  "Keep one active branch/worktree per mission unless the mission contract explicitly says otherwise.",
  "Treat GitHub, CI and runtime evidence as higher-confidence truth than agent claims.",
  "Do not weaken existing acceptance, runtime verification or security controls."
]);
const DEFAULT_OUTPUT=Object.freeze([
  "Return concrete findings and actions, not unsupported completion claims.",
  "Name files/components touched or inspected when implementation work is involved.",
  "Report verification performed and unresolved risks or blockers.",
  "Preserve mission identifiers and scope in handoff output."
]);
const DEFAULT_RISK=Object.freeze([
  "Prefer minimal-scope changes.",
  "Escalate destructive, cross-tenant, privileged, credential, payment or production-impacting operations.",
  "Do not bypass verification or policy gates to make a mission appear complete."
]);

function uniq(a){return Object.freeze(Array.from(new Set((a||[]).filter(Boolean).map(String))))}
function slug(v){return String(v||"").trim().toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"")}
function normalize(p){
  const id=slug(p.id||p.name);
  if(!id)throw new Error("Profile id/name is required");
  const preferred=p.preferredExecutionClass||"chat_worker";
  const compatible=uniq(p.compatibleExecutionClasses||[preferred]);
  if(!EXECUTION_CLASSES.includes(preferred))throw new Error("Invalid preferred execution class for "+id);
  if(!compatible.length||compatible.some(x=>!EXECUTION_CLASSES.includes(x)))throw new Error("Invalid compatible execution classes for "+id);
  if(!compatible.includes(preferred))throw new Error("Preferred execution class must be compatible for "+id);
  return Object.freeze({
    id,
    name:p.name||id,
    role:p.role||"Titan engineering specialist",
    domain:p.domain||p.name||id,
    expertise:uniq(p.expertise),
    architectureContext:uniq(p.architectureContext),
    invariants:uniq([...(p.invariants||[]),...GLOBAL_INVARIANTS]),
    preferredExecutionClass:preferred,
    compatibleExecutionClasses:compatible,
    allowedCapabilities:uniq(p.allowedCapabilities),
    verificationRequirements:uniq(p.verificationRequirements||["mission_acceptance"]),
    outputContract:uniq(p.outputContract||DEFAULT_OUTPUT),
    riskPolicyHints:uniq(p.riskPolicyHints||DEFAULT_RISK),
    scopePatterns:uniq(p.scopePatterns),
    tags:uniq(p.tags),
    composition:Object.freeze({
      allowAsPrimary:p.allowAsPrimary!==false&&!p.secondaryOnly,
      allowAsSecondary:p.allowAsSecondary!==false&&!p.primaryOnly,
      maxSecondary:Number.isInteger(p.maxSecondary)?p.maxSecondary:null
    })
  });
}
const ALL=[...EXECUTION_CLASSES];
const BUILD=["work_supervisor","codex_builder","codex_orchestrator"];
const ORCH=["work_supervisor","codex_orchestrator"];
const COMMON_CTX=[
  "Titan deterministic control plane.",
  "Mission -> Chat passes -> Work review -> Approved Delta -> Codex -> Orchestrator -> verification provenance."
];
const COMMON_CAP=["read_repo","read_mission","reason","produce_handoff"];
function spec(name,domain,opts){
  opts=opts||{};
  return normalize({
    name,domain,
    expertise:opts.expertise||[domain],
    architectureContext:[...COMMON_CTX,...(opts.architectureContext||[])],
    invariants:opts.invariants,
    preferredExecutionClass:opts.preferredExecutionClass||"chat_worker",
    compatibleExecutionClasses:opts.compatibleExecutionClasses||ALL,
    allowedCapabilities:[...COMMON_CAP,...(opts.allowedCapabilities||[])],
    verificationRequirements:opts.verificationRequirements||["mission_acceptance"],
    outputContract:opts.outputContract,
    riskPolicyHints:opts.riskPolicyHints,
    scopePatterns:opts.scopePatterns||[name,domain],
    tags:opts.tags,
    secondaryOnly:opts.secondaryOnly,
    primaryOnly:opts.primaryOnly,
    allowAsPrimary:opts.allowAsPrimary,
    allowAsSecondary:opts.allowAsSecondary,
    maxSecondary:opts.maxSecondary
  });
}
const CATALOGUE=[
spec("Architecture","core architecture",{preferredExecutionClass:"work_supervisor",expertise:["boundaries","dependency direction","state ownership","architecture invariants"],scopePatterns:["architecture","architectural","boundary","dependency","source of truth","control plane"]}),
spec("Interaction Engine","interaction engine",{expertise:["intent/context ingestion","conversation routing","tool surface contracts"],scopePatterns:["interaction engine","conversation engine","interaction"]}),
spec("Decision Engine","decision engine",{expertise:["decision policy","recommendation/approval separation","deterministic routing"],scopePatterns:["decision engine","decision policy","decisioning"]}),
spec("Authority","authority",{preferredExecutionClass:"work_supervisor",expertise:["authorization","approval gates","policy enforcement"],verificationRequirements:["authorization_tests","mission_acceptance"],scopePatterns:["authority","authorization","approval gate","permission"]}),
spec("ExecutionGateway","execution gateway",{expertise:["governed mutations","idempotency","side-effect boundaries"],verificationRequirements:["mutation_path_tests","idempotency_tests","mission_acceptance"],scopePatterns:["executiongateway","execution gateway","mutation path","side effect"]}),
spec("Workforce","engineering workforce",{preferredExecutionClass:"work_supervisor",expertise:["agent coordination","mission state","handoff contracts"],scopePatterns:["workforce","agent registry","worker","supervisor"]}),
spec("CRM","crm",{expertise:["company-scoped CRM","customers/contacts/services/work-order relationships"],scopePatterns:["crm","customer","contact","lead"]}),
spec("Scheduling","scheduling",{expertise:["appointments","availability","constraints","recurrence"],scopePatterns:["schedule","scheduling","appointment","availability","calendar"]}),
spec("Dispatch","dispatch",{expertise:["assignment","routing","capacity","field coordination"],scopePatterns:["dispatch","assignment","route","crew allocation"]}),
spec("Work Orders","work orders",{expertise:["job lifecycle","tasks/checklists","evidence capture"],scopePatterns:["work order","work-order","job lifecycle","job completion"]}),
spec("Quotes/Invoices","quotes and invoices",{expertise:["quote lifecycle","invoice lifecycle","line items","tax/total integrity"],scopePatterns:["quote","invoice","estimate","billing document"]}),
spec("Payments","payments",{preferredExecutionClass:"work_supervisor",expertise:["payment intents","refunds","reconciliation","financial integrity"],verificationRequirements:["financial_integrity_tests","authorization_tests","mission_acceptance"],scopePatterns:["payment","refund","payid","paypal","settlement"]}),
spec("Commerce","commerce",{expertise:["catalogue","orders","marketplace adapters","returns"],scopePatterns:["commerce","shopify","amazon","ebay","etsy","woocommerce","order"]}),
spec("Inventory","inventory",{expertise:["stock ledger","reservations","adjustments","conflict resolution"],scopePatterns:["inventory","stock","reservation","sku"]}),
spec("Omni/communications","omni communications",{expertise:["inbox","multi-channel messaging","communication routing"],scopePatterns:["omni","communications","inbox","email","sms","message"]}),
spec("Titan Go","field worker surface",{expertise:["offline field payload","field mutations","worker UX"],scopePatterns:["titan go","field app","field worker","technician app"]}),
spec("Owner surface","owner/manager surface",{expertise:["owner dashboard","approvals","business command surface"],scopePatterns:["owner surface","owner dashboard","manager dashboard","titan zero"]}),
spec("Customer/Titan Hub","customer surface",{expertise:["customer self-service","bookings","quotes","invoices","support"],scopePatterns:["titan hub","customer portal","customer surface","self-service"]}),
spec("DirectAdmin","directadmin/server control surface",{preferredExecutionClass:"codex_builder",compatibleExecutionClasses:BUILD,expertise:["server integration","plugin packaging","hosting control plane"],verificationRequirements:["server_verification","mission_acceptance"],scopePatterns:["directadmin","plugin.conf","server control"]}),
spec("Onboarding","onboarding",{expertise:["business profile","services","hours","staff","booking rules"],scopePatterns:["onboarding","setup wizard","business setup"]}),
spec("UI/UX","ui and ux",{expertise:["interaction design","information hierarchy","responsive flows"],scopePatterns:["ui","ux","interface","layout","design system"]}),
spec("Accessibility","accessibility",{expertise:["WCAG","keyboard navigation","screen readers","semantic UI"],verificationRequirements:["accessibility_checks","mission_acceptance"],scopePatterns:["accessibility","a11y","wcag","screen reader","keyboard navigation"]}),
spec("PWA/offline","pwa and offline",{expertise:["service workers","offline queues","sync/replay","cache strategy"],verificationRequirements:["offline_replay_tests","mission_acceptance"],scopePatterns:["pwa","offline","service worker","sync queue","cache"]}),
spec("VPS/Linux","vps and linux",{preferredExecutionClass:"codex_builder",compatibleExecutionClasses:BUILD,expertise:["linux services","permissions","process/network diagnostics"],verificationRequirements:["server_verification","mission_acceptance"],scopePatterns:["vps","linux","systemd","nginx","apache","ssh"]}),
spec("Installer/upgrades","installer and upgrades",{preferredExecutionClass:"codex_builder",expertise:["installation","upgrade safety","rollback","version migration"],verificationRequirements:["fresh_install_test","upgrade_test","rollback_test","mission_acceptance"],scopePatterns:["installer","install","upgrade","rollback","migration script"]}),
spec("SQLite/database","sqlite and database",{preferredExecutionClass:"codex_builder",expertise:["schema","transactions","constraints","query plans"],verificationRequirements:["database_tests","migration_tests","mission_acceptance"],scopePatterns:["sqlite","database","schema","sql","index","transaction"]}),
spec("API/integrations","apis and integrations",{expertise:["API contracts","webhooks","OAuth","adapter boundaries"],verificationRequirements:["contract_tests","integration_tests","mission_acceptance"],scopePatterns:["api","integration","webhook","oauth","adapter"]}),
spec("MCP/plugins","mcp and plugins",{expertise:["plugin contracts","capability registration","tool adapters"],scopePatterns:["mcp","plugin","connector","tool capability"]}),
spec("Git/worktrees","git and worktrees",{preferredExecutionClass:"codex_builder",expertise:["branch discipline","worktrees","merge/conflict handling"],verificationRequirements:["git_state_check","mission_acceptance"],scopePatterns:["git","branch","worktree","merge conflict","pull request","pr"]}),
spec("CI/CD","ci and cd",{expertise:["pipelines","checks","artifacts","deployment gates"],verificationRequirements:["ci_pass","mission_acceptance"],scopePatterns:["ci","cd","github actions","pipeline","workflow"]}),
spec("Unit testing","unit testing",{secondaryOnly:true,expertise:["isolated tests","fixtures","deterministic assertions"],verificationRequirements:["unit_tests"],scopePatterns:["unit test","unit testing","spec"]}),
spec("Integration testing","integration testing",{secondaryOnly:true,expertise:["component integration","contract boundaries","real adapters where safe"],verificationRequirements:["integration_tests"],scopePatterns:["integration test","integration testing","contract test"]}),
spec("E2E/browser QA","end-to-end browser qa",{secondaryOnly:true,expertise:["browser workflows","console/network checks","acceptance journeys"],verificationRequirements:["e2e_tests","browser_verification"],scopePatterns:["e2e","end-to-end","browser qa","playwright","chrome"]}),
spec("Security","security",{preferredExecutionClass:"work_supervisor",expertise:["threat boundaries","authn/authz","secrets","input/output hardening"],verificationRequirements:["security_checks","authorization_tests","mission_acceptance"],scopePatterns:["security","auth","secret","credential","csrf","xss","injection"]}),
spec("Tenant isolation","tenant isolation",{preferredExecutionClass:"work_supervisor",expertise:["company scoping","fail-closed tenancy","cross-tenant denial"],verificationRequirements:["tenant_isolation_tests","mission_acceptance"],scopePatterns:["tenant","company_id","tenant_company_id","cross-company","cross tenant"]}),
spec("Performance","performance",{secondaryOnly:true,expertise:["latency","throughput","query/render hot paths","profiling"],verificationRequirements:["performance_measurement"],scopePatterns:["performance","latency","slow","throughput","profiling"]}),
spec("Reliability/recovery","reliability and recovery",{expertise:["restart recovery","retry safety","backpressure","failure containment"],verificationRequirements:["recovery_tests","idempotency_tests","mission_acceptance"],scopePatterns:["reliability","recovery","restart","retry","backpressure","failure"]}),
spec("Migration/compatibility","migration and compatibility",{secondaryOnly:true,expertise:["schema/state migration","backward compatibility","versioned contracts"],verificationRequirements:["migration_tests","compatibility_tests"],scopePatterns:["migration","compatibility","backward compatible","legacy","version"]}),
spec("Regression","regression prevention",{secondaryOnly:true,expertise:["regression surface","unchanged behavior","guard tests"],verificationRequirements:["regression_tests"],scopePatterns:["regression","do not break","preserve existing"]}),
spec("Refactoring/code quality","refactoring and code quality",{expertise:["modularity","cohesion","dead code","naming","maintainability"],scopePatterns:["refactor","code quality","cleanup","modularize","monolith"]}),
spec("Documentation","documentation",{expertise:["developer docs","runbooks","API docs","architecture notes"],scopePatterns:["documentation","docs","readme","runbook"]}),
spec("Evidence/audit","evidence and audit",{preferredExecutionClass:"work_supervisor",expertise:["evidence chains","audit logs","provenance","claim verification"],verificationRequirements:["evidence_check","mission_acceptance"],scopePatterns:["evidence","audit","provenance","verification"]}),
spec("Mission planning","mission planning",{preferredExecutionClass:"work_supervisor",compatibleExecutionClasses:["chat_worker","work_supervisor","codex_orchestrator"],expertise:["mission decomposition","acceptance criteria","risk-aware sequencing"],scopePatterns:["mission plan","planning","decompose","acceptance criteria"]}),
spec("Final Mission QA","final mission qa",{preferredExecutionClass:"codex_orchestrator",compatibleExecutionClasses:ORCH,expertise:["cross-package acceptance","verification synthesis","release readiness"],verificationRequirements:["all_required_checks","mission_acceptance"],scopePatterns:["final qa","final mission","release readiness","acceptance review"]}),
spec("Observability/telemetry","observability and telemetry",{secondaryOnly:true,expertise:["structured logging","metrics","tracing","diagnostics"],verificationRequirements:["telemetry_checks"],scopePatterns:["observability","telemetry","logging","metrics","trace"]}),
spec("Concurrency/idempotency","concurrency and idempotency",{secondaryOnly:true,expertise:["race prevention","deduplication","revision checks","retry safety"],verificationRequirements:["concurrency_tests","idempotency_tests"],scopePatterns:["concurrency","race","idempotent","idempotency","dedup"]}),
spec("Data/privacy","data and privacy",{secondaryOnly:true,expertise:["data minimization","retention","sensitive-field handling"],verificationRequirements:["privacy_review"],scopePatterns:["privacy","pii","personal data","retention","sensitive data"]}),
spec("Search/indexing","search and indexing",{expertise:["full-text search","index lifecycle","ranking/retrieval"],scopePatterns:["search","index","fts","ranking","retrieval"]}),
spec("Notifications","notifications",{expertise:["notification policy","delivery channels","dedupe/preferences"],scopePatterns:["notification","push","alert","reminder"]}),
spec("Forms/evidence capture","forms and evidence capture",{expertise:["schema-driven forms","photos/signatures","validation","evidence references"],scopePatterns:["form","checklist","photo","signature","evidence capture"]}),
spec("Assets/locations","assets and locations",{expertise:["equipment/assets","service locations","location-aware operations"],scopePatterns:["asset","equipment","location","site"]}),
spec("Pricing/margins","pricing and margins",{expertise:["pricing rules","cost/margin math","snapshot consistency"],verificationRequirements:["financial_integrity_tests","mission_acceptance"],scopePatterns:["pricing","margin","cost","price rule"]})
];

const PRIMARY_PRIORITY=[
"final-mission-qa","mission-planning","architecture","authority","executiongateway","tenant-isolation","security","payments","directadmin","vps-linux","installer-upgrades","sqlite-database","workforce","interaction-engine","decision-engine","crm","scheduling","dispatch","work-orders","quotes-invoices","commerce","inventory","omni-communications","titan-go","owner-surface","customer-titan-hub","onboarding","api-integrations","mcp-plugins","git-worktrees","ci-cd","pwa-offline","ui-ux","documentation","refactoring-code-quality"
];

function missionText(m){
  const acceptance=Array.isArray(m&&m.acceptance)?m.acceptance.map(x=>typeof x==="string"?x:x&&x.text).filter(Boolean):[];
  return [
    m&&m.title,m&&m.goal,m&&m.repo,m&&m.repository,m&&m.branch,m&&m.domain,m&&m.surface,m&&m.subsystem,
    m&&m.executionClass,m&&m.execution_class,
    ...((m&&m.constraints)||[]),...acceptance,...((m&&m.tags)||[]),...((m&&m.files)||[]),...((m&&m.paths)||[])
  ].filter(Boolean).join(" ").toLowerCase();
}
class AgentProfileRegistry{
  constructor(profiles){this._profiles=new Map();(profiles||[]).forEach(p=>this.register(p))}
  register(profile,options){
    const n=normalize(profile||{});options=options||{};
    if(this._profiles.has(n.id)&&!options.replace)throw new Error("Profile already registered: "+n.id);
    this._profiles.set(n.id,n);return n;
  }
  registerMany(profiles,options){return (profiles||[]).map(p=>this.register(p,options))}
  get(ref){
    if(!ref)return null;const id=slug(ref);if(this._profiles.has(id))return this._profiles.get(id);
    for(const p of this._profiles.values())if(p.name.toLowerCase()===String(ref).toLowerCase())return p;
    return null;
  }
  has(ref){return !!this.get(ref)}
  list(options){
    options=options||{};let out=Array.from(this._profiles.values());
    if(options.executionClass)out=out.filter(p=>p.compatibleExecutionClasses.includes(options.executionClass));
    if(options.primaryOnly)out=out.filter(p=>p.composition.allowAsPrimary);
    if(options.secondaryOnly)out=out.filter(p=>p.composition.allowAsSecondary);
    return out.slice();
  }
  validateExecutionClass(profileOrId,executionClass){
    if(!EXECUTION_CLASSES.includes(executionClass))return{ok:false,reason:"Unknown execution class: "+executionClass};
    const p=typeof profileOrId==="string"?this.get(profileOrId):profileOrId;
    if(!p)return{ok:false,reason:"Profile not found"};
    return p.compatibleExecutionClasses.includes(executionClass)?{ok:true,profile:p,executionClass}:{ok:false,profile:p,executionClass,reason:p.id+" is not compatible with "+executionClass};
  }
  scoreMission(mission,profile){
    const text=missionText(mission);let score=0;
    for(const pat of profile.scopePatterns){const n=pat.toLowerCase();if(n&&text.includes(n))score+=n.includes(" ")?5:3}
    for(const tag of profile.tags)if(text.includes(tag.toLowerCase()))score+=2;
    const explicit=[mission&&mission.profile,mission&&mission.primaryProfile,mission&&mission.profileId,mission&&mission.domainProfile].filter(Boolean).map(slug);
    if(explicit.includes(profile.id))score+=1000;
    const lenses=[...((mission&&mission.secondaryProfiles)||[]),...((mission&&mission.lenses)||[])].map(slug);
    if(lenses.includes(profile.id))score+=500;
    return score;
  }
  selectForMission(mission,options){
    mission=mission||{};options=options||{};
    const executionClass=options.executionClass||mission.executionClass||mission.execution_class||null;
    if(executionClass&&!EXECUTION_CLASSES.includes(executionClass))throw new Error("Unknown execution class: "+executionClass);
    const candidates=this.list({primaryOnly:true}).filter(p=>!executionClass||p.compatibleExecutionClasses.includes(executionClass));
    const ranked=candidates.map(p=>({p,score:this.scoreMission(mission,p),priority:PRIMARY_PRIORITY.indexOf(p.id)}))
      .sort((a,b)=>b.score-a.score||((a.priority<0?999:a.priority)-(b.priority<0?999:b.priority))||a.p.id.localeCompare(b.p.id));
    let primary=ranked[0]&&ranked[0].score>0?ranked[0].p:null;
    if(!primary)primary=this.get("architecture")||candidates[0]||null;
    if(!primary)throw new Error("No primary profile available");
    const explicit=[...(mission.secondaryProfiles||[]),...(mission.lenses||[])].map(x=>this.get(x)).filter(Boolean);
    const matched=this.list({secondaryOnly:true}).filter(p=>p.id!==primary.id).filter(p=>!executionClass||p.compatibleExecutionClasses.includes(executionClass))
      .map(p=>({p,score:this.scoreMission(mission,p)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.p.id.localeCompare(b.p.id)).map(x=>x.p);
    const max=Number.isInteger(options.maxSecondary)?options.maxSecondary:4;const secondary=[];
    for(const p of [...explicit,...matched]){
      if(p.id===primary.id||!p.composition.allowAsSecondary)continue;
      if(executionClass&&!p.compatibleExecutionClasses.includes(executionClass))continue;
      if(!secondary.some(x=>x.id===p.id))secondary.push(p);
      if(secondary.length>=max)break;
    }
    return{primary,secondary,executionClass:executionClass||primary.preferredExecutionClass};
  }
  compose(primaryRef,secondaryRefs,options){
    options=options||{};secondaryRefs=secondaryRefs||[];
    const primary=typeof primaryRef==="string"?this.get(primaryRef):primaryRef;
    if(!primary)throw new Error("Primary profile not found");
    if(!primary.composition.allowAsPrimary)throw new Error(primary.id+" cannot be used as a primary profile");
    const secondary=[];
    for(const ref of secondaryRefs){
      const p=typeof ref==="string"?this.get(ref):ref;
      if(!p)throw new Error("Secondary profile not found: "+ref);
      if(p.id===primary.id)continue;
      if(!p.composition.allowAsSecondary)throw new Error(p.id+" cannot be used as a secondary lens");
      if(!secondary.some(x=>x.id===p.id))secondary.push(p);
    }
    const executionClass=options.executionClass||primary.preferredExecutionClass;
    const bad=[primary,...secondary].filter(p=>!p.compatibleExecutionClasses.includes(executionClass));
    if(bad.length)throw new Error("Execution class "+executionClass+" incompatible with: "+bad.map(p=>p.id).join(", "));
    if(primary.composition.maxSecondary!==null&&secondary.length>primary.composition.maxSecondary)throw new Error(primary.id+" allows at most "+primary.composition.maxSecondary+" secondary profiles");
    return Object.freeze({primary,secondary:Object.freeze(secondary),executionClass});
  }
  compileContext(input,options){
    options=options||{};
    const cast=input&&input.primary?this.compose(input.primary,input.secondary||[],{executionClass:options.executionClass||input.executionClass}):this.selectForMission(input||{},options);
    const ps=[cast.primary,...cast.secondary],lines=["TITAN AGENT PROFILE CONTEXT","Execution class: "+cast.executionClass,"Primary profile: "+cast.primary.name+" ("+cast.primary.id+")"];
    if(cast.secondary.length)lines.push("Secondary lenses: "+cast.secondary.map(p=>p.name+" ("+p.id+")").join(", "));
    lines.push("");
    for(const p of ps){
      lines.push("## "+p.name+(p.id===cast.primary.id?" [PRIMARY]":" [LENS]"));
      lines.push("Role: "+p.role);lines.push("Domain: "+p.domain);
      if(p.expertise.length)lines.push("Expertise: "+p.expertise.join("; "));
      if(p.architectureContext.length)lines.push("Architecture context: "+p.architectureContext.join("; "));
      if(p.allowedCapabilities.length)lines.push("Allowed capabilities: "+p.allowedCapabilities.join("; "));
      if(p.verificationRequirements.length)lines.push("Verification: "+p.verificationRequirements.join("; "));
      lines.push("");
    }
    lines.push("## Invariants",Array.from(new Set(ps.flatMap(p=>p.invariants))).map(x=>"- "+x).join("\n"));
    lines.push("## Output contract",Array.from(new Set(ps.flatMap(p=>p.outputContract))).map(x=>"- "+x).join("\n"));
    lines.push("## Risk/policy hints",Array.from(new Set(ps.flatMap(p=>p.riskPolicyHints))).map(x=>"- "+x).join("\n"));
    return Object.freeze({executionClass:cast.executionClass,primary:cast.primary.id,secondary:Object.freeze(cast.secondary.map(p=>p.id)),profileIds:Object.freeze(ps.map(p=>p.id)),text:lines.join("\n").replace(/\n{3,}/g,"\n\n").trim()});
  }
  adaptMissionControlMission(mission,options){
    const cast=this.selectForMission(mission||{},options||{}),compiled=this.compileContext(cast,options||{});
    return Object.freeze({mission,primaryProfile:cast.primary.id,secondaryProfiles:Object.freeze(cast.secondary.map(p=>p.id)),executionClass:cast.executionClass,compiledProfileContext:compiled.text});
  }
}
const registry=new AgentProfileRegistry(CATALOGUE);
function registerProfile(p,o){return registry.register(p,o)}
function getProfile(id){return registry.get(id)}
function listProfiles(o){return registry.list(o)}
function composeProfiles(p,s,o){return registry.compose(p,s,o)}
function selectProfilesForMission(m,o){return registry.selectForMission(m,o)}
function compileProfileContext(x,o){return registry.compileContext(x,o)}
function validateExecutionClass(p,e){return registry.validateExecutionClass(p,e)}
function adaptMissionControlMission(m,o){return registry.adaptMissionControlMission(m,o)}
return Object.freeze({EXECUTION_CLASSES,GLOBAL_INVARIANTS,AgentProfileRegistry,registry,registerProfile,getProfile,listProfiles,composeProfiles,selectProfilesForMission,compileProfileContext,validateExecutionClass,adaptMissionControlMission});
});
