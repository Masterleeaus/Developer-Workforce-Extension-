const clean=p=>String(p||"").replace(/\\/g,"/").replace(/^\.\//,"").replace(/\/+/g,"/");
function escapeRe(s){return s.replace(/[.+^${}()|[\]\\]/g,"\\$&")}
export function scopePatternToRegExp(pattern){
 const p=clean(pattern);
 let out="";
 for(let i=0;i<p.length;i++){
   if(p[i]==="*"&&p[i+1]==="*"){out+=".*";i++}
   else if(p[i]==="*")out+="[^/]*";
   else out+=escapeRe(p[i]);
 }
 return new RegExp("^"+out+"$");
}
export function pathAllowed(path,scopePaths=[]){
 if(!scopePaths.length)return false;
 const p=clean(path);
 return scopePaths.some(x=>scopePatternToRegExp(x).test(p));
}
export function verifyDiffScope(changedPaths=[],scopePaths=[]){
 const normalized=changedPaths.map(clean);
 const allowed=[],violations=[];
 for(const p of normalized)(pathAllowed(p,scopePaths)?allowed:violations).push(p);
 return {ok:violations.length===0,allowed,violations,scopePaths:[...scopePaths]};
}
export function requireScopeExpansion(mission,changedPaths){
 const result=verifyDiffScope(changedPaths,mission.scopePaths||[]);
 return result.ok?null:{type:"scope-expansion",missionId:mission.id,violations:result.violations,requestedAt:Date.now()};
}
