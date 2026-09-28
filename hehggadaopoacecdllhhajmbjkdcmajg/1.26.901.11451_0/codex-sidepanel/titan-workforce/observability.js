const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
const now=()=>Date.now();

export const WORKFORCE_EVENT_TYPES=Object.freeze([
 "MISSION_CREATED","PROFILE_CAST","PASS_DISPATCHED","PASS_COMPLETED","SUPERVISOR_REVIEW",
 "DELTA_APPROVED","BUILDER_ASSIGNED","CODEX_COMPLETED","CI_VERIFIED","ORCHESTRATOR_DECISION",
 "RUNTIME_VERIFIED","ACCEPTANCE_RESOLVED","MISSION_COMPLETE","BLOCKED","REPAIR","RESEARCH","VERIFY",
 "TOOL_FAILURE","MCP_FAILURE","CONTEXT_COMPILED","RETRY","STALE_BRANCH","STALE_WORKTREE"
]);

const TERMINAL=new Set(["MISSION_COMPLETE"]);
const TYPE_ALIASES=Object.freeze({
 "mission-created":"MISSION_CREATED",
 "mission-upserted":"MISSION_CREATED",
 "mission-cast":"PROFILE_CAST",
 "chat-pass-sent":"PASS_DISPATCHED",
 "chat-pass-completed":"PASS_COMPLETED",
 "supervisor-review-requested":"SUPERVISOR_REVIEW",
 "cycle-review-ready-for-codex":"DELTA_APPROVED",
 "builder-assigned":"BUILDER_ASSIGNED",
 "codex-completed":"CODEX_COMPLETED",
 "ci-verified":"CI_VERIFIED",
 "orchestrator-decision":"ORCHESTRATOR_DECISION",
 "runtime-verified":"RUNTIME_VERIFIED",
 "acceptance-resolved":"ACCEPTANCE_RESOLVED",
 "mission-complete":"MISSION_COMPLETE",
 "mission-verified":"MISSION_COMPLETE",
 "mission-blocked":"BLOCKED",
 "cycle-review-blocked":"BLOCKED",
 "mission-repair":"REPAIR",
 "mission-research":"RESEARCH",
 "mission-verify":"VERIFY",
 "mission-transition:blocked":"BLOCKED",
 "mission-transition:repair":"REPAIR",
 "mission-transition:research":"RESEARCH",
 "mission-transition:verify":"VERIFY",
 "mission-transition:verification":"VERIFY",
 "mission-transition:runtime-verification":"VERIFY",
 "mission-transition:complete":"MISSION_COMPLETE",
 "mission-transition:verified":"MISSION_COMPLETE",
 "mcp-call-failed":"MCP_FAILURE",
 "mcp-tool-failed":"MCP_FAILURE",
 "mcp-refresh-failed":"MCP_FAILURE",
 "tool-call-failed":"TOOL_FAILURE",
 "capability-failed":"TOOL_FAILURE",
 "runtime-verification":"RUNTIME_VERIFIED",
 "mission-runtime-verification":"RUNTIME_VERIFIED",
 "mission-context-compiled":"CONTEXT_COMPILED",
 "retry":"RETRY",
 "stale-branch":"STALE_BRANCH",
 "stale-worktree":"STALE_WORKTREE"
});

function cleanRefs(data={}){
 const refs={};
 for(const [k,v] of Object.entries(data)){
  if(v==null)continue;
  if(/(?:id|key|sha|commit|branch|repository|repo|pr|url|artifact|evidence|cycle|pass|worker|agent|profile|delta|review|gate|decision|status|source)$/i.test(k)){
   if(["string","number","boolean"].includes(typeof v))refs[k]=v;
   else if(Array.isArray(v))refs[k]=v.slice(0,30).map(x=>typeof x==="object"?clone(x):x);
  }
 }
 return refs;
}
function missionIdOf(data={}){
 return data.missionId||data.mission_id||data.mission?.id||null;
}
function agentIdOf(data={}){
 return data.agentId||data.workerId||data.slotId||data.builderId||data.supervisorId||null;
}
function eventKey(e){
 return [e.type,e.missionId||"",e.agentId||"",e.cycleId||"",e.passNumber??"",e.ref||"",e.at].join("|");
}
function normalizeEvent(raw,{clock=now,sequence=0}={}){
 if(!raw||typeof raw!=="object")throw new TypeError("event object required");
 const type=String(raw.type||"").toUpperCase();
 if(!WORKFORCE_EVENT_TYPES.includes(type))throw new Error("Unknown workforce event type "+type);
 const at=Number.isFinite(raw.at)?Number(raw.at):clock();
 const missionId=raw.missionId||missionIdOf(raw.data||{})||null;
 const agentId=raw.agentId||agentIdOf(raw.data||{})||null;
 const refs=raw.refs?cleanRefs(raw.refs):cleanRefs(raw.data||{});
 return Object.freeze({
  id:raw.id||`evt:${at}:${String(sequence).padStart(6,"0")}:${type}`,
  sequence,
  type,
  at,
  missionId,
  agentId,
  cycleId:raw.cycleId||raw.data?.cycleId||raw.data?.cycle_id||null,
  passNumber:Number.isFinite(raw.passNumber)?raw.passNumber:(Number.isFinite(raw.data?.passNumber)?raw.data.passNumber:null),
  ref:raw.ref||raw.data?.key||raw.data?.eventId||raw.data?.reviewId||raw.data?.deltaId||null,
  refs:Object.freeze(refs),
  details:Object.freeze(clone(raw.details||{}))
 });
}
function avg(values){return values.length?values.reduce((a,b)=>a+b,0)/values.length:0}
function percentile(values,p){
 if(!values.length)return 0;
 const xs=[...values].sort((a,b)=>a-b),i=Math.min(xs.length-1,Math.max(0,Math.ceil(p*xs.length)-1));
 return xs[i];
}

