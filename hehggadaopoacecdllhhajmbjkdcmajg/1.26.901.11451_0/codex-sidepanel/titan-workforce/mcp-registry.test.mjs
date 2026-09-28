import assert from "node:assert/strict";
import {TitanCapabilityBroker} from "./capability-broker.js";
import {TitanMcpRegistry,classifyMcpTool,createChromeWebMcpProvider} from "./mcp-registry.js";

function readTool(name="read_state",registration_id="r1"){
 return {name,registration_id,input_schema:{type:"object"},annotations:{readOnlyHint:true}};
}
function writeTool(name="update_state",registration_id="w1"){
 return {name,registration_id,input_schema:{type:"object"},annotations:{readOnlyHint:false}};
}

{
 assert.equal(classifyMcpTool(readTool()),"READ");
 assert.equal(classifyMcpTool(writeTool()),"WRITE");
 assert.equal(classifyMcpTool({name:"delete_database"}),"DESTRUCTIVE");
 assert.equal(classifyMcpTool({name:"read_secret_token"}),"SECRET_ACCESS");
}

{
 const registry=new TitanMcpRegistry();
 await assert.rejects(()=>registry.listTools("missing"),e=>e.code==="MCP_SERVER_UNAVAILABLE");
}

{
 let now=0,calls=0;
 const registry=new TitanMcpRegistry({clock:()=>now,cacheTtlMs:1000});
 registry.registerServer({id:"cache",transport:"custom"},{
  async listTools(){calls++;return [readTool("read_cache","r"+calls)]},
  async callTool(){return "ok"}
 });
 await registry.listTools("cache");
 await registry.listTools("cache");
 assert.equal(calls,1,"fresh discovery should be cached");
 now=1001;
 await registry.listTools("cache");
 assert.equal(calls,2,"stale discovery should refresh");
}

{
 const registry=new TitanMcpRegistry();
 registry.registerServer({id:"restricted",transport:"custom",allowedExecutionClasses:["codex_builder"]},{
  async listTools(){return [readTool()]},
  async callTool(){return "ok"}
 });
 await assert.rejects(
  ()=>registry.invoke("restricted","read_state",{}, {executionClass:"chat_worker"}),
  e=>e.code==="MCP_POLICY_DENIED"
 );
}

{
 let calls=0;
 const registry=new TitanMcpRegistry();
 registry.registerServer({id:"write",transport:"custom"},{
  async listTools(){return [writeTool()]},
  async callTool(){calls++;return {ok:true}}
 });
 await assert.rejects(
  ()=>registry.invoke("write","update_state",{value:1},{executionClass:"codex_builder"}),
  e=>e.code==="MCP_APPROVAL_REQUIRED"
 );
 assert.equal(calls,0,"write must not execute before approval");
 const value=await registry.invoke("write","update_state",{value:1},{executionClass:"codex_builder",approved:true});
 assert.deepEqual(value,{ok:true});
 assert.equal(calls,1);
}

{
 let generation=0,callCount=0;
 const registry=new TitanMcpRegistry();
 registry.registerServer({id:"stale",transport:"custom"},{
  async listTools(){generation++;return [readTool("read_state","reg-"+generation)]},
  async callTool(_server,tool){
   callCount++;
   if(tool.registration_id==="reg-1"){
    const e=new Error("stale");e.code="WEBMCP_STALE_REGISTRATION";throw e;
   }
   return "fresh";
  }
 });
 const result=await registry.invoke("stale","read_state",{}, {executionClass:"chat_worker"});
 assert.equal(result,"fresh");
 assert.equal(generation,2);
 assert.equal(callCount,2);
}

{
 const broker=new TitanCapabilityBroker();
 const registry=new TitanMcpRegistry({broker});
 registry.registerServer({id:"timeout",transport:"custom"},{
  async listTools(){return [readTool()]},
  async callTool(){return new Promise(()=>{})}
 });
 await assert.rejects(
  ()=>broker.call("mcp.call",{serverId:"timeout",toolName:"read_state",input:{}},{executionClass:"chat_worker",timeoutMs:15}),
  e=>e.code==="CAPABILITY_TIMEOUT"
 );
}

{
 const messages=[];
 const fakeChrome={tabs:{async sendMessage(tabId,message){
  messages.push({tabId,message});
  if(message.type==="titan:webmcp:list")return {ok:true,value:{tools:[readTool("page_read","p1")]}};
  if(message.type==="titan:webmcp:invoke")return {ok:true,value:{result:"page-result"}};
  if(message.type==="titan:webmcp:ping")return {ok:true,value:{available:true}};
  return {ok:false,error:{message:"bad"}};
 }}};
 const provider=createChromeWebMcpProvider(fakeChrome);
 const server={metadata:{tabId:42}};
 const tools=await provider.listTools(server);
 assert.equal(tools[0].name,"page_read");
 const result=await provider.callTool(server,tools[0],{x:1},{timeoutMs:100});
 assert.equal(result,"page-result");
 assert.equal(messages[0].tabId,42);
 assert.equal(messages[1].message.payload.registration_id,"p1");
}

console.log("Titan MCP Registry tests passed");
