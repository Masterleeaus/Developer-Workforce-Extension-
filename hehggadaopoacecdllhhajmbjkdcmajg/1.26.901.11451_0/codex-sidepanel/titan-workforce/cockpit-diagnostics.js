const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));

function controlState(slot={}){
 const c=slot.control||{};
 if(c.emergencyStopped)return "emergency-stopped";
 if(c.quarantined)return "quarantined";
 if(c.paused)return "paused";
 return slot.status||"idle";
}
function findPendingReview(state,slotId){
 const reviews=Object.values(state?.chatRuntime?.pendingReviews||{});
 return reviews.filter(x=>x?.supervisorId===slotId&&!["consumed","cancelled"].includes(x.status)).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0))[0]||null;
}
function chatRuntime(state,id){
 const worker=state?.chatScheduler?.workers?.[id]||null;
 if(!worker)return null;
 return {
  cycleId:worker.cycleId||null,
  pass:Number(worker.currentPass||0),
  completedPasses:Array.isArray(worker.completedPasses)?worker.completedPasses.length:0,
  nextGateAt:worker.nextGateAt||null,
  schedulerState:worker.state||null,
  slowdown:worker.slowdown||"normal",
  conversationIdentity:worker.conversationIdentity||null
 };
}
function pipelineState(state,id){
 const direct=state?.pipeline?.agents?.[id]||state?.pipeline?.builders?.[id]||state?.workCodex?.builders?.[id]||{};
 return {
  branch:direct.branch||state?.agents?.[id]?.branch||null,
  pr:clone(direct.pr||state?.agents?.[id]?.pr||null),
  ci:clone(direct.ci||state?.agents?.[id]?.ci||null),
  packetId:direct.packetId||direct.packet_id||state?.agents?.[id]?.packetId||null,
  phase:direct.phase||direct.status||null
 };
}
function orchestratorState(state){
 const x=state?.pipeline?.orchestrator||state?.workCodex?.orchestrator||state?.orchestrator||{};
 return {
  decision:clone(x.decision||state?.orchestratorDecision||null),
  phase:x.phase||x.status||null,
  missionId:x.missionId||x.mission_id||state?.agents?.ORCHESTRATOR?.missionId||null
 };
}
function verificationBacklog(state){
 return Object.values(state?.missions||{}).filter(m=>{
  const s=String(m?.status||"").toLowerCase();
  return s.includes("verify")||s.includes("verification")||s==="ready-for-codex"||s==="runtime-verification";
 }).map(m=>({id:m.id,status:m.status,title:m.title||""}));
}

export function buildCockpitDiagnostics(api){
 const state=api?.state||{};
 const registry=api?.controller?.registry;
 const slots=registry?.list?.()||Object.values(state.agents||{});
 const missions=api?.missions?.list?.()||Object.values(state.missions||{});
 const missionMap=new Map(missions.map(m=>[m.id,m]));
 const services=clone(api?.services?.status?.()||{});
 const readiness=clone(api?.integration?.readiness?.()||{});
 const serviceReady=Object.fromEntries(Object.entries(services).map(([name,value])=>[name,{
  available:value?.available===true,
  source:value?.source||null,
  capabilities:Array.isArray(value?.capabilities)?value.capabilities:[]
 }]));
 const agents=slots.map(slot=>{
  const mission=slot.missionId?missionMap.get(slot.missionId)||null:null;
  const base={
   id:slot.id,
   executionClass:slot.executionClass,
   squad:slot.squad||null,
   state:controlState(slot),
   status:slot.status||"idle",
   health:slot.health||"unknown",
   missionId:slot.missionId||null,
   missionTitle:mission?.title||null,
   missionStatus:mission?.status||null,
   profileIds:Array.isArray(slot.profileIds)?slot.profileIds:[],
   bound:!!slot.conversation,
   conversation:slot.conversation?{tabId:slot.conversation.tabId||null,title:slot.conversation.title||"",key:slot.conversation.key||null}:null
  };
  if(slot.executionClass==="chat_worker")return {...base,chat:chatRuntime(state,slot.id)};
  if(slot.executionClass==="work_supervisor"){
   const pending=findPendingReview(state,slot.id);
   return {...base,supervisor:{reviewId:pending?.id||pending?.reviewId||null,reviewStatus:pending?.status||null,workerId:pending?.workerId||null,cycleId:pending?.cycleId||null}};
  }
  if(slot.executionClass==="codex_builder")return {...base,builder:pipelineState(state,slot.id)};
  if(slot.executionClass==="codex_orchestrator")return {...base,orchestrator:orchestratorState(state)};
  return base;
 });
 const backlog=verificationBacklog(state);
 return {
  at:Date.now(),
  owner:"background-service-worker",
  topology:{
   total:agents.length,
   chat:agents.filter(a=>a.executionClass==="chat_worker").length,
   work:agents.filter(a=>a.executionClass==="work_supervisor").length,
   builders:agents.filter(a=>a.executionClass==="codex_builder").length,
   orchestrators:agents.filter(a=>a.executionClass==="codex_orchestrator").length
  },
  controls:clone(state.controls||{}),
  agents,
  readiness,
  services:serviceReady,
  nativeExecution:{
   buildersReady:agents.filter(a=>a.executionClass==="codex_builder").every(a=>services.codex?.available===true),
   orchestratorReady:services.codex?.available===true,
   codexSource:services.codex?.source||null
  },
  verification:{backlog,count:backlog.length},
  mergePressure:clone(api?.mergeController?.state||state?.lifecycle?.mergePressure||null),
  lifecycle:clone(state?.lifecycle||null),
  usage:clone(api?.usageGovernor?.status?.()||null)
 };
}