export class TitanWorkforceEventLog{
 constructor(state,{clock=now,maxEvents=5000}={}){
  if(!state)throw new Error("state required");
  this.state=state;this.clock=clock;this.maxEvents=Math.max(100,Number(maxEvents||5000));
  state.eventLog=Array.isArray(state.eventLog)?state.eventLog:[];
  state.eventSequence=Number.isFinite(state.eventSequence)?state.eventSequence:state.eventLog.length;
 }
 list({missionId=null,type=null,since=null,limit=null}={}){
  let events=this.state.eventLog;
  if(missionId)events=events.filter(e=>e.missionId===missionId);
  if(type)events=events.filter(e=>e.type===type);
  if(Number.isFinite(since))events=events.filter(e=>e.at>=since);
  if(Number.isInteger(limit)&&limit>=0)events=events.slice(-limit);
  return clone(events);
 }
 append(raw){
  const sequence=++this.state.eventSequence;
  const event=normalizeEvent(raw,{clock:this.clock,sequence});
  const previous=this.state.eventLog[this.state.eventLog.length-1];
  if(previous&&previous.id===event.id)throw new Error("Duplicate workforce event id "+event.id);
  this.state.eventLog.push(event);
  if(this.state.eventLog.length>this.maxEvents)this.state.eventLog.splice(0,this.state.eventLog.length-this.maxEvents);
  return clone(event);
 }
 fromAudit(type,data={},meta={}){
  const key=String(type||"").toLowerCase();
  const transition=/^mission-transition:(.+)$/.exec(key);
  let canonical=TYPE_ALIASES[key]||(transition?TYPE_ALIASES["mission-transition:"+transition[1]]:null);
  if(key==="usage-recorded"&&data.type==="context")canonical="CONTEXT_COMPILED";
  if(key==="usage-recorded"&&data.type==="retry")canonical="RETRY";
  if(key==="usage-recorded"&&data.type==="repair")canonical="REPAIR";
  if(!canonical)return null;
  const details={auditType:type,...clone(meta.details||{})};
  if(canonical==="CONTEXT_COMPILED"&&Number.isFinite(data.characters))details.characters=Number(data.characters);
  if(canonical==="RUNTIME_VERIFIED"&&data.status)details.status=data.status;
  if(canonical==="ORCHESTRATOR_DECISION"&&data.decision)details.decision=data.decision;
  return this.append({
   type:canonical,
   at:meta.at,
   missionId:missionIdOf(data),
   agentId:agentIdOf(data),
   cycleId:data.cycleId||data.cycle_id||null,
   passNumber:data.passNumber,
   ref:data.key||data.reviewId||data.deltaId||null,
   refs:cleanRefs(data),
   details
  });
 }
}

