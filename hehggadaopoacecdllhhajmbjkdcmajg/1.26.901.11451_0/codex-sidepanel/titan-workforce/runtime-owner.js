const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
export const RUNTIME_ALARM="titan-workforce-runtime-tick";

export class TitanRuntimeOwner{
 constructor({
  createRuntime,
  alarms=globalThis.chrome?.alarms,
  runtime=globalThis.chrome?.runtime,
  alarmName=RUNTIME_ALARM,
  periodInMinutes=1,
  notify=null
 }={}){
  if(typeof createRuntime!=="function")throw new Error("createRuntime is required");
  this.createRuntime=createRuntime;
  this.alarms=alarms;
  this.runtimeApi=runtime;
  this.alarmName=alarmName;
  this.periodInMinutes=Math.max(1,Number(periodInMinutes)||1);
  this.notify=typeof notify==="function"?notify:null;
  this.runtimePromise=null;
  this.api=null;
  this.instanceStartedAt=null;
  this.tickPromise=null;
 }
 async ensure(){
  if(this.api)return this.api;
  if(!this.runtimePromise){
   this.runtimePromise=Promise.resolve().then(()=>this.createRuntime()).then(api=>{
    this.api=api;
    this.instanceStartedAt=Date.now();
    return api;
   }).catch(error=>{
    this.runtimePromise=null;
    throw error;
   });
  }
  return this.runtimePromise;
 }
 async ensureAlarm(){
  if(!this.alarms?.get||!this.alarms?.create)return false;
  const existing=await this.alarms.get(this.alarmName);
  if(!existing)await this.alarms.create(this.alarmName,{periodInMinutes:this.periodInMinutes});
  return true;
 }
 async tick(reason="alarm"){
  if(this.tickPromise)return this.tickPromise;
  this.tickPromise=(async()=>{
   const api=await this.ensure();
   await api.liveChat.tick();
   await api.save();
   const snapshot=this.snapshot(api);
   this.notify?.({type:"tick",reason,snapshot});
   return snapshot;
  })().finally(()=>{this.tickPromise=null});
  return this.tickPromise;
 }
 snapshot(api=this.api){
  if(!api)return null;
  const state=clone(api.state);
  return {
   owner:"background-service-worker",
   instanceStartedAt:this.instanceStartedAt,
   state,
   agents:Object.values(state.agents||{}),
   missions:Object.values(state.missions||{}),
   services:clone(api.services?.status?.()||{}),
   mcp:clone(api.mcp?.status?.()||null),
   capabilities:clone(api.capabilities?.status?.()||null),
   usage:clone(api.usageGovernor?.status?.()||null),
   readiness:clone(api.integration?.readiness?.()||null)
  };
 }
 async command(action,payload={}){
  const api=await this.ensure();
  let result;
  switch(action){
   case "snapshot": result=this.snapshot(api);break;
   case "arm": result=api.controller.arm();await api.save();break;
   case "disarm": result=api.controller.disarm(payload.reason||"remote");await api.save();break;
   case "emergencyStop": result=api.controller.emergencyStop(payload.reason||"remote");await api.save();break;
   case "clearEmergencyStop": result=api.controller.clearEmergencyStop({reconciled:!!payload.reconciled});await api.save();break;
   case "markReconciled": result=api.controller.markReconciled(payload.evidence||{});await api.save();break;
   case "missionUpsert": result=api.missions.upsert(payload.mission||payload);await api.save();break;
   case "bindConversation": result=await api.liveChat.bindConversation(payload.workerId,payload.conversation);break;
   case "startCycle": result=await api.liveChat.startCycle(payload.workerId,payload.contract||payload);break;
   case "tick": result=await this.tick("command");break;
   case "usageStatus": result=api.usageGovernor?.status?.()||null;break;
   case "usageClearRestriction": result=api.usageGovernor?.clearRestriction?.()||null;await api.save();break;
   case "pauseAgent": result=api.controls.pauseAgent(payload.id,payload.reason);await api.save();break;
   case "resumeAgent": result=api.controls.resumeAgent(payload.id);await api.save();break;
   default: throw new Error("Unknown workforce runtime command: "+action);
  }
  const snapshot=this.snapshot(api);
  this.notify?.({type:"command",action,snapshot});
  return {ok:true,result:clone(result),snapshot};
 }
 async suspend(){
  if(!this.api)return true;
  await this.api.save();
  return true;
 }
 dispose(){
  this.api?.dispose?.();
  this.api=null;
  this.runtimePromise=null;
  this.tickPromise=null;
 }
}
