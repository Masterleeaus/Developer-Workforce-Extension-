import {CAPABILITY_CLASSIFICATIONS} from "./capability-broker.js";

export const MCP_TOOL_CLASSES=CAPABILITY_CLASSIFICATIONS;
export const MCP_TRANSPORTS=Object.freeze(["webmcp","http","sse","stdio","tunnel","custom"]);
export const MCP_TRUST_LEVELS=Object.freeze(["untrusted","limited","trusted","system"]);
const EXECUTION_CLASSES=Object.freeze(["chat_worker","work_supervisor","codex_builder","codex_orchestrator"]);
const APPROVAL_CLASSES=new Set(["WRITE","DESTRUCTIVE","EXTERNAL_SIDE_EFFECT","SERVER_ADMIN","SECRET_ACCESS"]);

function clone(value){return value==null?value:JSON.parse(JSON.stringify(value))}
function arr(value){return Array.isArray(value)?value:[]}
function normalizeClass(value){
 const v=String(value||"WRITE").toUpperCase();
 if(!MCP_TOOL_CLASSES.includes(v))throw new Error("Unknown MCP tool classification "+value);
 return v;
}
function normalizeServer(config,provider){
 if(!config?.id)throw new Error("MCP server id required");
 const transport=String(config.transport||"custom");
 if(!MCP_TRANSPORTS.includes(transport))throw new Error("Unsupported MCP transport "+transport);
 const trustLevel=String(config.trustLevel||"untrusted");
 if(!MCP_TRUST_LEVELS.includes(trustLevel))throw new Error("Unsupported MCP trust level "+trustLevel);
 const allowedExecutionClasses=arr(config.allowedExecutionClasses).length?arr(config.allowedExecutionClasses):[...EXECUTION_CLASSES];
 if(allowedExecutionClasses.some(x=>!EXECUTION_CLASSES.includes(x)))throw new Error("Invalid MCP execution class");
 return {
  id:String(config.id),
  name:String(config.name||config.id),
  transport,
  url:config.url||null,
  tunnelId:config.tunnelId||null,
  localConfig:clone(config.localConfig||null),
  authState:String(config.authState||"unknown"),
  trustLevel,
  allowedExecutionClasses:[...new Set(allowedExecutionClasses)],
  allowedProfiles:[...new Set(arr(config.allowedProfiles).map(String))],
  provider,
  tools:[],
  health:"unknown",
  latencyMs:null,
  lastDiscoveryAt:null,
  expiresAt:null,
  lastSuccessfulCallAt:null,
  lastError:null,
  metadata:clone(config.metadata||{})
 };
}
function classificationFromName(name){
 const n=String(name||"").toLowerCase();
 if(/(?:secret|credential|password|token|api[_ -]?key|private[_ -]?key)/.test(n))return "SECRET_ACCESS";
 if(/(?:sudo|server|systemd|service[_ -]?(?:restart|stop|start)|reboot|deploy|production)/.test(n))return "SERVER_ADMIN";
 if(/(?:delete|destroy|drop|purge|erase|revoke|terminate|remove[_ -]?(?:all|repo|database|account))/.test(n))return "DESTRUCTIVE";
 if(/(?:send|publish|submit|purchase|book|transfer|email|message|merge|commit|push|create|update|write|edit|set|add|remove)/.test(n))return "WRITE";
 return "WRITE";
}
export function classifyMcpTool(tool){
 const explicit=tool?.classification||tool?.metadata?.classification;
 if(explicit)return normalizeClass(explicit);
 const annotations=tool?.annotations||{};
 if(annotations.readOnlyHint===true)return "READ";
 if(annotations.consequentialHint===true)return "EXTERNAL_SIDE_EFFECT";
 return classificationFromName(tool?.name);
}
function normalizeTool(tool){
 if(!tool?.name)throw new Error("MCP tool name required");
 const annotations=clone(tool.annotations||{});
 return {
  name:String(tool.name),
  registration_id:tool.registration_id||tool.registrationId||null,
  title:tool.title?String(tool.title):null,
  description:tool.description?String(tool.description):null,
  input_schema:clone(tool.input_schema||tool.inputSchema||{type:"object",properties:{}}),
  annotations,
  origin:tool.origin||null,
  pageUrl:tool.pageUrl||tool.page_url||null,
  classification:classifyMcpTool(tool),
  metadata:clone(tool.metadata||{})
 };
}

