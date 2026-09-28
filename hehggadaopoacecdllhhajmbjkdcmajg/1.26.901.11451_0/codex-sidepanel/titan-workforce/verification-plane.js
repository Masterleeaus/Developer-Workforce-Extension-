import {classifyCIFailure,recoveryRoute} from "./ci-failures.js";
export const GATES=Object.freeze(["git","ci","runtime","acceptance","orchestrator"]);
export function createVerificationState(missionId){
 return {missionId,gates:Object.fromEntries(GATES.map(g=>[g,{status:"pending",evidence:[],checkedAt:null}])),status:"pending",updatedAt:Date.now()};
}
export function recordGate(v,gate,{status,evidence=[],details=null}){
 if(!GATES.includes(gate))throw new Error("Unknown verification gate "+gate);
 if(!["pending","pass","fail","blocked"].includes(status))throw new Error("Invalid gate status "+status);
 v.gates[gate]={status,evidence:[...evidence],details,checkedAt:Date.now()};
 v.updatedAt=Date.now();v.status=verificationStatus(v);return v;
}
export function verificationStatus(v){
 const gs=Object.values(v.gates);
 if(gs.some(g=>g.status==="fail"))return "failed";
 if(gs.some(g=>g.status==="blocked"))return "blocked";
 if(gs.every(g=>g.status==="pass"))return "verified";
 return "pending";
}
export function verificationDecision(v){
 const status=verificationStatus(v);
 if(status==="verified")return {decision:"COMPLETE"};
 const failed=Object.entries(v.gates).filter(([,g])=>g.status==="fail");
 if(!failed.length)return {decision:status==="blocked"?"BLOCKED":"VERIFY"};
 const [gate,g]=failed[0];
 if(gate==="ci"){
   const type=classifyCIFailure(g.details||{});
   return {decision:recoveryRoute(type)==="verification"?"VERIFY":"REPAIR",gate,failureType:type,route:recoveryRoute(type)};
 }
 if(gate==="runtime")return {decision:"VERIFY",gate,failureType:"RUNTIME_FAILURE",route:"verification"};
 if(gate==="acceptance")return {decision:"RESEARCH",gate,route:"work_supervisor"};
 return {decision:"REPAIR",gate,route:"codex_builder"};
}
