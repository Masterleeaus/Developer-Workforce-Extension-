import {createVerificationState,recordGate} from "./verification-plane.js";
export function importLegacyVerification(mission={}){
 const v=createVerificationState(mission.id);
 const t=mission.truth||{},r=mission.runtime||{};
 if(Object.keys(t).length){
   const gitOK=[t.commitExists,t.merged,t.presentOnMain].filter(x=>x!==undefined).every(Boolean);
   recordGate(v,"git",{status:gitOK?"pass":"fail",evidence:[t.commit,t.pr].filter(Boolean),details:t});
   if(t.ciPassed!==undefined)recordGate(v,"ci",{status:t.ciPassed?"pass":"fail",evidence:[],details:t});
 }
 if(Object.keys(r).length){
   const checks=[r.deployed,r.browserPassed,r.consoleClean,r.networkPassed,r.acceptancePassed].filter(x=>x!==undefined&&x!==null);
   if(checks.length)recordGate(v,"runtime",{status:checks.every(Boolean)?"pass":"fail",evidence:r.evidence||[],details:r});
 }
 const ac=mission.acceptanceCriteria||mission.acceptance||[];
 if(ac.length)recordGate(v,"acceptance",{status:ac.every(x=>typeof x==="string"?false:x.done===true)?"pass":"pending",evidence:ac.filter(x=>x.done).flatMap(x=>x.evidence||[]),details:{total:ac.length,done:ac.filter(x=>x.done).length}});
 return v;
}
