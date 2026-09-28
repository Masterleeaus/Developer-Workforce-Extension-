import assert from "node:assert/strict";
import {TitanCapabilityBroker} from "./capability-broker.js";
import {TitanExecutionServices} from "./execution-services.js";
import {installExecutionCapabilities,capabilitiesForExecutionContext} from "./execution-capabilities.js";
import {installTitanStockAdapters} from "../titan-stock-native-adapters.js";
import {installStockNativeEventBridge} from "./native-bridge.js";
import {TitanWorkforceIntegration} from "./integration.js";
import {readFile} from "node:fs/promises";

const calls=[];
const services=new TitanExecutionServices();
services.register("git",{
 source:"fake-git",
 async request({method,params,signal}){calls.push({kind:"git",method,params,aborted:signal?.aborted});return {method,params}}
});
services.register("terminal",{
 source:"fake-terminal",
 async test(args,{signal}={}){calls.push({kind:"terminal",method:"test",args,aborted:signal?.aborted});return {passed:true}}
});
services.register("codex",{
 source:"fake-codex",
 async request(method,params,{signal}={}){calls.push({kind:"codex",method,params,aborted:signal?.aborted});return {method,params}},
 async build({builderId,packet}){calls.push({kind:"codex",method:"build",builderId,packet});return {files_changed:["src/a.js"]}},
 async orchestrate({orchestratorId,bundle}){return {orchestratorId,bundle,decision:"COMPLETE"}}
});
services.register("runtime",{source:"fake-runtime",async verify(args){return {ok:true,args}}});
services.register("browser",{source:"fake-browser",async inspect(args){return {href:"https://example.test",...args}}});
services.register("server",{source:"fake-server",async inspect(args){return {ok:true,...args}},async deploy(){return {deployed:true}}});
services.register("github",{source:"fake-github",async status(args){return {ci:"success",...args}},async actions(args){return {runs:[],...args}}});
services.register("repository",{source:"fake-repository",async query(args){return {files:["src/a.js"],...args}}});

const audit=[];
const broker=new TitanCapabilityBroker({audit:(type,data)=>audit.push({type,data})});
const bindings=installExecutionCapabilities({services,broker,audit:(type,data)=>audit.push({type,data})});
bindings.sync();

