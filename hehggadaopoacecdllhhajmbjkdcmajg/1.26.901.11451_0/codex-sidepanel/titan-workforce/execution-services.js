export const SERVICE_KINDS=Object.freeze(["chat","work","codex","github","repository","runtime","terminal","mcp"]);
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
 available(kind){return !!this.get(kind)}
 status(){return Object.fromEntries(SERVICE_KINDS.map(k=>{const s=this.get(k);return [k,{available:!!s,source:s?.source||null,capabilities:s?.capabilities||[]}]}))}
}
