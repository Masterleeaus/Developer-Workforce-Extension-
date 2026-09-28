export const CAPABILITY_CLASSIFICATIONS=Object.freeze([
 "READ","WRITE","DESTRUCTIVE","EXTERNAL_SIDE_EFFECT","SERVER_ADMIN","SECRET_ACCESS"
]);
const HIGH_IMPACT=new Set(["DESTRUCTIVE","EXTERNAL_SIDE_EFFECT","SERVER_ADMIN","SECRET_ACCESS"]);

function normalizeClassification(value="READ"){
 const v=String(value||"READ").toUpperCase();
 if(!CAPABILITY_CLASSIFICATIONS.includes(v))throw new Error("Unknown capability classification "+value);
 return v;
}
function capabilityError(code,message,extra={}){
 return Object.assign(new Error(message),{code,...extra});
}
function now(){return Date.now()}
export class TitanCapabilityBroker{
 constructor({authorize=null,audit=()=>{}}={}){
  this.capabilities=new Map();
  this.authorize=typeof authorize==="function"?authorize:null;
  this.audit=audit;
  this.health=new Map();
 }
 register(name,handler,options={}){
  if(!name||typeof name!=="string")throw new Error("Capability name required");
  if(typeof handler!=="function")throw new Error("Capability handler required: "+name);
  const entry={
   name,
   handler,
   classification:normalizeClassification(options.classification||"READ"),
   source:options.source||"titan",
   description:options.description||"",
   timeoutMs:Number(options.timeoutMs||30000),
   metadata:{...(options.metadata||{})}
  };
  this.capabilities.set(name,entry);
  if(!this.health.has(name))this.health.set(name,{calls:0,successes:0,failures:0,lastCallAt:null,lastSuccessAt:null,lastFailureAt:null,lastError:null,lastLatencyMs:null});
  this.audit("capability-registered",{name,classification:entry.classification,source:entry.source});
  return entry;
 }
 unregister(name){this.health.delete(name);return this.capabilities.delete(name)}
 has(name){return this.capabilities.has(name)}
 get(name){return this.capabilities.get(name)||null}
 list(){
  return [...this.capabilities.values()].map(({handler,...entry})=>({...entry,health:{...(this.health.get(entry.name)||{})}}));
 }
 async call(name,args={},context={}){
  const entry=this.get(name);
  if(!entry)throw capabilityError("CAPABILITY_UNAVAILABLE","Capability unavailable: "+name,{capability:name});
  const allowed=Array.isArray(context.allowedCapabilities)?context.allowedCapabilities:null;
  if(allowed&&!allowed.includes("*")&&!allowed.includes(name)){
   const error=capabilityError("CAPABILITY_NOT_ALLOWED","Capability not allowed by active profile/execution context: "+name,{capability:name});
   this.audit("capability-denied",{name,reason:error.message,source:"allowed-capabilities"});
   throw error;
  }
  const classification=normalizeClassification(context.classification||entry.classification);
  const decision=this.authorize
   ? await this.authorize({name,classification,args,context,entry})
   : {allowed:!HIGH_IMPACT.has(classification),reason:HIGH_IMPACT.has(classification)?"approval-required":null};
  if(decision===false||decision?.allowed===false){
   const error=capabilityError("CAPABILITY_DENIED",decision?.reason||"Capability denied: "+name,{capability:name,classification});
   this.audit("capability-denied",{name,classification,reason:error.message});
   throw error;
  }
  if(context.signal?.aborted)throw capabilityError("CAPABILITY_ABORTED","Capability aborted before execution: "+name,{capability:name});
  const timeoutMs=Math.max(1,Number(context.timeoutMs||entry.timeoutMs||30000));
  const controller=new AbortController();
  const external=context.signal;
  const abortFromExternal=()=>controller.abort(external?.reason||"external-abort");
  external?.addEventListener?.("abort",abortFromExternal,{once:true});
  const h=this.health.get(name)||{};
  h.calls=(h.calls||0)+1;h.lastCallAt=now();this.health.set(name,h);
  let timer;
  const started=now();
  try{
   this.audit("capability-call",{name,classification,source:entry.source});
   const result=await Promise.race([
    Promise.resolve(entry.handler(args,{...context,classification,signal:controller.signal})),
    new Promise((_,reject)=>{timer=setTimeout(()=>{
     controller.abort("timeout");
     reject(capabilityError("CAPABILITY_TIMEOUT","Capability timed out: "+name,{capability:name,timeoutMs}));
    },timeoutMs)}),
    new Promise((_,reject)=>{
     controller.signal.addEventListener("abort",()=>{
      if(controller.signal.reason==="timeout")return;
      reject(capabilityError("CAPABILITY_ABORTED","Capability aborted: "+name,{capability:name}));
     },{once:true});
    })
   ]);
   h.successes=(h.successes||0)+1;h.lastSuccessAt=now();h.lastLatencyMs=now()-started;h.lastError=null;
   this.audit("capability-complete",{name,classification,latencyMs:h.lastLatencyMs});
   return result;
  }catch(error){
   h.failures=(h.failures||0)+1;h.lastFailureAt=now();h.lastLatencyMs=now()-started;h.lastError=String(error?.message||error);
   this.audit("capability-failed",{name,classification,code:error?.code||null,error:h.lastError,latencyMs:h.lastLatencyMs});
   throw error;
  }finally{
   if(timer)clearTimeout(timer);
   external?.removeEventListener?.("abort",abortFromExternal);
  }
 }
 status(){
  const capabilities=this.list();
  return {
   count:capabilities.length,
   healthy:capabilities.filter(x=>!x.health.lastError||x.health.lastSuccessAt>=x.health.lastFailureAt).length,
   failing:capabilities.filter(x=>x.health.lastError&&(!x.health.lastSuccessAt||x.health.lastFailureAt>x.health.lastSuccessAt)).length,
   capabilities:capabilities.map(x=>({name:x.name,classification:x.classification,source:x.source,health:x.health}))
  };
 }
}
