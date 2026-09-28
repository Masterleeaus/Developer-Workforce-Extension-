const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
const now=()=>Date.now();
const object=value=>!!value&&typeof value==="object"&&!Array.isArray(value);

export const APPROVAL_TYPES=Object.freeze([
 "scope-expansion","force-merge","verification-override","force-complete",
 "ownership-override","production-deploy","secret-access","lifecycle-action"
]);
export function validApprovalType(type){
 const value=String(type||"");
 return APPROVAL_TYPES.includes(value)||value.startsWith("high-impact:")||value.startsWith("secret-access:");
}

export function ensureDurabilityState(state){
 if(!state||typeof state!=="object")throw new Error("Workforce state required");
 state.auditLog=Array.isArray(state.auditLog)?state.auditLog:[];
 state.sendLedger=Array.isArray(state.sendLedger)?state.sendLedger:[];
 state.approvals=object(state.approvals)?state.approvals:{};
 state.recovery=object(state.recovery)?state.recovery:{};
 state.recovery.session=object(state.recovery.session)?state.recovery.session:null;
 state.recovery.pendingActions=Array.isArray(state.recovery.pendingActions)?state.recovery.pendingActions:[];
 state.recovery.lastStartupAt=Number(state.recovery.lastStartupAt||0)||null;
 state.recovery.lastCleanShutdownAt=Number(state.recovery.lastCleanShutdownAt||0)||null;
 state.controls=object(state.controls)?state.controls:{armed:false,emergencyStop:false,requiresReconciliation:false};
 if(typeof state.controls.requiresReconciliation!=="boolean")state.controls.requiresReconciliation=false;
 return state;
}

export class TitanAuditLog{
 constructor(state,{maxEntries=2000}={}){this.state=ensureDurabilityState(state);this.maxEntries=Math.max(100,Number(maxEntries||2000))}
 append(type,data={}){
  const entry={id:"audit-"+now()+"-"+Math.random().toString(36).slice(2,8),type:String(type||"event"),data:clone(data),at:now()};
  this.state.auditLog.push(entry);
  if(this.state.auditLog.length>this.maxEntries)this.state.auditLog.splice(0,this.state.auditLog.length-this.maxEntries);
  this.state.updatedAt=entry.at;
  return entry;
 }
 list(){return clone(this.state.auditLog)}
}

function ledgerError(code,message,entry=null){
 const e=new Error(message);e.code=code;if(entry)e.entry=clone(entry);return e;
}
export class TitanSendLedger{
 constructor(state,{audit=()=>{},maxEntries=3000}={}){
  this.state=ensureDurabilityState(state);this.audit=audit;this.maxEntries=Math.max(200,Number(maxEntries||3000));
 }
 get(key){return this.state.sendLedger.find(x=>x.key===key)||null}
 begin({key,kind,missionId=null,agentId=null,metadata={}}){
  if(!key)throw new Error("Send ledger key required");
  const existing=this.get(key);
  if(existing&&["claimed","sent","completed","recovery-required"].includes(existing.status))return{ok:false,duplicate:true,entry:clone(existing)};
  const entry={key:String(key),kind:String(kind||"action"),missionId,agentId,status:"claimed",metadata:clone(metadata),claimedAt:now(),updatedAt:now(),attempts:(existing?.attempts||0)+1};
  if(existing)Object.assign(existing,entry);else this.state.sendLedger.push(entry);
  if(this.state.sendLedger.length>this.maxEntries)this.state.sendLedger.splice(0,this.state.sendLedger.length-this.maxEntries);
  this.audit("send-ledger-claimed",{key:entry.key,kind:entry.kind,missionId,agentId});
  return{ok:true,duplicate:false,entry:clone(entry)};
 }
 markSent(key,metadata={}){
  const e=this.get(key);if(!e)throw ledgerError("SEND_LEDGER_MISSING","Unknown send ledger key "+key);
  e.status="sent";e.sentAt=now();e.updatedAt=e.sentAt;e.metadata={...(e.metadata||{}),...clone(metadata)};
  this.audit("send-ledger-sent",{key:e.key,kind:e.kind,missionId:e.missionId,agentId:e.agentId});return clone(e);
 }
 complete(key,metadata={}){
  const e=this.get(key);if(!e)throw ledgerError("SEND_LEDGER_MISSING","Unknown send ledger key "+key);
  e.status="completed";e.completedAt=now();e.updatedAt=e.completedAt;e.metadata={...(e.metadata||{}),...clone(metadata)};
  this.audit("send-ledger-completed",{key:e.key,kind:e.kind,missionId:e.missionId,agentId:e.agentId});return clone(e);
 }
 fail(key,error){
  const e=this.get(key);if(!e)return null;
  e.status="failed";e.failedAt=now();e.updatedAt=e.failedAt;e.error={code:error?.code||null,message:String(error?.message||error||"failed")};
  this.audit("send-ledger-failed",{key:e.key,kind:e.kind,code:e.error.code,message:e.error.message});return clone(e);
 }
 markRecoveryRequired(key,error=null){
  const e=this.get(key);if(!e)throw ledgerError("SEND_LEDGER_MISSING","Unknown send ledger key "+key);
  e.status="recovery-required";e.recoveryAt=now();e.updatedAt=e.recoveryAt;
  if(error)e.error={code:error?.code||null,message:String(error?.message||error)};
  const pending={key:e.key,kind:e.kind,missionId:e.missionId,agentId:e.agentId,status:e.status};
  const list=this.state.recovery.pendingActions||[];
  if(!list.some(x=>x.key===e.key))list.push(pending);
  this.state.recovery.pendingActions=list;
  this.state.controls.armed=false;this.state.controls.requiresReconciliation=true;
  this.audit("send-ledger-recovery-required",{count:1,keys:[e.key],code:e.error?.code||null});
  return clone(e);
 }
 assertNew(args){
  const claim=this.begin(args);
  if(!claim.ok)throw ledgerError("DUPLICATE_ACTION_SUPPRESSED","Action already exists in durable send ledger",claim.entry);
  return claim.entry;
 }
 pending(){return clone(this.state.sendLedger.filter(x=>["claimed","sent","recovery-required"].includes(x.status)))}
 recoverAmbiguous(){
  const recovered=[];
  for(const e of this.state.sendLedger){
   if(!["claimed","sent"].includes(e.status))continue;
   e.status="recovery-required";e.recoveryAt=now();e.updatedAt=e.recoveryAt;recovered.push(clone(e));
  }
  this.state.recovery.pendingActions=recovered.map(x=>({key:x.key,kind:x.kind,missionId:x.missionId,agentId:x.agentId,status:x.status}));
  if(recovered.length){
   this.state.controls.armed=false;this.state.controls.requiresReconciliation=true;
   this.audit("send-ledger-recovery-required",{count:recovered.length,keys:recovered.map(x=>x.key)});
  }
  return recovered;
 }
 reconcile(key,{resolvedStatus="completed",note=null}={}){
  const e=this.get(key);if(!e)throw ledgerError("SEND_LEDGER_MISSING","Unknown send ledger key "+key);
  if(e.status!=="recovery-required")throw ledgerError("SEND_LEDGER_NOT_PENDING_RECOVERY","Action is not pending recovery",e);
  if(!["completed","failed","cancelled"].includes(resolvedStatus))throw ledgerError("INVALID_RECONCILIATION_STATUS","Unsupported reconciliation status",e);
  e.status=resolvedStatus;e.reconciledAt=now();e.updatedAt=e.reconciledAt;e.reconciliationNote=note;
  this.state.recovery.pendingActions=(this.state.recovery.pendingActions||[]).filter(x=>x.key!==key);
  this.audit("send-ledger-reconciled",{key,status:resolvedStatus,note});
  return clone(e);
 }
}

