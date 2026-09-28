export const CAPABILITY_CLASSIFICATIONS=Object.freeze([
 "READ","WRITE","DESTRUCTIVE","EXTERNAL_SIDE_EFFECT","SERVER_ADMIN","SECRET_ACCESS"
]);
const HIGH_IMPACT=new Set(["DESTRUCTIVE","EXTERNAL_SIDE_EFFECT","SERVER_ADMIN","SECRET_ACCESS"]);

function normalizeClassification(value="READ"){
 const v=String(value||"READ").toUpperCase();
 if(!CAPABILITY_CLASSIFICATIONS.includes(v))throw new Error("Unknown capability classification "+value);
 return v;
}
export class TitanCapabilityBroker{
 constructor({authorize=null,audit=()=>{}}={}){
  this.capabilities=new Map();
  this.authorize=typeof authorize==="function"?authorize:null;
  this.audit=audit;
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
  this.audit("capability-registered",{name,classification:entry.classification,source:entry.source});
  return entry;
 }
 unregister(name){return this.capabilities.delete(name)}
 has(name){return this.capabilities.has(name)}
 get(name){return this.capabilities.get(name)||null}
 list(){
  return [...this.capabilities.values()].map(({handler,...entry})=>({...entry}));
 }
 async call(name,args={},context={}){
  const entry=this.get(name);
  if(!entry)throw Object.assign(new Error("Capability unavailable: "+name),{code:"CAPABILITY_UNAVAILABLE"});
  const classification=normalizeClassification(context.classification||entry.classification);
  const decision=this.authorize
   ? await this.authorize({name,classification,args,context,entry})
   : {allowed:!HIGH_IMPACT.has(classification),reason:HIGH_IMPACT.has(classification)?"approval-required":null};
  if(decision===false||decision?.allowed===false){
   const error=Object.assign(new Error(decision?.reason||"Capability denied: "+name),{
    code:"CAPABILITY_DENIED",capability:name,classification
   });
   this.audit("capability-denied",{name,classification,reason:error.message});
   throw error;
  }
  const timeoutMs=Math.max(1,Number(context.timeoutMs||entry.timeoutMs||30000));
  let timer;
  try{
   this.audit("capability-call",{name,classification,source:entry.source});
   const result=await Promise.race([
    Promise.resolve(entry.handler(args,{...context,classification})),
    new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error("Capability timed out: "+name),{code:"CAPABILITY_TIMEOUT"})),timeoutMs)})
   ]);
   this.audit("capability-complete",{name,classification});
   return result;
  }finally{if(timer)clearTimeout(timer)}
 }
 status(){
  return {
   count:this.capabilities.size,
   capabilities:this.list().map(x=>({name:x.name,classification:x.classification,source:x.source}))
  };
 }
}
