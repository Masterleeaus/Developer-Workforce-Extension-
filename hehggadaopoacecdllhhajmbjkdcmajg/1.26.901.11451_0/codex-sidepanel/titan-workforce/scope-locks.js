export function normalizeScopePath(value){
 let p=String(value||"").trim().replace(/\\/g,"/").replace(/^\.\//,"").replace(/\/+/g,"/");
 if(!p||p.startsWith("/")||/^[A-Za-z]:\//.test(p))throw new Error("Scope path must be repository-relative");
 const parts=p.split("/");if(parts.some(x=>x===".."||x==="."))throw new Error("Scope path traversal is not allowed");
 return p.replace(/\/$/,"");
}
function escapeRe(s){return s.replace(/[.+^${}()|[\]\\]/g,"\\$&")}
function hasGlob(p){return p.includes("*")}
function looksLikeFile(p){const last=p.split("/").at(-1)||"";return /\.[A-Za-z0-9_-]+$/.test(last)}
export function normalizeScopePattern(value){return normalizeScopePath(value)}
export function scopePatternToRegExp(value){
 const p=normalizeScopePattern(value);
 if(!hasGlob(p)&&!looksLikeFile(p))return new RegExp("^"+escapeRe(p)+"(?:/.*)?$");
 let out="";for(let i=0;i<p.length;i++){if(p[i]==="*"&&p[i+1]==="*"){out+=".*";i++}else if(p[i]==="*")out+="[^/]*";else out+=escapeRe(p[i])}
 return new RegExp("^"+out+"$");
}
export function pathAllowed(path,scopePaths=[]){let p;try{p=normalizeScopePath(path)}catch{return false}return (scopePaths||[]).some(x=>{try{return scopePatternToRegExp(x).test(p)}catch{return false}})}
export function verifyDiffScope(changedPaths=[],scopePaths=[]){const allowed=[],violations=[];for(const raw of changedPaths){let p;try{p=normalizeScopePath(raw)}catch{violations.push(String(raw));continue}(pathAllowed(p,scopePaths)?allowed:violations).push(p)}return {ok:violations.length===0,allowed,violations,scopePaths:(scopePaths||[]).map(normalizeScopePattern)}}
export function requireScopeExpansion(mission,changedPaths,{packetId=null,builderId=null}={}){const result=verifyDiffScope(changedPaths,mission.scopePaths||[]);return result.ok?null:{type:"scope-expansion",missionId:mission.id,packetId,builderId,originalScope:[...(mission.scopePaths||[])],violations:result.violations,requestedAt:Date.now()}}