export function beginRecoverySession(state,{sessionId=null,audit=()=>{}}={}){
 ensureDurabilityState(state);
 const previous=state.recovery.session,unclean=previous?.active===true;
 if(unclean){
  state.controls.armed=false;state.controls.requiresReconciliation=true;
  audit("recovery-unclean-session",{previousSessionId:previous.id||null,startedAt:previous.startedAt||null});
 }
 const id=sessionId||"session-"+now()+"-"+Math.random().toString(36).slice(2,8);
 state.recovery.session={id,active:true,startedAt:now(),uncleanPrevious:unclean};
 state.recovery.lastStartupAt=state.recovery.session.startedAt;state.updatedAt=state.recovery.session.startedAt;
 return{sessionId:id,unclean,previous:clone(previous)};
}
export function finishRecoverySession(state,{audit=()=>{}}={}){
 ensureDurabilityState(state);
 if(state.recovery.session){
  state.recovery.session.active=false;state.recovery.session.closedAt=now();
  state.recovery.lastCleanShutdownAt=state.recovery.session.closedAt;
  audit("recovery-clean-shutdown",{sessionId:state.recovery.session.id});
 }
 return clone(state.recovery.session);
}
export async function reconcileBoundConversations(state,conversationService,{audit=()=>{}}={}){
 ensureDurabilityState(state);const results=[];
 for(const slot of Object.values(state.agents||{})){
  if(!slot?.conversation?.key||!slot?.conversation?.tabId)continue;
  try{await conversationService.assertConversation(slot.conversation);results.push({slotId:slot.id,ok:true})}
  catch(error){
   slot.health="identity-mismatch";
   slot.control=object(slot.control)?slot.control:{};
   slot.control.paused=true;slot.control.pauseReason="restart-reconciliation";
   results.push({slotId:slot.id,ok:false,code:error?.code||null,message:String(error?.message||error)});
  }
 }
 const failed=results.filter(x=>!x.ok);
 if(failed.length){state.controls.armed=false;state.controls.requiresReconciliation=true}
 state.recovery.conversationReconciliation={at:now(),results:clone(results),ok:failed.length===0};
 audit("conversation-reconciled",{checked:results.length,failed:failed.length});
 return{ok:failed.length===0,results};
}
export function markRecoveryReconciled(state,{audit=()=>{},evidence={}}={}){
 ensureDurabilityState(state);
 if(state.controls.emergencyStop)throw ledgerError("EMERGENCY_STOP_ACTIVE","Cannot reconcile recovery while E-STOP is active");
 if((state.recovery.pendingActions||[]).length)throw ledgerError("PENDING_ACTIONS_UNRESOLVED","Cannot reconcile while durable actions remain ambiguous");
 const conv=state.recovery.conversationReconciliation;
 if(conv&&conv.ok===false)throw ledgerError("CONVERSATION_RECONCILIATION_FAILED","Cannot reconcile while conversation bindings are invalid");
 state.controls.armed=false;state.controls.requiresReconciliation=false;
 state.recovery.reconciledAt=now();state.recovery.reconciliationEvidence=clone(evidence);
 audit("recovery-reconciled",{evidence});return true;
}
export function durableActionKey(kind,...parts){return[kind,...parts.map(x=>x==null?"":String(x))].join(":")}
