(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  if(root){
    const instance=api.createRuntimeObservability();
    root.TitanRuntimeObservability=instance;
    root.TitanRuntimeObservabilityApi=api;
    api.installRuntimeObservability(root,instance);
  }
})(typeof globalThis!=="undefined"?globalThis:this,function(){
"use strict";

const DEFAULT_MAX_EVENTS=200;
const DEFAULT_DEDUPE_MS=30000;
const SENSITIVE_KEY=/token|secret|password|passwd|authorization|cookie|credential|api.?key|session/i;

function text(value,max=500){
  if(value==null)return null;
  const out=String(value);
  return out.length>max?out.slice(0,max)+"…":out;
}
function safeUrl(value){
  try{
    const u=new URL(String(value));
    return u.origin+u.pathname;
  }catch{return text(value,300)}
}
function sanitize(value,depth=0){
  if(depth>3)return "[depth-limited]";
  if(value==null||typeof value==="number"||typeof value==="boolean")return value;
  if(typeof value==="string")return text(value);
  if(value instanceof Error)return {name:value.name||"Error",message:text(value.message),code:text(value.code,120)};
  if(Array.isArray(value))return value.slice(0,20).map(v=>sanitize(v,depth+1));
  if(typeof value==="object"){
    const out={};
    for(const [key,val] of Object.entries(value).slice(0,30)){
      if(SENSITIVE_KEY.test(key)){out[key]="[redacted]";continue}
      if(/url|href/i.test(key)&&typeof val==="string"){out[key]=safeUrl(val);continue}
      out[key]=sanitize(val,depth+1);
    }
    return out;
  }
  return text(value);
}
function category(error,detail){
  const msg=[error?.code,error?.name,error?.message,typeof error==="string"?error:"",detail?.code,detail?.message].filter(Boolean).join(" ").toLowerCase();
  if(/permission|denied|not allowed|not_allowed/.test(msg))return "permission";
  if(/native.?host|app.?server|codex.*install|no_compatible_app_server/.test(msg))return "native-host";
  if(/storage|quota/.test(msg))return "storage";
  if(/auth|login|logout|session expired/.test(msg))return "auth";
  if(/microphone|camera|media|getusermedia/.test(msg))return "media";
  if(/message|sendmessage|postmessage|port closed|receiving end/.test(msg))return "messaging";
  if(/network|fetch|websocket|connection|timeout/.test(msg))return "network";
  if(/script|inject|scripting/.test(msg))return "script-injection";
  return "runtime";
}
function errorMessage(error,detail){
  return text(error?.message||error?.code||error||detail?.message||detail?.code||"Runtime failure");
}

class RuntimeObservability{
  constructor({maxEvents=DEFAULT_MAX_EVENTS,dedupeMs=DEFAULT_DEDUPE_MS,now=Date.now,emit=null}={}){
    this.maxEvents=Math.max(10,Number(maxEvents)||DEFAULT_MAX_EVENTS);
    this.dedupeMs=Math.max(0,Number(dedupeMs)||DEFAULT_DEDUPE_MS);
    this.now=typeof now==="function"?now:Date.now;
    this.emit=typeof emit==="function"?emit:null;
    this.events=[];
    this.nextId=1;
  }
  record({subsystem="extension",operation="unknown",error=null,detail=null,severity="error",category:forcedCategory=null}={}){
    const at=Number(this.now());
    const cat=forcedCategory||category(error,detail);
    const message=errorMessage(error,detail);
    const fingerprint=[subsystem,operation,cat,message].join("|");
    const previous=this.events[this.events.length-1];
    if(previous&&previous.fingerprint===fingerprint&&at-previous.lastAt<=this.dedupeMs){
      previous.repeatCount+=1;
      previous.lastAt=at;
      this.emit?.(this.publicEvent(previous));
      return this.publicEvent(previous);
    }
    const event={
      id:this.nextId++,
      at,lastAt:at,
      severity:String(severity||"error"),
      subsystem:text(subsystem,100),
      operation:text(operation,120),
      category:cat,
      message,
      detail:sanitize(detail),
      repeatCount:1,
      fingerprint
    };
    this.events.push(event);
    if(this.events.length>this.maxEvents)this.events.splice(0,this.events.length-this.maxEvents);
    this.emit?.(this.publicEvent(event));
    return this.publicEvent(event);
  }
  publicEvent(event){
    const {fingerprint,...out}=event;
    return JSON.parse(JSON.stringify(out));
  }
  list(){
    return this.events.map(e=>this.publicEvent(e));
  }
  status(){
    const events=this.list();
    const byCategory={};
    for(const e of events)byCategory[e.category]=(byCategory[e.category]||0)+e.repeatCount;
    return {ok:events.length===0,count:events.length,totalOccurrences:events.reduce((n,e)=>n+e.repeatCount,0),byCategory,last:events.at(-1)||null};
  }
  clear(){this.events.length=0;return true}
  async guard(subsystem,operation,fn,{severity="error",detail=null}={}){
    try{return await fn()}
    catch(error){
      this.record({subsystem,operation,error,detail,severity});
      throw error;
    }
  }
}

function createRuntimeObservability(options){return new RuntimeObservability(options)}

function installRuntimeObservability(root,instance=createRuntimeObservability()){
  if(!root||root.__titanRuntimeObservabilityInstalled)return instance;
  root.__titanRuntimeObservabilityInstalled=true;
  const dispatch=entry=>{
    try{
      root.__titanRuntimeDiagnostics=instance.list();
      root.dispatchEvent?.(new CustomEvent("titan:runtime-diagnostic",{detail:entry}));
    }catch{}
  };
  instance.emit=dispatch;

  root.addEventListener?.("error",event=>{
    instance.record({subsystem:"sidepanel",operation:"window.error",error:event?.error||event?.message,detail:{filename:event?.filename,lineno:event?.lineno,colno:event?.colno}});
  });
  root.addEventListener?.("unhandledrejection",event=>{
    instance.record({subsystem:"sidepanel",operation:"unhandledrejection",error:event?.reason});
  });
  root.addEventListener?.("titan-workforce:error",event=>{
    instance.record({subsystem:"workforce-bootstrap",operation:"bootstrap",error:event?.detail?.message||"Workforce bootstrap failed",detail:event?.detail});
  });
  root.addEventListener?.("titan:stock-native-error",event=>{
    instance.record({subsystem:"stock-native",operation:"adapter-discovery",error:event?.detail?.message||"Stock native adapter failed",detail:event?.detail});
  });
  root.addEventListener?.("titan:runtime-error",event=>{
    const d=event?.detail||{};
    instance.record({subsystem:d.subsystem||"extension",operation:d.operation||"runtime",error:d.error||d.message||"Runtime error",detail:d,severity:d.severity||"error"});
  });
  return instance;
}

return Object.freeze({
  DEFAULT_MAX_EVENTS,
  DEFAULT_DEDUPE_MS,
  RuntimeObservability,
  createRuntimeObservability,
  installRuntimeObservability,
  sanitize,
  category
});
});
