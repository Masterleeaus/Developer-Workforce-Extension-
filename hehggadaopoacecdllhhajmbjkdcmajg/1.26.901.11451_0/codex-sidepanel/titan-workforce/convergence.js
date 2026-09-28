import {SQUADS,CHAT_SLOTS} from "./constants.js";

export const OBJECTIVE_STAGES=Object.freeze([
 "research","work_approval","build","orchestrator_qa","git","runtime","acceptance"
]);
const TERMINAL_MISSION=new Set(["complete","verified","cancelled","superseded"]);
const clone=x=>x==null?x:JSON.parse(JSON.stringify(x));
const arr=x=>Array.isArray(x)?x:[];
const uniq=x=>[...new Set(arr(x).filter(Boolean).map(String))];

function ensureObject(parent,key,seed){
 if(!parent[key]||typeof parent[key]!=="object"||Array.isArray(parent[key]))parent[key]=seed();
 return parent[key];
}
export function ensureConvergenceState(state){
 if(!state||typeof state!=="object")throw new Error("workforce state required");
 const c=ensureObject(state,"convergence",()=>({}));
 ensureObject(c,"checkpoints",()=>({}));
 const squads=ensureObject(c,"squads",()=>({}));
 for(const squad of Object.keys(SQUADS))if(!squads[squad]||typeof squads[squad]!=="object")squads[squad]={last:null,history:[]};
 ensureObject(c,"missions",()=>({}));
 ensureObject(state,"objectiveProgress",()=>({}));
 return c;
}

function normalizeCheckpoint(input){
 if(!input||typeof input!=="object")throw new Error("checkpoint required");
 if(!CHAT_SLOTS.includes(input.workerId))throw new Error("checkpoint worker must be a Chat slot");
 const squad=input.squad||input.workerId[0];
 if(!SQUADS[squad]?.includes(input.workerId))throw new Error("checkpoint squad/worker mismatch");
 const cycle=Number(input.cycle);
 if(!Number.isInteger(cycle)||cycle<1)throw new Error("checkpoint cycle must be a positive integer");
 return {
  id:input.id||`checkpoint:${input.workerId}:${cycle}`,
  workerId:input.workerId,
  squad,
  cycle,
  missionId:input.missionId||null,
  reviewed:input.reviewed===true,
  status:input.status||"cycle-complete",
  scopePaths:uniq(input.scopePaths||input.scope_paths),
  dependencies:uniq(input.dependencies),
  blockers:arr(input.blockers).map(clone),
  approvedFindings:arr(input.approvedFindings||input.approved_findings).map(clone),
  reviewId:input.reviewId||input.review_id||null,
  at:Number.isFinite(input.at)?input.at:Date.now()
 };
}
export function recordWorkerCheckpoint(state,input){
 const c=ensureConvergenceState(state),checkpoint=normalizeCheckpoint(input);
 c.checkpoints[checkpoint.workerId]=c.checkpoints[checkpoint.workerId]||{};
 c.checkpoints[checkpoint.workerId][checkpoint.cycle]=checkpoint;
 state.updatedAt=Date.now();
 return clone(checkpoint);
}
export function getWorkerCheckpoint(state,workerId,cycle){
 const c=ensureConvergenceState(state);
 return c.checkpoints?.[workerId]?.[cycle]||null;
}
function scopesOverlap(a,b){
 const aa=uniq(a),bb=uniq(b);
 return aa.some(x=>bb.some(y=>x===y||x.startsWith(y.replace(/\/$/,"")+"/")||y.startsWith(x.replace(/\/$/,"")+"/")));
}
function missionDependencyReady(state,mission){
 const deps=uniq(mission?.dependencies||mission?.dependsOn);
 if(!deps.length)return false;
 return deps.every(id=>["verified","complete"].includes(state.missions?.[id]?.status));
}
function newlyUnlockedMissions(state){
 return Object.values(state.missions||{}).filter(m=>!TERMINAL_MISSION.has(m.status)&&["queued","blocked","waiting","dependency-wait"].includes(m.status||"queued")&&missionDependencyReady(state,m)).map(m=>m.id);
}
export function computeSquadConvergence(state,squad,cycle,{persist=true}={}){
 const c=ensureConvergenceState(state),workers=SQUADS[squad];
 if(!workers)throw new Error("unknown squad "+squad);
 const checkpoints=workers.map(id=>getWorkerCheckpoint(state,id,cycle));
 const missing=workers.filter((id,i)=>!checkpoints[i]);
 const unreviewed=workers.filter((id,i)=>checkpoints[i]&&checkpoints[i].reviewed!==true);
 const ready=missing.length===0&&unreviewed.length===0;
 const overlaps=[];
 const blockers=[];
 const dependencyChanges=new Set();
 if(ready){
  for(let i=0;i<checkpoints.length;i++){
   const a=checkpoints[i];
   blockers.push(...a.blockers.map(x=>({workerId:a.workerId,blocker:clone(x)})));
   a.dependencies.forEach(x=>dependencyChanges.add(x));
   for(let j=i+1;j<checkpoints.length;j++){
    const b=checkpoints[j];
    if(scopesOverlap(a.scopePaths,b.scopePaths))overlaps.push({workers:[a.workerId,b.workerId],scopeA:[...a.scopePaths],scopeB:[...b.scopePaths]});
   }
  }
 }
 const result={
  id:`squad-convergence:${squad}:${cycle}`,
  squad,cycle,ready,
  checkpointIds:checkpoints.filter(Boolean).map(x=>x.id),
  missingWorkers:missing,
  unreviewedWorkers:unreviewed,
  overlaps,
  blockers,
  dependencies:[...dependencyChanges],
  newlyUnlockedMissionIds:ready?newlyUnlockedMissions(state):[],
  at:Date.now()
 };
 if(persist){
  const target=c.squads[squad];
  target.last=clone(result);
  target.history=[...(target.history||[]),clone(result)].slice(-100);
  state.updatedAt=result.at;
 }
 return result;
}

