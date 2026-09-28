import {SLOT_IDS,SLOT_CLASS} from "./constants.js";
import {validateWorkforceState} from "./state.js";
import {verifyDiffScope} from "./scope-locks.js";

export const DEFAULT_REQUIRED_CHECKS=Object.freeze([
 "schema","topology","profiles","chat-scheduler","work-codex-pipeline","controller",
 "capability-broker","chat-service","work-service","codex-service","repository-service",
 "github-service","mcp-service","identity-lock","scope-locks","cockpit"
]);

function check(name,ok,detail="",requiredChecks=DEFAULT_REQUIRED_CHECKS){
 return {name,ok:!!ok,detail,required:requiredChecks.includes(name)};
}
function serviceStatus(services,kind){
 const status=services?.status?.()?.[kind];
 return status||{available:false,source:null,capabilities:[]};
}
export function verifySystemReadiness({
 state,controller,integration,services,capabilities,globals=globalThis,
 requiredChecks=DEFAULT_REQUIRED_CHECKS,cockpitPresent=true
}={}){
 const checks=[];
 checks.push(check("schema",validateWorkforceState(state),"schemaVersion "+String(state?.schemaVersion??"missing"),requiredChecks));
 const agents=controller?.registry?.list?.()||[];
 const counts=agents.reduce((o,a)=>(o[a.executionClass]=(o[a.executionClass]||0)+1,o),{});
 const topology=agents.length===15&&counts.chat_worker===10&&counts.work_supervisor===2&&counts.codex_builder===2&&counts.codex_orchestrator===1&&SLOT_IDS.every(id=>SLOT_CLASS[id]===state?.agents?.[id]?.executionClass);
 checks.push(check("topology",topology,JSON.stringify(counts),requiredChecks));
 const ready=integration?.readiness?.()||{};
 checks.push(check("profiles",!!ready.profiles||!!globals.TitanAgentProfiles,"profile registry",requiredChecks));
 checks.push(check("chat-scheduler",!!ready.chat||!!globals.TitanChatFivePass,"five-pass scheduler",requiredChecks));
 checks.push(check("work-codex-pipeline",!!ready.pipeline||!!globals.TitanWorkCodexPipeline,"pipeline",requiredChecks));
 checks.push(check("controller",!!controller&&typeof controller.arm==="function","workforce controller",requiredChecks));
 checks.push(check("capability-broker",!!capabilities&&typeof capabilities.call==="function","capabilities "+String(capabilities?.status?.()?.count||0),requiredChecks));
 for(const [name,kind] of [
  ["chat-service","chat"],["work-service","work"],["codex-service","codex"],["git-service","git"],
  ["github-service","github"],["repository-service","repository"],["terminal-service","terminal"],
  ["browser-service","browser"],["runtime-service","runtime"],["server-service","server"],["mcp-service","mcp"]
 ]){
  const s=serviceStatus(services,kind);
  checks.push(check(name,s.available===true,(s.source||"unavailable")+" "+(s.capabilities||[]).join(","),requiredChecks));
 }
 const chat=services?.get?.("chat");
 checks.push(check("identity-lock",!!chat&&typeof chat.assertConversation==="function","conversation identity assertion",requiredChecks));
 const scopeProbe=verifyDiffScope(["src/a.js"],["src/**"]);
 checks.push(check("scope-locks",scopeProbe.ok&&verifyDiffScope(["outside/a.js"],["src/**"]).ok===false,"Git-diff scope matcher",requiredChecks));
 checks.push(check("send-ledger",Array.isArray(state?.sendLedger)||Array.isArray(state?.legacy?.sendLedger),"durable send ledger",requiredChecks));
 checks.push(check("approval-policy",!!state?.approvals||!!globals.TitanApprovals,"approval state/policy",requiredChecks));
 checks.push(check("restart-recovery",!!state?.recovery||state?.controls?.requiresReconciliation!==undefined,"recovery/reconciliation state",requiredChecks));
 checks.push(check("cockpit",!!cockpitPresent,"engineering cockpit",requiredChecks));
 const failedRequired=checks.filter(x=>x.required&&!x.ok);
 return {
  ok:failedRequired.length===0,
  checks,
  failedRequired:failedRequired.map(x=>x.name),
  at:Date.now()
 };
}

export function installSystemArmGuard(controller,getReport){
 if(!controller||typeof controller.setReadinessGuard!=="function")throw new Error("Controller readiness-guard support required");
 if(typeof getReport!=="function")throw new Error("Readiness report provider required");
 controller.setReadinessGuard(()=>{
  const report=getReport();
  return report?.ok?{ok:true,report}:{ok:false,reason:"System verification failed",report};
 });
 return true;
}

export function classifyFailurePath(name,context={}){
 switch(name){
  case "BLOCKED":return {decision:"BLOCKED",failClosed:true};
  case "REPAIR":return {decision:"REPAIR",failClosed:true};
  case "RESEARCH":return {decision:"RESEARCH",failClosed:true};
  case "VERIFY":return {decision:"VERIFY",failClosed:true};
  case "scope-violation":return {decision:verifyDiffScope(context.changedPaths||[],context.scopePaths||[]).ok?"CONTINUE":"BLOCKED",failClosed:true};
  case "ci-failure":return {decision:"REPAIR",failClosed:true};
  case "identity-mismatch":return {decision:"BLOCKED",failClosed:true};
  case "usage-restriction":return {decision:"PAUSED",failClosed:true};
  case "lost-tab":return {decision:"BLOCKED",failClosed:true};
  case "duplicate-send":return {decision:"SUPPRESS",failClosed:true};
  case "stale-branch":return {decision:"VERIFY",failClosed:true};
  case "runtime-failure":return {decision:"VERIFY",failClosed:true};
  case "server-failure":return {decision:"BLOCKED",failClosed:true};
  default:return {decision:"UNKNOWN",failClosed:false};
 }
}