function emptyReplayMission(id){
 return {id,status:"unknown",profileIds:[],assignedAgent:null,passes:{dispatched:0,completed:0},reviews:0,deltas:0,codexCompletions:0,ci:null,runtime:null,acceptance:null,lastEventAt:null,errors:[]};
}
function transitionForEvent(m,e){
 switch(e.type){
  case "MISSION_CREATED": if(m.status!=="unknown")return "duplicate-mission-created";m.status="created";break;
  case "PROFILE_CAST": m.profileIds=[...(e.refs.profiles||e.refs.profileIds||[])];m.assignedAgent=e.agentId||e.refs.slotId||m.assignedAgent;m.status="assigned";break;
  case "PASS_DISPATCHED": if(["complete","verified"].includes(m.status))return "pass-after-completion";m.passes.dispatched++;m.status="research";break;
  case "PASS_COMPLETED": if(m.passes.completed>=m.passes.dispatched)return "pass-completed-without-dispatch";m.passes.completed++;break;
  case "SUPERVISOR_REVIEW": m.reviews++;m.status="review";break;
  case "DELTA_APPROVED": m.deltas++;m.status="ready-for-codex";break;
  case "BUILDER_ASSIGNED": m.assignedAgent=e.agentId||m.assignedAgent;m.status="building";break;
  case "CODEX_COMPLETED": m.codexCompletions++;m.status="codex-complete";break;
  case "CI_VERIFIED": m.ci=e.details.status||e.refs.status||"pass";m.status=m.ci==="fail"?"repair":"verification";break;
  case "ORCHESTRATOR_DECISION":{
   const d=String(e.details.decision||e.refs.decision||"").toUpperCase();
   m.status=d==="COMPLETE"?"verification":d==="REPAIR"?"repair":d==="RESEARCH"?"research":d==="VERIFY"?"verification":d==="BLOCKED"?"blocked":m.status;break;
  }
  case "RUNTIME_VERIFIED": m.runtime=e.details.status||e.refs.status||"pass";m.status=m.runtime==="fail"?"verification":"acceptance";break;
  case "ACCEPTANCE_RESOLVED": m.acceptance=e.details.status||e.refs.status||"pass";break;
  case "MISSION_COMPLETE": if(TERMINAL.has(m._terminalType))return "duplicate-terminal";m.status="complete";m._terminalType=e.type;break;
  case "BLOCKED": m.status="blocked";break;
  case "REPAIR": m.status="repair";break;
  case "RESEARCH": m.status="research";break;
  case "VERIFY": m.status="verification";break;
 }
 m.lastEventAt=e.at;return null;
}

export function replayWorkforceEvents(events,{strict=false}={}){
 const missions={},errors=[],seenIds=new Set(),ordered=[...(events||[])].sort((a,b)=>(a.sequence??0)-(b.sequence??0)||a.at-b.at||String(a.id).localeCompare(String(b.id)));
 for(const event of ordered){
  if(seenIds.has(event.id)){errors.push({code:"DUPLICATE_EVENT_ID",eventId:event.id});continue}
  seenIds.add(event.id);
  if(!event.missionId)continue;
  const m=missions[event.missionId]||(missions[event.missionId]=emptyReplayMission(event.missionId));
  const problem=transitionForEvent(m,event);
  if(problem){const e={code:"IMPOSSIBLE_TRANSITION",missionId:event.missionId,eventId:event.id,type:event.type,reason:problem};errors.push(e);m.errors.push(e)}
 }
 for(const m of Object.values(missions))delete m._terminalType;
 if(strict&&errors.length){const e=new Error("Workforce event replay failed");e.code="EVENT_REPLAY_INVALID";e.errors=errors;throw e}
 return {ok:errors.length===0,missions,errors,eventCount:ordered.length};
}