export function createChromeWebMcpProvider(chromeApi=globalThis.chrome){
 if(!chromeApi?.tabs?.sendMessage)throw new Error("Chrome tabs messaging unavailable");
 const send=async(tabId,message)=>{
  try{
   const response=await chromeApi.tabs.sendMessage(tabId,message);
   if(!response?.ok){
    const error=Object.assign(new Error(response?.error?.message||"WebMCP bridge request failed"),{code:response?.error?.code||"WEBMCP_BRIDGE_ERROR"});
    throw error;
   }
   return response.value;
  }catch(error){
   if(error?.code)throw error;
   throw Object.assign(new Error(String(error?.message||error)),{code:"WEBMCP_BRIDGE_UNAVAILABLE"});
  }
 };
 return {
  source:"chrome-webmcp",
  async ping(server){return send(server.metadata.tabId,{type:"titan:webmcp:ping",timeoutMs:5000})},
  async listTools(server){
   const result=await send(server.metadata.tabId,{type:"titan:webmcp:list",timeoutMs:10000});
   return arr(result?.tools);
  },
  async callTool(server,tool,input,{timeoutMs=30000}={}){
   const result=await send(server.metadata.tabId,{
    type:"titan:webmcp:invoke",
    timeoutMs:timeoutMs+5000,
    payload:{
     tool_name:tool.name,
     registration_id:tool.registration_id,
     input:input??{},
     timeout_ms:timeoutMs
    }
   });
   return result?.result;
  }
 };
}

