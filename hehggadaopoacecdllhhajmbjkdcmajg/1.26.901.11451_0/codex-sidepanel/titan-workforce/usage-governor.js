export const USAGE_STATES=Object.freeze(["NORMAL","ELEVATED","CONSERVE","RESTRICTED","RECOVERY"]);

const POLICIES=Object.freeze({
 NORMAL:{chatConcurrency:10,slowdown:"normal",codexConcurrency:2,contextScale:1,maxRetries:2,reviewMultiplier:1},
 ELEVATED:{chatConcurrency:7,slowdown:"normal",codexConcurrency:2,contextScale:0.85,maxRetries:2,reviewMultiplier:1},
 CONSERVE:{chatConcurrency:5,slowdown:"moderate",codexConcurrency:1,contextScale:0.65,maxRetries:1,reviewMultiplier:1.5},
 RESTRICTED:{chatConcurrency:2,slowdown:"high",codexConcurrency:0,contextScale:0.45,maxRetries:0,reviewMultiplier:2},
 RECOVERY:{chatConcurrency:4,slowdown:"moderate",codexConcurrency:1,contextScale:0.6,maxRetries:1,reviewMultiplier:1.5}
});
const clone=x=>x==null?x:structuredClone(x);
const now=()=>Date.now();
function blankMetrics(){return{chatTurns:0,workCycles:0,codexTurns:0,retries:0,repairCycles:0,contextCharacters:0,passDurations:[],restrictionSignals:0,activeChat:0,activeCodex:0,lastRestrictionAt:null,lastEventAt:null}}
function avg(a){return a.length?a.reduce((x,y)=>x+y,0)/a.length:0}
function missionRank(m){
 const p=String(m?.priority||"P2").toUpperCase();
 const priority={P0:0,P1:1,P2:2,P3:3}[p]??2;
 const status=String(m?.status||"").toLowerCase();
 const verification=/verify|runtime|acceptance|repair|blocked/.test(status)?0:1;
 return[verification,priority,String(m?.id||"")];
}
function compareRank(a,b){const x=missionRank(a),y=missionRank(b);return x[0]-y[0]||x[1]-y[1]||x[2].localeCompare(y[2])}

