function scopeError(code,message,details={}){
 const e=new Error(message);e.code=code;Object.assign(e,details);return e;
}
function uniq(values){return [...new Set((values||[]).filter(Boolean))]}
function hasGlob(p){return p.includes("*")}
function escapeRe(s){return s.replace(/[.+^$(){}|[\]\\]/g,"\\$&")}

export function normalizeScopePath(value,{allowGlob=true}={}){
 let p=String(value??"").trim().replace(/\\/g,"/");
 if(!p)throw scopeError("INVALID_SCOPE_PATH","Scope path is empty",{path:value});
 if(/^[A-Za-z]:\//.test(p)||p.startsWith("/")||p.startsWith("//")){
  throw scopeError("INVALID_SCOPE_PATH","Absolute paths are not allowed in repository scope",{path:value});
 }
 p=p.replace(/^\.\//,"").replace(/\/+/g,"/");
 const parts=p.split("/"),out=[];
 for(const part of parts){
  if(!part||part===".")continue;
  if(part==="..")throw scopeError("INVALID_SCOPE_PATH","Path traversal is not allowed in repository scope",{path:value});
  if(!allowGlob&&part.includes("*"))throw scopeError("INVALID_SCOPE_PATH","Glob is not allowed in changed file path",{path:value});
  if(part.includes("**")&&part!=="**")throw scopeError("INVALID_SCOPE_PATH","Double-star glob must occupy a whole path segment",{path:value});
  out.push(part);
 }
 if(!out.length)throw scopeError("INVALID_SCOPE_PATH","Scope path resolves to empty",{path:value});
 return out.join("/");
}

export function scopePatternToRegExp(pattern){
 const p=normalizeScopePath(pattern,{allowGlob:true});
 if(!hasGlob(p)){
  const base=escapeRe(p);
  return new RegExp("^"+base+"(?:/.*)?$");
 }
 const segments=p.split("/");
 let out="^";
 segments.forEach((segment,index)=>{
  if(segment==="**"){
   if(index===segments.length-1)out+="(?:.*)?";
   else out+="(?:[^/]+/)*";
  }else{
   let seg="";
   for(let i=0;i<segment.length;i++){
    if(segment[i]==="*")seg+="[^/]*";
    else seg+=escapeRe(segment[i]);
   }
   out+=seg;
   if(index<segments.length-1)out+="/";
  }
 });
 out+="$";
 return new RegExp(out);
}

export function pathAllowed(path,scopePaths=[]){
 let p;
 try{p=normalizeScopePath(path,{allowGlob:false})}catch{return false}
 if(!scopePaths.length)return false;
 for(const raw of scopePaths){
  try{if(scopePatternToRegExp(raw).test(p))return true}catch{}
 }
 return false;
}

export function verifyDiffScope(changedPaths=[],scopePaths=[]){
 const allowed=[],violations=[],invalid=[],normalizedScopes=[];
 for(const raw of scopePaths||[]){
  try{normalizedScopes.push(normalizeScopePath(raw,{allowGlob:true}))}
  catch(error){invalid.push({kind:"scope",path:raw,code:error.code||"INVALID_SCOPE_PATH"})}
 }
 for(const raw of changedPaths||[]){
  let p;
  try{p=normalizeScopePath(raw,{allowGlob:false})}
  catch(error){
   violations.push(String(raw));invalid.push({kind:"changed-path",path:raw,code:error.code||"INVALID_SCOPE_PATH"});continue;
  }
  (normalizedScopes.some(scope=>scopePatternToRegExp(scope).test(p))?allowed:violations).push(p);
 }
 return {ok:violations.length===0&&invalid.filter(x=>x.kind==="scope").length===0,allowed,violations,invalid,scopePaths:normalizedScopes};
}

function missionIdOf(target){return target?.mission?.id||target?.mission_id||target?.missionId||target?.id||null}
function scopeOf(target){return target?.scope_paths||target?.scopePaths||[]}

export function requireScopeExpansion(target,changedPaths,{now=Date.now()}={}){
 const result=verifyDiffScope(changedPaths,scopeOf(target));
 if(result.ok)return null;
 const missionId=missionIdOf(target);
 const proposedScope=uniq(result.violations.map(path=>{
  try{return normalizeScopePath(path,{allowGlob:false})}catch{return null}
 }).filter(Boolean));
 return {
  id:"scope-expansion:"+(missionId||"unknown")+":"+now,
  type:"scope-expansion",
  missionId,
  packetId:target?.packet_id||target?.packetId||null,
  currentScope:[...result.scopePaths],
  violations:[...result.violations],
  proposedScope,
  requestedAt:now
 };
}

function validateApproval(request,approval,{now=Date.now()}={}){
 if(!request)throw scopeError("SCOPE_EXPANSION_REQUEST_REQUIRED","Scope expansion request is required");
 if(!approval?.approved)throw scopeError("SCOPE_EXPANSION_NOT_APPROVED","Scope expansion approval is required",{requestId:request.id});
 const requestId=approval.requestId||approval.request_id||approval.scopeRequestId||null;
 if(requestId!==request.id)throw scopeError("SCOPE_EXPANSION_APPROVAL_MISMATCH","Scope approval does not match request",{requestId:request.id,approvalRequestId:requestId});
 const missionId=approval.missionId||approval.mission_id||null;
 if(missionId&&request.missionId&&missionId!==request.missionId){
  throw scopeError("SCOPE_EXPANSION_APPROVAL_MISMATCH","Scope approval mission mismatch",{requestMissionId:request.missionId,approvalMissionId:missionId});
 }
 const expiresAt=Number(approval.expiresAt||approval.expires_at||0);
 if(expiresAt&&expiresAt<=now)throw scopeError("SCOPE_EXPANSION_APPROVAL_EXPIRED","Scope expansion approval has expired",{requestId:request.id,expiresAt,now});
 return true;
}

export function applyApprovedScopeExpansion(target,request,approval,{now=Date.now()}={}){
 validateApproval(request,approval,{now});
 const current=uniq(scopeOf(target).map(x=>normalizeScopePath(x,{allowGlob:true})));
 const added=uniq((request.proposedScope||[]).map(x=>normalizeScopePath(x,{allowGlob:false})).filter(x=>!current.includes(x)));
 const expanded=[...current,...added];
 const record={
  approval_id:approval.id||approval.approvalId||("scope-approval:"+request.id),
  request_id:request.id,
  mission_id:request.missionId,
  packet_id:request.packetId||null,
  added_paths:added,
  approved_at:Number(approval.approvedAt||approval.approved_at||now),
  expires_at:Number(approval.expiresAt||approval.expires_at||0)||null,
  note:approval.note||null
 };
 const out={...target};
 if(Object.prototype.hasOwnProperty.call(target||{},"scope_paths")||target?.packet_id||target?.packetId)out.scope_paths=expanded;
 else out.scopePaths=expanded;
 out.scope_approvals=[...(target?.scope_approvals||target?.scopeApprovals||[]),record];
 return {target:out,record,expandedScope:expanded};
}

export function verifyApprovedExpansion(target,changedPaths,request,approval,{now=Date.now()}={}){
 const applied=applyApprovedScopeExpansion(target,request,approval,{now});
 const verification=verifyDiffScope(changedPaths,scopeOf(applied.target));
 if(!verification.ok)throw scopeError("SCOPE_EXPANSION_INSUFFICIENT","Approved scope expansion did not cover changed paths",{requestId:request.id,verification});
 return {...applied,verification};
}