export class TitanMcpRegistry{
 constructor({broker=null,audit=()=>{},approvalProvider=null,cacheTtlMs=60000,clock=Date.now}={}){
  this.broker=broker;
  this.audit=audit;
  this.approvalProvider=typeof approvalProvider==="function"?approvalProvider:null;
  this.cacheTtlMs=Math.max(1000,Number(cacheTtlMs||60000));
  this.clock=typeof clock==="function"?clock:Date.now;
  this.servers=new Map();
  if(broker)this.bindCapabilities(broker);
 }
 registerServer(config,provider){
  if(!provider||typeof provider.listTools!=="function"||typeof provider.callTool!=="function")throw new Error("MCP provider must implement listTools and callTool");
  const server=normalizeServer(config,provider);
  this.servers.set(server.id,server);
  this.audit("mcp-server-registered",{id:server.id,transport:server.transport,trustLevel:server.trustLevel});
  return this.publicServer(server);
 }
 unregisterServer(id){
  const ok=this.servers.delete(String(id));
  if(ok)this.audit("mcp-server-unregistered",{id:String(id)});
  return ok;
 }
 getServer(id){
  const server=this.servers.get(String(id));
  return server?this.publicServer(server):null;
 }
 listServers(){return [...this.servers.values()].map(x=>this.publicServer(x))}
 publicServer(server){
  const {provider,...safe}=server;
  return clone(safe);
 }
 isStale(server){
  return !server.lastDiscoveryAt||!server.expiresAt||this.clock()>=server.expiresAt;
 }
 async refresh(id){
  const server=this.servers.get(String(id));
  if(!server)throw Object.assign(new Error("MCP server unavailable: "+id),{code:"MCP_SERVER_UNAVAILABLE"});
  const started=this.clock();
  try{
   const tools=await server.provider.listTools(server);
   server.tools=arr(tools).map(normalizeTool);
   server.health="online";
   server.lastDiscoveryAt=this.clock();
   server.expiresAt=server.lastDiscoveryAt+this.cacheTtlMs;
   server.latencyMs=Math.max(0,this.clock()-started);
   server.lastError=null;
   this.audit("mcp-tools-refreshed",{id:server.id,count:server.tools.length,latencyMs:server.latencyMs});
   return clone(server.tools);
  }catch(error){
   server.health="offline";server.lastError=String(error?.message||error);server.latencyMs=Math.max(0,this.clock()-started);
   this.audit("mcp-refresh-failed",{id:server.id,error:server.lastError});
   throw error;
  }
 }
 async listTools(id,{refresh=false}={}){
  const server=this.servers.get(String(id));
  if(!server)throw Object.assign(new Error("MCP server unavailable: "+id),{code:"MCP_SERVER_UNAVAILABLE"});
  if(refresh||this.isStale(server))await this.refresh(server.id);
  return clone(server.tools);
 }
 policy(server,tool,context={}){
  const executionClass=context.executionClass||context.execution_class||null;
  if(executionClass&&!server.allowedExecutionClasses.includes(executionClass)){
   return {allowed:false,reason:"MCP execution class denied",classification:tool.classification};
  }
  const profileIds=[...new Set([
   ...arr(context.profileIds),
   ...arr(context.profiles),
   context.profileId
  ].filter(Boolean).map(String))];
  if(server.allowedProfiles.length&&(!profileIds.length||!profileIds.some(id=>server.allowedProfiles.includes(id)))){
   return {allowed:false,reason:"MCP profile denied",classification:tool.classification};
  }
  const requiresApproval=APPROVAL_CLASSES.has(tool.classification);
  return {allowed:true,requiresApproval,classification:tool.classification};
 }
 async approve(server,tool,input,context,policy){
  if(!policy.requiresApproval)return {approved:true,source:"policy"};
  if(context.approved===true||context.approval?.approved===true)return {approved:true,source:"context"};
  if(this.approvalProvider){
   const result=await this.approvalProvider({
    type:"mcp-tool-call",
    server:this.publicServer(server),
    tool:clone(tool),
    input:clone(input),
    context:clone(context),
    classification:tool.classification
   });
   if(result===true||result?.approved===true)return {approved:true,source:"provider",approval:result};
  }
  this.audit("mcp-approval-required",{serverId:server.id,tool:tool.name,classification:tool.classification});
  throw Object.assign(new Error("Approval required for MCP "+tool.classification+" tool: "+tool.name),{
   code:"MCP_APPROVAL_REQUIRED",serverId:server.id,tool:tool.name,classification:tool.classification
  });
 }
 async invoke(id,toolName,input={},context={}){
  const server=this.servers.get(String(id));
  if(!server)throw Object.assign(new Error("MCP server unavailable: "+id),{code:"MCP_SERVER_UNAVAILABLE"});
  let tools=await this.listTools(server.id);
  let tool=tools.find(x=>x.name===toolName);
  if(!tool)throw Object.assign(new Error("MCP tool unavailable: "+toolName),{code:"MCP_TOOL_UNAVAILABLE"});
  const policy=this.policy(server,tool,context);
  if(!policy.allowed)throw Object.assign(new Error(policy.reason),{code:"MCP_POLICY_DENIED",classification:tool.classification});
  await this.approve(server,tool,input,context,policy);
  const timeoutMs=Math.max(1,Number(context.timeoutMs||30000));
  const started=this.clock();
  const call=async current=>server.provider.callTool(server,current,input,{timeoutMs,context});
  try{
   const result=await call(tool);
   server.health="online";server.lastSuccessfulCallAt=this.clock();server.lastError=null;server.latencyMs=Math.max(0,this.clock()-started);
   this.audit("mcp-tool-called",{serverId:server.id,tool:tool.name,classification:tool.classification,latencyMs:server.latencyMs});
   return result;
  }catch(error){
   if(error?.code==="WEBMCP_STALE_REGISTRATION"){
    tools=await this.refresh(server.id);tool=tools.find(x=>x.name===toolName);
    if(!tool)throw Object.assign(new Error("MCP tool disappeared after refresh: "+toolName),{code:"MCP_TOOL_UNAVAILABLE"});
    const retryPolicy=this.policy(server,tool,context);
    if(!retryPolicy.allowed)throw Object.assign(new Error(retryPolicy.reason),{code:"MCP_POLICY_DENIED"});
    await this.approve(server,tool,input,context,retryPolicy);
    // Stale registration fails before execution, so one refreshed retry is safe.
    const result=await call(tool);
    server.health="online";server.lastSuccessfulCallAt=this.clock();server.lastError=null;
    this.audit("mcp-tool-called",{serverId:server.id,tool:tool.name,classification:tool.classification,retriedAfterStale:true});
    return result;
   }
   server.health="degraded";server.lastError=String(error?.message||error);
   this.audit("mcp-tool-failed",{serverId:server.id,tool:tool.name,error:server.lastError});
   throw error;
  }
 }
 bindCapabilities(broker=this.broker){
  if(!broker)return false;
  this.broker=broker;
  if(!broker.has("mcp.list")){
   broker.register("mcp.list",({serverId,refresh=false})=>this.listTools(serverId,{refresh}),{classification:"READ",source:"mcp-registry",description:"List tools exposed by an MCP/WebMCP server"});
  }
  if(!broker.has("mcp.call")){
   broker.register("mcp.call",({serverId,toolName,input={}},context)=>this.invoke(serverId,toolName,input,context),{classification:"WRITE",source:"mcp-registry",description:"Invoke a policy-checked MCP/WebMCP tool",timeoutMs:35000});
  }
  return true;
 }
 async discoverWebMcpTab(tabId,{name=null,trustLevel="untrusted",allowedExecutionClasses=null,allowedProfiles=[]}={}){
  const provider=createChromeWebMcpProvider();
  const tab=await chrome.tabs.get(tabId);
  const id="webmcp:tab:"+tabId;
  if(this.servers.has(id))this.unregisterServer(id);
  this.registerServer({
   id,name:name||tab.title||id,transport:"webmcp",url:tab.url||null,authState:"browser-session",trustLevel,
   allowedExecutionClasses:allowedExecutionClasses||[...EXECUTION_CLASSES],allowedProfiles,
   metadata:{tabId,pageUrl:tab.url||null}
  },provider);
  await this.refresh(id);
  return this.getServer(id);
 }
 status(){
  const servers=this.listServers();
  return {
   count:servers.length,
   online:servers.filter(x=>x.health==="online").length,
   degraded:servers.filter(x=>x.health==="degraded").length,
   offline:servers.filter(x=>x.health==="offline").length,
   tools:servers.reduce((n,x)=>n+x.tools.length,0),
   servers
  };
 }
}

export function installMcpService(services,registry,audit=()=>{}){
 const service={
  source:"titan-mcp-registry",
  capabilities:["discover","list","call","status"],
  discoverTab:(tabId,options)=>registry.discoverWebMcpTab(tabId,options),
  list:(serverId,options)=>registry.broker?registry.broker.call("mcp.list",{serverId,...(options||{})},{executionClass:"work_supervisor"}):registry.listTools(serverId,options),
  call:(serverId,toolName,input,context={})=>registry.broker?registry.broker.call("mcp.call",{serverId,toolName,input},context):registry.invoke(serverId,toolName,input,context),
  status:()=>registry.status()
 };
 services.register("mcp",service);
 audit("mcp-service-installed",{});
 return service;
}
