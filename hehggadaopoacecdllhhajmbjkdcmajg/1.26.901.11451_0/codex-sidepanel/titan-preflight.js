
export async function runTitanPreflight(){
 const checks=[];
 const add=(name,ok,detail='')=>checks.push({name,ok:!!ok,detail});
 add('Chrome extension API',!!globalThis.chrome?.runtime,chrome?.runtime?.id||'missing');
 add('Storage API',!!chrome?.storage?.local);
 add('Tabs API',!!chrome?.tabs);
 add('Scripting API',!!chrome?.scripting);
 add('Debugger API',!!chrome?.debugger);
 add('Titan supervisor',!!window.TitanMissionControl);
 add('Titan architecture',!!window.TitanArchitecture);
 add('GitHub Truth',!!window.TitanGitHubTruth);
 add('Repository Context',!!window.TitanRepositoryContext);
 add('Runtime Verification',!!window.TitanRuntimeVerification);
 add('Self-test',typeof window.runTitan5x5SelfTest==='function');
 const self=window.runTitan5x5SelfTest?.();
 add('5×5 deterministic cadence',self?.ok===true,self?JSON.stringify({cadence:self.cadenceOK,cycle2:self.secondCycleOK,gate:self.finalGate}):'unavailable');
 const result={ok:checks.every(x=>x.ok),at:Date.now(),checks};
 window.__titanPreflight=result;
 window.dispatchEvent(new CustomEvent('titan:preflight',{detail:result}));
 return result;
}
window.runTitanPreflight=runTitanPreflight;
setTimeout(()=>runTitanPreflight().catch(e=>{
 window.__titanPreflight={ok:false,at:Date.now(),checks:[{name:'preflight exception',ok:false,detail:String(e?.message||e)}]};
}),1200);
