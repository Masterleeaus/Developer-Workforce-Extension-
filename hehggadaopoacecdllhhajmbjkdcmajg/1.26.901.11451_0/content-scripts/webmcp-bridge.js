(()=> {
 "use strict";
 const CHANNEL="titan:webmcp:v1";
 const REQUEST_SOURCE="titan-webmcp-bridge";
 const RESPONSE_SOURCE="titan-webmcp-main";
 let seq=0;
 const pending=new Map();
 const request=(action,payload={},timeoutMs=35000)=>new Promise((resolve,reject)=>{
  const id="twm-"+Date.now().toString(36)+"-"+(++seq).toString(36);
  const timer=setTimeout(()=>{
   pending.delete(id);
   reject(Object.assign(new Error("WebMCP page bridge timed out"),{code:"WEBMCP_BRIDGE_TIMEOUT"}));
  },Math.max(1000,Number(timeoutMs||35000)));
  pending.set(id,{resolve,reject,timer});
  window.postMessage({channel:CHANNEL,source:REQUEST_SOURCE,direction:"request",id,action,payload},"*");
 });
 window.addEventListener("message",event=>{
  if(event.source!==window)return;
  const msg=event.data;
  if(!msg||msg.channel!==CHANNEL||msg.source!==RESPONSE_SOURCE)return;
  if(msg.direction==="event"&&msg.event==="toolchange"){
   chrome.runtime.sendMessage({type:"titan:webmcp:toolchange",pageUrl:msg.pageUrl,generation:msg.generation}).catch(()=>{});
   return;
  }
  if(msg.direction!=="response"||!msg.id)return;
  const p=pending.get(msg.id);if(!p)return;
  pending.delete(msg.id);clearTimeout(p.timer);
  if(msg.ok)p.resolve(msg.value);
  else p.reject(Object.assign(new Error(msg.error?.message||"WebMCP bridge error"),{code:msg.error?.code||"WEBMCP_ERROR"}));
 });
 chrome.runtime.onMessage.addListener((message,_sender,sendResponse)=>{
  if(!message||typeof message!=="object")return false;
  let action=null,payload={};
  if(message.type==="titan:webmcp:ping")action="ping";
  else if(message.type==="titan:webmcp:list")action="list";
  else if(message.type==="titan:webmcp:invoke"){action="invoke";payload=message.payload||{}}
  else return false;
  request(action,payload,message.timeoutMs).then(
   value=>sendResponse({ok:true,value}),
   error=>sendResponse({ok:false,error:{message:String(error?.message||error),code:error?.code||"WEBMCP_ERROR"}})
  );
  return true;
 });
 globalThis.__titanWebMcpBridge={version:1,request};
})();