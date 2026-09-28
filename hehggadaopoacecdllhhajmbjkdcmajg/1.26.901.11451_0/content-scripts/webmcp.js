(()=> {
 "use strict";
 const CHANNEL="titan:webmcp:v1";
 const REQUEST_SOURCE="titan-webmcp-bridge";
 const RESPONSE_SOURCE="titan-webmcp-main";
 let generation=1;
 const registrations=new Map();

 const context=()=>document.modelContext||navigator.modelContext||null;
 const plain=value=>{
  try{return value==null?value:JSON.parse(JSON.stringify(value))}
  catch{return String(value)}
 };
 const chromeMajor=()=>{
  const m=navigator.userAgent.match(/(?:Chrome|Chromium)\/(\d+)/);
  return m?Number(m[1]):999;
 };
 const normalizeTool=(tool,index)=>{
  const name=String(tool?.name||"").trim();
  const origin=tool?.origin?String(tool.origin):location.origin;
  const registration_id=[generation,index,name,origin].join(":");
  registrations.set(registration_id,tool);
  const annotations=tool?.annotations||{};
  return {
   name,
   registration_id,
   title:tool?.title?String(tool.title):undefined,
   description:tool?.description?String(tool.description):undefined,
   input_schema:plain(tool?.inputSchema||tool?.input_schema||{type:"object",properties:{}}),
   annotations:{
    readOnlyHint:annotations.readOnlyHint===true,
    untrustedContentHint:annotations.untrustedContentHint===true,
    consequentialHint:annotations.consequentialHint===true
   },
   origin,
   pageUrl:location.href
  };
 };
 const listTools=async()=>{
  const mc=context();
  if(!mc||typeof mc.getTools!=="function")return {available:false,tools:[],pageUrl:location.href};
  const tools=await mc.getTools();
  registrations.clear();
  return {available:true,tools:Array.from(tools||[]).map(normalizeTool),pageUrl:location.href,generation};
 };
 const invokeTool=async payload=>{
  const mc=context();
  if(!mc||typeof mc.executeTool!=="function")throw Object.assign(new Error("WebMCP unavailable in this document"),{code:"WEBMCP_UNAVAILABLE"});
  const tool=registrations.get(payload.registration_id);
  if(!tool)throw Object.assign(new Error("Stale or unknown WebMCP registration"),{code:"WEBMCP_STALE_REGISTRATION"});
  if(payload.tool_name&&String(tool.name)!==String(payload.tool_name))throw Object.assign(new Error("WebMCP tool name does not match registration"),{code:"WEBMCP_TOOL_MISMATCH"});
  const timeoutMs=Math.max(1,Number(payload.timeout_ms||30000));
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort("timeout"),timeoutMs);
  try{
   const input=payload.input==null?{}:payload.input;
   // Chrome 155+ accepts objects. Older origin-trial builds used JSON text.
   const compatibleInput=chromeMajor()>=155?input:JSON.stringify(input);
   const result=await mc.executeTool(tool,compatibleInput,{signal:controller.signal});
   return {result:plain(result)};
  }catch(error){
   if(controller.signal.aborted)throw Object.assign(new Error("WebMCP invocation timed out"),{code:"WEBMCP_TIMEOUT"});
   throw error;
  }finally{clearTimeout(timer)}
 };
 const reply=(id,ok,value,error)=>{
  window.postMessage({
   channel:CHANNEL,source:RESPONSE_SOURCE,direction:"response",id,ok,
   ...(ok?{value}:{error:{message:String(error?.message||error),code:error?.code||"WEBMCP_ERROR"}})
  },"*");
 };
 window.addEventListener("message",event=>{
  if(event.source!==window)return;
  const msg=event.data;
  if(!msg||msg.channel!==CHANNEL||msg.source!==REQUEST_SOURCE||msg.direction!=="request"||!msg.id)return;
  (async()=>{
   if(msg.action==="ping")return {available:!!context(),pageUrl:location.href,generation};
   if(msg.action==="list")return listTools();
   if(msg.action==="invoke")return invokeTool(msg.payload||{});
   throw Object.assign(new Error("Unknown WebMCP bridge action"),{code:"WEBMCP_BAD_ACTION"});
  })().then(value=>reply(msg.id,true,value)).catch(error=>reply(msg.id,false,null,error));
 });
 const mc=context();
 if(mc&&typeof mc.addEventListener==="function"){
  mc.addEventListener("toolchange",()=>{
   generation+=1;registrations.clear();
   window.postMessage({channel:CHANNEL,source:RESPONSE_SOURCE,direction:"event",event:"toolchange",pageUrl:location.href,generation},"*");
  });
 }
 globalThis.__titanWebMcpMain={version:1,available:!!mc};
})();