export function deriveWorkforceMetrics(events,{agents=[],nowAt=Date.now()}={}){
 const xs=[...(events||[])].sort((a,b)=>a.at-b.at),byMission=new Map(),dispatch=new Map(),passDurations=[],cycleStarts=new Map(),cycleDurations=[],verificationStarts=new Map(),verificationDurations=[];
 let reviews=0,repairs=0,decisions=0,ci=0,ciFailures=0,toolFailures=0,mcpFailures=0,codex=0,codexSuccess=0,retries=0,contextCharacters=0,staleBranches=0,staleWorktrees=0,profileSelections=0,completed=0;
 const activeAgents=new Set(),agentEvents={};
 for(const e of xs){
  if(e.missionId){const a=byMission.get(e.missionId)||[];a.push(e);byMission.set(e.missionId,a)}
  if(e.agentId){activeAgents.add(e.agentId);agentEvents[e.agentId]=(agentEvents[e.agentId]||0)+1}
  if(e.type==="PROFILE_CAST")profileSelections++;
  if(e.type==="PASS_DISPATCHED"){
   const k=e.ref||[e.missionId,e.agentId,e.cycleId,e.passNumber].join(":");dispatch.set(k,e.at);
   const ck=[e.missionId,e.cycleId].join(":");if(!cycleStarts.has(ck))cycleStarts.set(ck,e.at);
  }
  if(e.type==="PASS_COMPLETED"){
   const k=e.ref||[e.missionId,e.agentId,e.cycleId,e.passNumber].join(":");const start=dispatch.get(k);
   if(Number.isFinite(start)&&e.at>=start)passDurations.push(e.at-start);
   if(e.passNumber===5&&e.cycleId){const ck=[e.missionId,e.cycleId].join(":");const cs=cycleStarts.get(ck);if(Number.isFinite(cs)&&e.at>=cs)cycleDurations.push(e.at-cs)}
  }
  if(e.type==="SUPERVISOR_REVIEW")reviews++;
  if(e.type==="REPAIR")repairs++;
  if(e.type==="ORCHESTRATOR_DECISION"){decisions++;if(String(e.details?.decision||e.refs?.decision||"").toUpperCase()==="REPAIR")repairs++}
  if(e.type==="CI_VERIFIED"){ci++;if(String(e.details?.status||e.refs?.status||"pass").toLowerCase()==="fail")ciFailures++}
  if(e.type==="TOOL_FAILURE")toolFailures++;
  if(e.type==="MCP_FAILURE")mcpFailures++;
  if(e.type==="CODEX_COMPLETED"){codex++;if(String(e.details?.status||e.refs?.status||"success").toLowerCase()!=="fail")codexSuccess++}
  if(e.type==="CONTEXT_COMPILED")contextCharacters+=Number(e.details?.characters||e.refs?.characters||0);
  if(e.type==="RETRY")retries++;
  if(e.type==="STALE_BRANCH")staleBranches++;
  if(e.type==="STALE_WORKTREE")staleWorktrees++;
  if(e.type==="MISSION_COMPLETE")completed++;
  if(["CI_VERIFIED","VERIFY"].includes(e.type)&&e.missionId&&!verificationStarts.has(e.missionId))verificationStarts.set(e.missionId,e.at);
  if(e.type==="MISSION_COMPLETE"&&e.missionId){const s=verificationStarts.get(e.missionId);if(Number.isFinite(s)&&e.at>=s)verificationDurations.push(e.at-s)}
 }
 const spanMs=xs.length?Math.max(1,xs[xs.length-1].at-xs[0].at):1,hours=spanMs/3600000,totalAgents=Math.max(1,agents.length||activeAgents.size);
 return {
  window:{from:xs[0]?.at||null,to:xs[xs.length-1]?.at||null,spanMs,eventCount:xs.length},
  workerUtilization:{activeAgents:activeAgents.size,totalAgents,ratio:activeAgents.size/totalAgents,eventsByAgent:agentEvents},
  passes:{count:passDurations.length,averageDurationMs:avg(passDurations),p95DurationMs:percentile(passDurations,.95)},
  cycles:{count:cycleDurations.length,averageDurationMs:avg(cycleDurations),p95DurationMs:percentile(cycleDurations,.95)},
  missions:{completed,throughputPerHour:completed/hours,observed:byMission.size},
  reviews:{count:reviews},
  repairRate:repairs/Math.max(1,decisions),
  ci:{count:ci,failures:ciFailures,failureRate:ciFailures/Math.max(1,ci)},
  failures:{tool:toolFailures,mcp:mcpFailures},
  codex:{completed:codex,successRate:codexSuccess/Math.max(1,codex)},
  context:{characters:contextCharacters,averageCharactersPerMission:contextCharacters/Math.max(1,byMission.size)},
  retries,
  stale:{branches:staleBranches,worktrees:staleWorktrees},
  verification:{count:verificationDurations.length,averageDurationMs:avg(verificationDurations),p95DurationMs:percentile(verificationDurations,.95)},
  profileSelections,
  computedAt:nowAt
 };
}

export class TitanWorkforceObservability{
 constructor(state,{clock=now,maxEvents=5000}={}){
  this.state=state;this.clock=clock;this.events=new TitanWorkforceEventLog(state,{clock,maxEvents});
 }
 record(type,data={},meta={}){
  return this.events.append({
   type,
   at:meta.at,
   missionId:meta.missionId||missionIdOf(data),
   agentId:meta.agentId||agentIdOf(data),
   cycleId:meta.cycleId||data.cycleId||null,
   passNumber:meta.passNumber??data.passNumber,
   ref:meta.ref||data.key||data.reviewId||data.deltaId||null,
   refs:cleanRefs(data),
   details:clone(meta.details||{})
  });
 }
 recordAudit(type,data={},meta={}){return this.events.fromAudit(type,data,meta)}
 metrics(options={}){return deriveWorkforceMetrics(this.events.list(),options)}
 replay(options={}){return replayWorkforceEvents(this.events.list(),options)}
 diagnostics({agents=[]}={}){
  const replay=this.replay();
  return {
   schemaVersion:1,
   generatedAt:this.clock(),
   eventCount:this.state.eventLog.length,
   latestEventId:this.state.eventLog.at(-1)?.id||null,
   metrics:this.metrics({agents,nowAt:this.clock()}),
   replay:{ok:replay.ok,errors:replay.errors,missions:replay.missions}
  };
 }
 exportBundle({agents=[],missionId=null,eventLimit=1000}={}){
  const events=this.events.list({missionId,limit:eventLimit});
  return {
   schema:"titan-workforce-diagnostics/v1",
   generatedAt:this.clock(),
   missionId,
   metrics:deriveWorkforceMetrics(events,{agents,nowAt:this.clock()}),
   replay:replayWorkforceEvents(events),
   events
  };
 }
}
