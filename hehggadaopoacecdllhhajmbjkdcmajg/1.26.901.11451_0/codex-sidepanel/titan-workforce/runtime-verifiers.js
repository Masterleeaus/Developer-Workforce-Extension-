import {recordGate} from "./verification-plane.js";

export const RUNTIME_VERIFIER_KINDS=Object.freeze([
  "browser_ui",
  "console_network",
  "api",
  "sqlite_database",
  "pwa_offline",
  "authentication",
  "tenant_isolation",
  "authority_executiongateway",
  "directadmin_server_plugin",
  "deployment_install_upgrade",
  "field_job_lifecycle"
]);

const ALIASES=Object.freeze({
  browser:"browser_ui",ui:"browser_ui","browser/ui":"browser_ui",
  console:"console_network",network:"console_network","console/network":"console_network",
  database:"sqlite_database",sqlite:"sqlite_database","sqlite/database":"sqlite_database",
  pwa:"pwa_offline",offline:"pwa_offline","pwa/offline":"pwa_offline",
  auth:"authentication",
  tenant:"tenant_isolation","company/tenant":"tenant_isolation","tenant isolation":"tenant_isolation",
  authority:"authority_executiongateway",executiongateway:"authority_executiongateway","authority/executiongateway":"authority_executiongateway",
  directadmin:"directadmin_server_plugin",server:"directadmin_server_plugin","directadmin/server/plugin":"directadmin_server_plugin",
  deployment:"deployment_install_upgrade",install:"deployment_install_upgrade",upgrade:"deployment_install_upgrade","deployment/install/upgrade":"deployment_install_upgrade",
  field:"field_job_lifecycle","field job":"field_job_lifecycle","field job lifecycle":"field_job_lifecycle"
});

function kindOf(value){
  const raw=String(value||"").trim().toLowerCase().replace(/[- ]+/g,"_");
  if(RUNTIME_VERIFIER_KINDS.includes(raw))return raw;
  return ALIASES[String(value||"").trim().toLowerCase()]||null;
}
function clone(value){return value==null?value:JSON.parse(JSON.stringify(value))}
function normalizeResult(kind,result){
  if(result===true)return {kind,status:"pass",evidence:[],details:null};
  if(result===false)return {kind,status:"fail",evidence:[],details:null};
  const status=result?.status || (result?.passed===true?"pass":result?.passed===false?"fail":result?.blocked===true?"blocked":"pending");
  return {
    kind,
    status:["pass","fail","blocked","pending"].includes(status)?status:"pending",
    evidence:Array.isArray(result?.evidence)?clone(result.evidence):result?.evidence?[clone(result.evidence)]:[],
    details:result?.details??result??null
  };
}

async function genericRuntimeVerify(kind,{mission,services,signal}){
  const runtime=services?.get?.("runtime");
  if(!runtime||typeof runtime.verify!=="function")return {kind,status:"blocked",evidence:[],details:{reason:"runtime-service-unavailable"}};
  return normalizeResult(kind,await runtime.verify({mission,requirement:kind},{signal}));
}
async function browserUI(ctx){
  const browser=ctx.services?.get?.("browser");
  if(browser&&typeof browser.inspect==="function"){
    const result=await browser.inspect({mission:ctx.mission,requirement:"browser_ui"},{signal:ctx.signal});
    return normalizeResult("browser_ui",result?.status||result?.passed!==undefined?result:{passed:!!result,evidence:result?.evidence||[]});
  }
  return genericRuntimeVerify("browser_ui",ctx);
}
async function consoleNetwork(ctx){
  const browser=ctx.services?.get?.("browser");
  if(browser){
    const evidence=[],details={};
    if(typeof browser.console==="function"){details.console=await browser.console({mission:ctx.mission},{signal:ctx.signal});evidence.push(...(details.console?.evidence||[]))}
    if(typeof browser.network==="function"){details.network=await browser.network({mission:ctx.mission},{signal:ctx.signal});evidence.push(...(details.network?.evidence||[]))}
    if(details.console||details.network){
      const failed=[details.console,details.network].filter(Boolean).some(x=>x?.passed===false||x?.status==="fail");
      return {kind:"console_network",status:failed?"fail":"pass",evidence,details};
    }
  }
  return genericRuntimeVerify("console_network",ctx);
}
async function serverVerifier(kind,ctx){
  const server=ctx.services?.get?.("server");
  if(server&&typeof server.inspect==="function"){
    const result=await server.inspect({mission:ctx.mission,requirement:kind},{signal:ctx.signal});
    return normalizeResult(kind,result?.status||result?.passed!==undefined?result:{passed:!!result,evidence:result?.evidence||[]});
  }
  return genericRuntimeVerify(kind,ctx);
}