export class TitanUsageGovernor{
 constructor(state,{audit=()=>{},clock=now,recoveryMs=10*60*1000}={}){
  this.state=state;this.audit=audit;this.clock=clock;this.recoveryMs=recoveryMs;
  state.usageGovernor=state.usageGovernor||{state:"NORMAL",metrics:blankMetrics(),missions:{},history:[],updatedAt:this.clock()};
  state.usageGovernor.metrics={...blankMetrics(),...(state.usageGovernor.metrics||{})};
  state.usageGovernor.missions=state.usageGovernor.missions||{};
  state.usageGovernor.history=Array.isArray(state.usageGovernor.history)?state.usageGovernor.history:[];
 }
 snapshot(){return clone(this.state.usageGovernor)}
 policy(){return clone(POLICIES[this.state.usageGovernor.state]||POLICIES.NORMAL)}
 mission(id){
  if(!id)return null;
  const bucket=this.state.usageGovernor.missions[id]||(this.state.usageGovernor.missions[id]={...blankMetrics(),missionId:id});
  return bucket;
 }
 record(type,{missionId=null,characters=0,durationMs=0,count=1}={}){
  const g=this.state.usageGovernor.metrics,m=this.mission(missionId),n=Math.max(1,Number(count||1));
  const bump=key=>{g[key]=(g[key]||0)+n;if(m)m[key]=(m[key]||0)+n};
  if(type==="chat_turn")bump("chatTurns");
  if(type==="work_cycle")bump("workCycles");
  if(type==="codex_turn")bump("codexTurns");
  if(type==="retry")bump("retries");
  if(type==="repair")bump("repairCycles");
  if(type==="context"){g.contextCharacters+=Number(characters||0);if(m)m.contextCharacters+=Number(characters||0)}
  if(type==="pass_duration"&&durationMs>0){g.passDurations=[...g.passDurations,Number(durationMs)].slice(-100);if(m)m.passDurations=[...(m.passDurations||[]),Number(durationMs)].slice(-50)}
  if(type==="restriction"){bump("restrictionSignals");g.lastRestrictionAt=this.clock();if(m)m.lastRestrictionAt=g.lastRestrictionAt}
  g.lastEventAt=this.clock();if(m)m.lastEventAt=g.lastEventAt;
  this.evaluate();
  this.audit("usage-recorded",{type,missionId,state:this.state.usageGovernor.state});
  return this.snapshot();
 }
 setConcurrency({chat,codex}={}){
  const m=this.state.usageGovernor.metrics;
  if(Number.isFinite(chat))m.activeChat=Math.max(0,Number(chat));
  if(Number.isFinite(codex))m.activeCodex=Math.max(0,Number(codex));
  return this.evaluate();
 }
 pressure(signals={}){
  const m=this.state.usageGovernor.metrics,p={score:0,reasons:[]};
  const retryRatio=m.retries/Math.max(1,m.chatTurns+m.workCycles+m.codexTurns);
  if(retryRatio>=0.2){p.score+=3;p.reasons.push("retry-rate")}
  else if(retryRatio>=0.1){p.score+=1;p.reasons.push("retry-rate")}
  if(m.repairCycles>=5){p.score+=2;p.reasons.push("repair-cycles")}
  if(avg(m.passDurations)>=15*60*1000){p.score+=1;p.reasons.push("slow-passes")}
  if(signals.reviewBacklog>=5){p.score+=2;p.reasons.push("review-backlog")}
  if(signals.ciBacklog>=4){p.score+=2;p.reasons.push("ci-backlog")}
  if(signals.nativeFailures>=2){p.score+=3;p.reasons.push("native-failures")}
  if(signals.restricted===true||m.restrictionSignals>0&&m.lastRestrictionAt&&this.clock()-m.lastRestrictionAt<this.recoveryMs){p.score=99;p.reasons.push("restriction")}
  return p;
 }
 evaluate(signals={}){
  const current=this.state.usageGovernor.state,p=this.pressure(signals);let next=current;
  const restricted=p.score>=99;
  if(restricted)next="RESTRICTED";
  else if(current==="RESTRICTED")next="RECOVERY";
  else if(current==="RECOVERY"){
   const since=this.state.usageGovernor.metrics.lastRestrictionAt;
   next=since&&this.clock()-since<this.recoveryMs?"RECOVERY":p.score>=5?"CONSERVE":p.score>=2?"ELEVATED":"NORMAL";
  }else next=p.score>=5?"CONSERVE":p.score>=2?"ELEVATED":"NORMAL";
  if(next!==current){
   this.state.usageGovernor.state=next;
   this.state.usageGovernor.history.push({from:current,to:next,at:this.clock(),score:p.score,reasons:p.reasons});
   this.state.usageGovernor.history=this.state.usageGovernor.history.slice(-100);
   this.audit("usage-state-changed",{from:current,to:next,score:p.score,reasons:p.reasons});
  }
  this.state.usageGovernor.updatedAt=this.clock();
  return{state:this.state.usageGovernor.state,pressure:p,policy:this.policy()};
 }
 clearRestriction(){
  const m=this.state.usageGovernor.metrics;
  m.restrictionSignals=0;
  if(this.state.usageGovernor.state==="RESTRICTED")this.state.usageGovernor.state="RECOVERY";
  this.state.usageGovernor.updatedAt=this.clock();
  this.audit("usage-restriction-cleared",{state:this.state.usageGovernor.state});
  return this.evaluate();
 }
 contextLimit(base){return Math.max(2000,Math.floor(Number(base||0)*this.policy().contextScale))}
 rankedMissions(missions=[]){return [...missions].sort(compareRank)}
 allowedChatSlots(slots=[],missions={}){
  const limit=this.policy().chatConcurrency;
  return [...slots].sort((a,b)=>compareRank(missions[a.missionId]||{id:a.missionId},missions[b.missionId]||{id:b.missionId})).slice(0,limit).map(x=>x.id);
 }
 allowCodex({mission=null}={}){
  const p=this.policy();
  if(p.codexConcurrency<=0)return{allowed:false,reason:"USAGE_RESTRICTED",policy:p};
  if(this.state.usageGovernor.metrics.activeCodex>=p.codexConcurrency)return{allowed:false,reason:"CODEX_CONCURRENCY_LIMIT",policy:p};
  return{allowed:true,policy:p,mission};
 }
 status(){
  const m=this.state.usageGovernor.metrics;
  return{state:this.state.usageGovernor.state,policy:this.policy(),metrics:{...clone(m),averagePassDurationMs:avg(m.passDurations)},missionCount:Object.keys(this.state.usageGovernor.missions).length,history:this.state.usageGovernor.history.slice(-10)};
 }
}

export {POLICIES};