{
 const result=await broker.call("git.status",{repository:"acme/titan"},{executionClass:"work_supervisor",allowedCapabilities:capabilitiesForExecutionContext({executionClass:"work_supervisor"})});
 assert.equal(result.method,"status");
 const diff=await broker.call("repo.diff",{repository:"acme/titan",base:"main",head:"feature"},{executionClass:"codex_builder",allowedCapabilities:capabilitiesForExecutionContext({executionClass:"codex_builder"})});
 assert.equal(diff.method,"diff");
 console.log("ok - Git status and diff through broker");
}
{
 const result=await broker.call("terminal.test",{command:"npm test"},{executionClass:"codex_builder",allowedCapabilities:capabilitiesForExecutionContext({executionClass:"codex_builder"})});
 assert.equal(result.passed,true);
 console.log("ok - terminal test through broker");
}
{
 const result=await broker.call("codex.thread.start",{cwd:"/repo"},{executionClass:"codex_builder",allowedCapabilities:capabilitiesForExecutionContext({executionClass:"codex_builder"})});
 assert.equal(result.method,"thread/start");
 const build=await broker.call("codex.build",{builderId:"BUILDER_A",packet:{packet_id:"p1"}},{executionClass:"codex_builder",allowedCapabilities:capabilitiesForExecutionContext({executionClass:"codex_builder"})});
 assert.deepEqual(build.files_changed,["src/a.js"]);
 console.log("ok - Codex app-server and builder calls through broker");
}
{
 await assert.rejects(
  ()=>broker.call("git.commit",{message:"x"},{executionClass:"chat_worker",allowedCapabilities:capabilitiesForExecutionContext({executionClass:"chat_worker"})}),
  e=>e.code==="CAPABILITY_NOT_ALLOWED"
 );
 await assert.rejects(()=>broker.call("unknown",{}),e=>e.code==="CAPABILITY_UNAVAILABLE");
 console.log("ok - profile/execution context fails closed");
}
{
 const slowBroker=new TitanCapabilityBroker();
 let sawAbort=false;
 slowBroker.register("slow",(_args,{signal})=>new Promise((_resolve,reject)=>{
  signal.addEventListener("abort",()=>{sawAbort=true;reject(new Error("handler aborted"))},{once:true});
 }),{classification:"READ",timeoutMs:20});
 await assert.rejects(()=>slowBroker.call("slow",{}),e=>e.code==="CAPABILITY_TIMEOUT");
 assert.equal(sawAbort,true);
 console.log("ok - timeout propagates cancellation to handler");
}
{
 const cancelBroker=new TitanCapabilityBroker();
 cancelBroker.register("cancel",(_args,{signal})=>new Promise((_resolve,reject)=>{
  signal.addEventListener("abort",()=>reject(Object.assign(new Error("cancelled"),{code:"HANDLER_CANCELLED"})),{once:true});
 }),{classification:"READ",timeoutMs:1000});
 const controller=new AbortController();
 const p=cancelBroker.call("cancel",{}, {signal:controller.signal});
 controller.abort("operator-stop");
 await assert.rejects(()=>p,e=>e.code==="CAPABILITY_ABORTED"||e.code==="HANDLER_CANCELLED");
 console.log("ok - external cancellation propagates");
}
{
 const health=broker.status();
 assert(health.count>5);
 assert(health.capabilities.find(x=>x.name==="git.status").health.successes>=1);
 assert(audit.some(x=>x.type==="capability-call"));
 console.log("ok - capability health and audit");
}
{
 const EventCtor=globalThis.CustomEvent||class extends Event{constructor(type,opts={}){super(type);this.detail=opts.detail}};
 const target=new EventTarget();
 const published=[];
 target.TitanNativeServices={publish:(kind,service)=>published.push({kind,service})};
 // installTitanStockAdapters uses globalThis, so temporarily provide event/publisher on global.
 const oldLegacy=globalThis.TitanNativeServices,oldDispatch=globalThis.dispatchEvent;
 globalThis.TitanNativeServices=target.TitanNativeServices;
 globalThis.dispatchEvent=e=>target.dispatchEvent(e);
 const received=new TitanExecutionServices();
 installStockNativeEventBridge(received,()=>{},target);
 const host={
  appServer:{request:async(method,params)=>({method,params})},
  git:{request:async req=>req},
  terminal:{test:async()=>({passed:true}),exec:async()=>({ok:true})},
  browser:{inspect:async()=>({ok:true}),screenshot:async()=>({data:"x"})},
  runtime:{verify:async()=>({ok:true})},
  server:{inspect:async()=>({ok:true}),deploy:async()=>({ok:true})}
 };
 const result=installTitanStockAdapters(host);
 assert(result.installed>=6);
 assert(received.available("codex"));
 assert(received.available("git"));
 assert(received.available("terminal"));
 assert(received.available("browser"));
 assert(received.available("runtime"));
 assert(received.available("server"));
 assert.equal(typeof received.get("codex").request,"function");
 globalThis.TitanNativeServices=oldLegacy;globalThis.dispatchEvent=oldDispatch;
 console.log("ok - stock host publishes complete native service families");
}

console.log("Titan execution capability tests passed");


{
 const state={provenance:{}};
 const controller={registry:{get:id=>id==="BUILDER_A"?{id,executionClass:"codex_builder",profileIds:[]}:id==="ORCHESTRATOR"?{id,executionClass:"codex_orchestrator",profileIds:[]}:null}};
 const integration=new TitanWorkforceIntegration({
  state,controller,missionControl:{get:()=>null},services,capabilities:broker,audit:()=>{}
 });
 const result=await integration.dispatchCodexPacket("BUILDER_A",{packet_id:"packet-1",scope_paths:["src/**"]});
 assert.deepEqual(result.files_changed,["src/a.js"]);
 assert(audit.some(x=>x.type==="capability-call"&&x.data?.name==="codex.build"));
 console.log("ok - workforce builder dispatch traverses broker");
}
{
 const files=["execution-capabilities.js","native-bridge.js","../titan-stock-native-adapters.js"];
 for(const file of files){
  const text=await readFile(new URL(file,import.meta.url),"utf8");
  assert(!/from\s+["'][^"']*\/assets\//.test(text),"hashed/minified asset import forbidden in "+file);
 }
 console.log("ok - no direct hashed asset imports");
}