export function createObjectiveProgress(missionId){
 return {
  missionId,
  stages:Object.fromEntries(OBJECTIVE_STAGES.map(stage=>[stage,{status:"pending",evidence:[],at:null}])),
  currentStage:"research",
  percent:0,
  status:"pending",
  updatedAt:Date.now()
 };
}
function stageStatus(pass,blocked=false){return blocked?"blocked":pass?"pass":"pending"}
function evidenceList(value){return arr(value).filter(Boolean).map(clone)}
export function deriveObjectiveProgress(missionId,{research=null,work=null,build=null,orchestrator=null,verification=null}={}){
 const p=createObjectiveProgress(missionId);
 const gates=verification?.gates||{};
 const researchPass=research?.complete===true||research?.ready===true;
 const workPass=work?.approved===true||work?.deltaApproved===true;
 const buildPass=build?.complete===true||(arr(build?.results).length>0&&arr(build.results).every(r=>arr(r.blockers).length===0&&arr(r.remaining_implementation||r.remainingImplementation).length===0));
 const orchState=orchestrator?.state||orchestrator?.decision||null;
 const orchPass=orchState==="COMPLETE"||gates.orchestrator?.status==="pass";

 const defs={
  research:{status:stageStatus(researchPass,research?.blocked===true),evidence:evidenceList(research?.evidence)},
  work_approval:{status:stageStatus(workPass,work?.blocked===true),evidence:evidenceList(work?.evidence)},
  build:{status:stageStatus(buildPass,build?.blocked===true),evidence:evidenceList(build?.evidence)},
  orchestrator_qa:{status:stageStatus(orchPass,orchState==="BLOCKED"),evidence:evidenceList(orchestrator?.evidence)},
  git:{status:gates.git?.status==="fail"||gates.ci?.status==="fail"?"fail":gates.git?.status==="pass"&&gates.ci?.status==="pass"?"pass":"pending",evidence:[...evidenceList(gates.git?.evidence),...evidenceList(gates.ci?.evidence)]},
  runtime:{status:gates.runtime?.status||"pending",evidence:evidenceList(gates.runtime?.evidence)},
  acceptance:{status:gates.acceptance?.status||"pending",evidence:evidenceList(gates.acceptance?.evidence)}
 };
 for(const stage of OBJECTIVE_STAGES)p.stages[stage]={...defs[stage],at:Date.now()};
 const completed=OBJECTIVE_STAGES.filter(x=>p.stages[x].status==="pass").length;
 const firstOpen=OBJECTIVE_STAGES.find(x=>p.stages[x].status!=="pass");
 p.currentStage=firstOpen||"complete";
 p.percent=Math.round(completed/OBJECTIVE_STAGES.length*100);
 p.status=OBJECTIVE_STAGES.every(x=>p.stages[x].status==="pass")?"complete":OBJECTIVE_STAGES.some(x=>["fail","blocked"].includes(p.stages[x].status))?"attention":"pending";
 p.updatedAt=Date.now();
 return p;
}
export function recordObjectiveProgress(state,missionId,inputs){
 ensureConvergenceState(state);
 const p=deriveObjectiveProgress(missionId,inputs);
 state.objectiveProgress[missionId]=clone(p);
 state.updatedAt=p.updatedAt;
 return p;
}
export function finalMissionConvergence(state,missionId,{builderResults=[],orchestratorDecision=null,verification=null}={}){
 const c=ensureConvergenceState(state),mission=state.missions?.[missionId]||null;
 if(!mission)throw new Error("unknown mission "+missionId);
 const builders=arr(builderResults);
 const buildersComplete=builders.length>0&&builders.every(r=>arr(r.blockers).length===0&&arr(r.remaining_implementation||r.remainingImplementation).length===0);
 const orchState=orchestratorDecision?.state||orchestratorDecision?.decision||null;
 const orchestratorComplete=orchState==="COMPLETE";
 const gates=verification?.gates||{};
 const requiredGates=["git","ci","runtime","acceptance","orchestrator"];
 const missingGates=requiredGates.filter(g=>gates[g]?.status!=="pass");
 const verified=buildersComplete&&orchestratorComplete&&missingGates.length===0;
 const result={
  missionId,
  verified,
  buildersComplete,
  orchestratorComplete,
  missingGates,
  builderResultIds:builders.map(x=>x.result_id||x.resultId||x.id).filter(Boolean),
  orchestratorDecisionId:orchestratorDecision?.decision_id||orchestratorDecision?.decisionId||null,
  verificationStatus:verification?.status||null,
  blockers:builders.flatMap(r=>arr(r.blockers).map(b=>({builder:r.builder_slot||r.builderSlot||null,blocker:clone(b)}))),
  at:Date.now()
 };
 c.missions[missionId]=clone(result);
 state.updatedAt=result.at;
 return result;
}
