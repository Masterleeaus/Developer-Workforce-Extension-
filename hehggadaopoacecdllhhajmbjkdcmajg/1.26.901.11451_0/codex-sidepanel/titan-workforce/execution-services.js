export const SERVICE_KINDS=Object.freeze(["chat","work","codex","github","repository","runtime","terminal"]);

function capabilityError(kind,capability,methodName){
 const e=new Error("Execution capability unavailable: "+kind+"."+capability);
 e.code="CAPABILITY_UNAVAILABLE";
 e.serviceKind=kind;
 e.capability=capability;
 e.method=methodName;
 return e;
}

export class TitanExecutionServices{
 constructor(){this.services=new Map()}
 register(kind,service){
   if(!SERVICE_KINDS.includes(kind))throw new Error("Unknown execution service "+kind);
   if(!service)throw new Error("Service required");
   this.services.set(kind,service);return service;
 }
 unregister(kind){return this.services.delete(kind)}
 get(kind){return this.services.get(kind)||null}
 require(kind){const s=this.get(kind);if(!s)throw new Error("Execution service unavailable: "+kind);return s}
 requireCapability(kind,capability,{method=capability}={}){
   const s=this.get(kind);
   if(!s)throw capabilityError(kind,capability,method);
   const caps=Array.isArray(s.capabilities)?s.capabilities:[];
   if(!caps.includes(capability)||typeof s[method]!=="function")throw capabilityError(kind,capability,method);
   return s;
 }
 available(kind){return !!this.get(kind)}
 capabilityAvailable(kind,capability,{method=capability}={}){
   const s=this.get(kind),caps=Array.isArray(s?.capabilities)?s.capabilities:[];
   return !!s&&caps.includes(capability)&&typeof s[method]==="function";
 }
 status(){return Object.fromEntries(SERVICE_KINDS.map(k=>{
   const s=this.get(k),caps=Array.isArray(s?.capabilities)?s.capabilities:[];
   return [k,{available:!!s,capabilities:[...caps]}];
 }))}
}