export class TitanRuntimeVerifierRegistry{
  constructor({audit=()=>{}}={}){this.audit=audit;this.verifiers=new Map();installDefaultRuntimeVerifiers(this)}
  register(kind,handler,{replace=false}={}){
    const normalized=kindOf(kind);
    if(!normalized)throw new Error("Unknown runtime verifier kind "+kind);
    if(typeof handler!=="function")throw new Error("Runtime verifier handler required: "+normalized);
    if(this.verifiers.has(normalized)&&!replace)throw new Error("Runtime verifier already registered: "+normalized);
    this.verifiers.set(normalized,handler);this.audit("runtime-verifier-registered",{kind:normalized});return normalized;
  }
  get(kind){const normalized=kindOf(kind);return normalized?this.verifiers.get(normalized)||null:null}
  list(){return [...this.verifiers.keys()]}
  async verify(kind,context){
    const normalized=kindOf(kind);
    if(!normalized)throw new Error("Unknown runtime verification requirement "+kind);
    const handler=this.get(normalized);
    if(!handler)return {kind:normalized,status:"blocked",evidence:[],details:{reason:"verifier-unavailable"}};
    const startedAt=Date.now();
    try{
      const result=normalizeResult(normalized,await handler({...context,kind:normalized}));
      this.audit("runtime-verification",{kind:normalized,status:result.status,missionId:context?.mission?.id||null,durationMs:Date.now()-startedAt});
      return result;
    }catch(error){
      const result={kind:normalized,status:"fail",evidence:[],details:{error:String(error?.message||error)}};
      this.audit("runtime-verification",{kind:normalized,status:"fail",missionId:context?.mission?.id||null,error:result.details.error,durationMs:Date.now()-startedAt});
      return result;
    }
  }
}

export function installDefaultRuntimeVerifiers(registry){
  const add=(kind,fn)=>registry.register(kind,fn,{replace:true});
  add("browser_ui",browserUI);
  add("console_network",consoleNetwork);
  for(const kind of ["api","sqlite_database","pwa_offline","authentication","tenant_isolation","authority_executiongateway","field_job_lifecycle"]){
    add(kind,ctx=>genericRuntimeVerify(kind,ctx));
  }
  for(const kind of ["directadmin_server_plugin","deployment_install_upgrade"]){
    add(kind,ctx=>serverVerifier(kind,ctx));
  }
  return registry;
}

export function runtimeVerificationPlan(mission={}){
  const requested=[...(mission.runtimeRequirements||mission.runtime_requirements||[])];
  return [...new Set(requested.map(kindOf).filter(Boolean))];
}

export async function verifyMissionRuntime(mission,{services,registry=new TitanRuntimeVerifierRegistry(),audit=()=>{},signal}={}){
  const plan=runtimeVerificationPlan(mission);
  if(!plan.length)return {missionId:mission?.id||null,status:"pending",requirements:[],results:[],evidence:[],details:{reason:"no-runtime-requirements"}};
  const results=[];
  for(const kind of plan)results.push(await registry.verify(kind,{mission,services,signal}));
  const status=results.some(x=>x.status==="fail")?"fail":results.some(x=>x.status==="blocked")?"blocked":results.every(x=>x.status==="pass")?"pass":"pending";
  const evidence=results.flatMap(x=>x.evidence||[]);
  const out={missionId:mission?.id||null,status,requirements:plan,results,evidence,details:{passed:results.filter(x=>x.status==="pass").length,total:results.length}};
  audit("mission-runtime-verification",{missionId:out.missionId,status,requirements:plan});
  return out;
}

export function recordMissionRuntimeGate(verificationState,runtimeResult){
  return recordGate(verificationState,"runtime",{
    status:runtimeResult.status,
    evidence:runtimeResult.evidence||[],
    details:{requirements:runtimeResult.requirements||[],results:runtimeResult.results||[],...(runtimeResult.details||{})}
  });
}
