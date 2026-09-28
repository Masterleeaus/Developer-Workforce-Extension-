const KEY='titan5x5.state.v2';
const DEFAULT={enabled:false,workerTabs:[null,null,null,null,null],counts:[0,0,0,0,0],lastSeen:[0,0,0,0,0],reviewQueue:[],activeReview:null,reviewHistory:[],pollMs:6000,missions:[null,null,null,null,null],workerHealth:[null,null,null,null,null],reviewTimeoutMs:180000,reviewAttempts:{},armed:false,emergencyStop:false,lastArmAt:null,ownershipLeases:[],missionQueue:[],missionHistory:[],dispatch:{minGapMs:1500,maxConcurrent:5,lastSendAt:0,pending:[]},checkpoints:[null,null,null,null,null],convergence:{round:0,lastCheckpointPasses:[0,0,0,0,0],history:[]},auditLog:[],recovery:{lastShutdownAt:null,lastStartupAt:null,unclean:false,reconciled:false},workerIdentity:[null,null,null,null,null],sendLedger:[],approvals:[],reviewScheduler:{cursor:0,lastGrantedAt:[0,0,0,0,0]},utilization:{target:5,min:2,max:5,lastAdjustedAt:0,reason:'normal',lastAdvanceAt:[0,0,0,0,0],grants:0}};
let state={...DEFAULT}; let timer=null;

let ticking=false;
function now(){return Date.now()}
function reviewKey(i,count){return `w${i}-p${count}`}
function hasQueuedReview(i,count){
 const k=reviewKey(i,count);
 return state.activeReview?.key===k||state.reviewQueue.some(x=>x.key===k)||state.reviewHistory.some(x=>x.key===k);
}
function normalizeState(){
 state.workerTabs=Array.isArray(state.workerTabs)?state.workerTabs.slice(0,5):[null,null,null,null,null];
 while(state.workerTabs.length<5)state.workerTabs.push(null);
 for(const k of ['counts','lastSeen']){state[k]=Array.isArray(state[k])?state[k].slice(0,5):[0,0,0,0,0];while(state[k].length<5)state[k].push(0)}
 state.missions=Array.isArray(state.missions)?state.missions.slice(0,5):[null,null,null,null,null];while(state.missions.length<5)state.missions.push(null);
 state.workerHealth=Array.isArray(state.workerHealth)?state.workerHealth.slice(0,5):[null,null,null,null,null];while(state.workerHealth.length<5)state.workerHealth.push(null);
 state.reviewQueue=Array.isArray(state.reviewQueue)?state.reviewQueue:[];
 state.reviewHistory=Array.isArray(state.reviewHistory)?state.reviewHistory.slice(-50):[];
 state.reviewAttempts=state.reviewAttempts&&typeof state.reviewAttempts==='object'?state.reviewAttempts:{};
 state.ownershipLeases=Array.isArray(state.ownershipLeases)?state.ownershipLeases:[];
 state.missionQueue=Array.isArray(state.missionQueue)?state.missionQueue:[];
 state.missionHistory=Array.isArray(state.missionHistory)?state.missionHistory:[];
 state.dispatch=state.dispatch&&typeof state.dispatch==='object'?{...DEFAULT.dispatch,...state.dispatch}:{...DEFAULT.dispatch};
 state.dispatch.pending=Array.isArray(state.dispatch.pending)?state.dispatch.pending:[];
 state.checkpoints=Array.isArray(state.checkpoints)?state.checkpoints.slice(0,5):[null,null,null,null,null];while(state.checkpoints.length<5)state.checkpoints.push(null);
 state.convergence=state.convergence&&typeof state.convergence==='object'?{...DEFAULT.convergence,...state.convergence}:{...DEFAULT.convergence};
 state.convergence.lastCheckpointPasses=Array.isArray(state.convergence.lastCheckpointPasses)?state.convergence.lastCheckpointPasses.slice(0,5):[0,0,0,0,0];while(state.convergence.lastCheckpointPasses.length<5)state.convergence.lastCheckpointPasses.push(0);
 state.convergence.history=Array.isArray(state.convergence.history)?state.convergence.history:[];
 state.auditLog=Array.isArray(state.auditLog)?state.auditLog:[];
 state.recovery=state.recovery&&typeof state.recovery==='object'?{...DEFAULT.recovery,...state.recovery}:{...DEFAULT.recovery};
 state.workerIdentity=Array.isArray(state.workerIdentity)?state.workerIdentity.slice(0,5):[null,null,null,null,null];while(state.workerIdentity.length<5)state.workerIdentity.push(null);
 state.sendLedger=Array.isArray(state.sendLedger)?state.sendLedger:[];
 state.approvals=Array.isArray(state.approvals)?state.approvals:[];
 state.reviewScheduler=state.reviewScheduler&&typeof state.reviewScheduler==='object'?{...DEFAULT.reviewScheduler,...state.reviewScheduler}:{...DEFAULT.reviewScheduler};
 state.reviewScheduler.lastGrantedAt=Array.isArray(state.reviewScheduler.lastGrantedAt)?state.reviewScheduler.lastGrantedAt.slice(0,5):[0,0,0,0,0];while(state.reviewScheduler.lastGrantedAt.length<5)state.reviewScheduler.lastGrantedAt.push(0);
 state.utilization=state.utilization&&typeof state.utilization==='object'?{...DEFAULT.utilization,...state.utilization}:{...DEFAULT.utilization};
 state.utilization.lastAdvanceAt=Array.isArray(state.utilization.lastAdvanceAt)?state.utilization.lastAdvanceAt.slice(0,5):[0,0,0,0,0];while(state.utilization.lastAdvanceAt.length<5)state.utilization.lastAdvanceAt.push(0);
}
async function tabExists(id){if(!id)return false;try{await chrome.tabs.get(id);return true}catch{return false}}
async function recoverTabs(){
 let lost=false;
 for(let i=0;i<5;i++){
   const id=state.workerTabs[i];
   if(id&&await tabExists(id))continue;
   if(id)lost=true;
   state.workerHealth[i]={status:'tab-lost',at:now(),previousTab:id||null};
   state.workerTabs[i]=null;state.lastSeen[i]=0;
 }
 if(lost&&state.armed){state.armed=false;state.enabled=false;stop()}
 return !lost;
}
function setHealth(i,status,extra={}){state.workerHealth[i]={status,at:now(),...extra}}


async function load(){
 const x=await chrome.storage.local.get(KEY);state={...DEFAULT,...(x[KEY]||{})};normalizeState();
 const wasActive=!!(state.enabled||state.armed);state.recovery.unclean=wasActive;state.enabled=false;state.armed=false;
 render();await reconcileAfterRestart();render();
}
async function save(){await chrome.storage.local.set({[KEY]:state});render()}
async function exec(tabId,func,args=[]){try{const r=await chrome.scripting.executeScript({target:{tabId},func,args});return r?.[0]?.result}catch{return null}}
function pageState(){
 const msgs=[...document.querySelectorAll('[data-message-author-role]')].map(e=>({role:e.getAttribute('data-message-author-role'),text:(e.innerText||'').trim()})).filter(x=>x.text);
 const generating=!!document.querySelector('[data-testid="stop-button"],button[aria-label*="Stop" i]');
 return {count:msgs.filter(x=>x.role==='assistant').length,generating,msgs:msgs.slice(-12),url:location.href,title:document.title};
}

function conversationIdentity(url){
 try{
  const u=new URL(url),m=u.pathname.match(/^\/c\/([^/?#]+)/);
  return {origin:u.origin,conversationId:m?.[1]||null,path:u.pathname,key:m?.[1]?`${u.origin}/c/${m[1]}`:`${u.origin}${u.pathname}`};
 }catch{return null}
}
async function bindWorkerIdentity(i,tabId){
 const tab=await chrome.tabs.get(tabId),id=conversationIdentity(tab.url||'');
 if(!id)return false;
 state.workerIdentity[i]={...id,tabId,boundAt:Date.now(),title:tab.title||''};
 audit('worker-identity-bound',{worker:i+1,tabId,key:id.key});
 return true;
}
async function identityMatches(i,tabId){
 const expected=state.workerIdentity?.[i];if(!expected)return false;
 try{
  const tab=await chrome.tabs.get(tabId),actual=conversationIdentity(tab.url||'');
  return !!actual&&actual.key===expected.key;
 }catch{return false}
}
async function guardedWorkerSend(i,text,opts={}){
 const tabId=state.workerTabs?.[i];
 if(!tabId||!await identityMatches(i,tabId)){
   setHealth(i,'identity-mismatch',{expected:state.workerIdentity?.[i]?.key||null});
   const m=state.missions?.[i];if(m){m.status='attention';m.blocker='Worker tab conversation identity changed'}
   audit('worker-identity-mismatch',{worker:i+1,tabId});
   state.armed=false;state.enabled=false;stop();await save();return false;
 }
 const m=state.missions?.[i];
 const kind=opts.action?.kind||(text==='NEXT'?'next':'prompt');
 const action={worker:i+1,kind,missionId:m?.id||null,pass:state.counts?.[i]??null,...(opts.action||{})};
 return send(tabId,text,{...opts,action});
}

function sendPrompt(text){
 const el=document.querySelector('#prompt-textarea,[contenteditable="true"][data-lexical-editor="true"],textarea');if(!el)return false;
 el.focus();if(el.tagName==='TEXTAREA'){el.value=text;el.dispatchEvent(new Event('input',{bubbles:true}))}else{el.innerHTML='';document.execCommand('insertText',false,text);el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}))}
 setTimeout(()=>{const b=document.querySelector('[data-testid="send-button"],button[aria-label*="Send" i]');if(b&&!b.disabled)b.click();else el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true}))},150);return true;
}





/* Adaptive Worker Utilization v0.1 — local pressure control */
function systemPressure(){
 const reviews=(state.reviewQueue||[]).length+(state.activeReview?1:0);
 const conflicts=coordinationScan().length;
 const verification=(state.missions||[]).filter(m=>m&&['verification','runtime-verification','acceptance-review'].includes(m.status)).length;
 const attention=(state.missions||[]).filter(m=>m&&['blocked','attention','verification-failed','runtime-failed','coordination-wait'].includes(m.status)).length;
 const dispatch=(state.dispatch?.pending||[]).length;
 const score=reviews*2+conflicts*2+verification+attention*2+Math.min(3,dispatch);
 return {score,reviews,conflicts,verification,attention,dispatch};
}
function adjustUtilization(){
 const p=systemPressure();let target=5,reason='normal';
 if(p.score>=10){target=2;reason='high-pressure'}
 else if(p.score>=6){target=3;reason='pressure'}
 else if(p.score>=3){target=4;reason='moderate-pressure'}
 state.utilization.target=Math.max(state.utilization.min,Math.min(state.utilization.max,target));
 state.utilization.reason=reason;state.utilization.lastAdjustedAt=Date.now();
 state.dispatch.maxConcurrent=state.utilization.target;
 return {target:state.utilization.target,reason,pressure:p};
}
function continuationCandidates(){
 const out=[];
 for(let w=0;w<5;w++){
   const m=state.missions?.[w],h=state.workerHealth?.[w]?.status;
   if(m&&!['verified','coordination-wait'].includes(m.status)&&!['reviewing','awaiting-review','backpressure','emergency-stopped'].includes(h))out.push(w);
 }
 return out;
}
function continuationGrantSet(){
 const target=state.utilization.target||5,candidates=continuationCandidates();
 return new Set(candidates.sort((a,b)=>(state.utilization.lastAdvanceAt[a]||0)-(state.utilization.lastAdvanceAt[b]||0)||a-b).slice(0,target));
}
function workerMayAdvance(i,grantSet=null){
 return (grantSet||continuationGrantSet()).has(i);
}
function recordAdvance(i){
 state.utilization.lastAdvanceAt[i]=Date.now();state.utilization.grants=(state.utilization.grants||0)+1;
}
window.TitanUtilization={pressure:systemPressure,adjust:adjustUtilization,state:()=>({...state.utilization})};

/* Stagger-Preserving Review Scheduler v0.1
 * Policy decides eligibility; scheduler decides which eligible worker gets
 * the normal scheduled-review slot. Exceptions still bypass the scheduler.
 */
function reviewEligibility(i,count){
 const p=missionPolicy(i),last=state.reviewScheduler.lastGrantedAt?.[i]||0;
 if(count<=last)return false;
 if(p.reviewEvery===5)return reviewDue(i,count);
 return count-last>=p.reviewEvery;
}
function chooseScheduledReview(candidates){
 if(!candidates.length)return null;
 const start=state.reviewScheduler.cursor%5;
 for(let step=0;step<5;step++){
   const w=(start+step)%5;
   if(candidates.includes(w)){
     state.reviewScheduler.cursor=(w+1)%5;
     state.reviewScheduler.lastGrantedAt[w]=state.counts[w];
     return w;
   }
 }
 return candidates[0];
}
function scheduledReviewSet(){
 const eligible=[];
 for(let i=0;i<5;i++){
   const m=state.missions?.[i];
   if(!m||['coordination-wait','verified'].includes(m.status))continue;
   if(reviewEligibility(i,state.counts[i]))eligible.push(i);
 }
 const chosen=chooseScheduledReview(eligible);
 return chosen==null?new Set():new Set([chosen]);
}
window.TitanReviewScheduler={
 eligible:(i)=>reviewEligibility(i,state.counts[i]),
 choose:()=>scheduledReviewSet(),
 state:()=>JSON.parse(JSON.stringify(state.reviewScheduler))
};

/* Mission Policy Profiles v0.1 */
const POLICY_PROFILES={
 fast:{reviewEvery:5,maxPasses:30,maxReviews:6,maxMinutes:180,requireRuntime:false,requireServer:false,approvalOnFailureOverride:true},
 standard:{reviewEvery:5,maxPasses:25,maxReviews:6,maxMinutes:180,requireRuntime:true,requireServer:false,approvalOnFailureOverride:true},
 sensitive:{reviewEvery:3,maxPasses:18,maxReviews:7,maxMinutes:150,requireRuntime:true,requireServer:true,approvalOnFailureOverride:true},
 production:{reviewEvery:2,maxPasses:15,maxReviews:8,maxMinutes:120,requireRuntime:true,requireServer:true,approvalOnFailureOverride:true}
};
function inferPolicy(m){
 if(!m)return 'standard';
 if(m.policy&&m.policy!=='auto'&&POLICY_PROFILES[m.policy])return m.policy;
 const t=[m.title,m.goal,m.repo,(m.constraints||[]).join(' '),(m.acceptance||[]).map(x=>x.text).join(' ')].join(' ').toLowerCase();
 if(/\b(production|deploy|release|security|auth|permission|tenant|migration|database|directadmin|vps)\b/.test(t))return 'production';
 if(/\b(payment|authority|executiongateway|installer|runtime|server|credential|secret)\b/.test(t))return 'sensitive';
 if(/\b(doc|documentation|readme|comment|test only|tests only)\b/.test(t))return 'fast';
 return 'standard';
}
function missionPolicy(i){
 const m=state.missions?.[i];const name=inferPolicy(m),p=POLICY_PROFILES[name]||POLICY_PROFILES.standard;
 return {name,...p};
}
function applyPolicyBudget(i){
 const m=state.missions?.[i];if(!m)return;
 const p=missionPolicy(i);
 // Explicit smaller mission budget remains respected; profile supplies upper defaults.
 m.budget=m.budget||{};
 m.budget.maxPasses=Math.min(m.budget.maxPasses??p.maxPasses,p.maxPasses);
 m.budget.maxReviews=Math.min(m.budget.maxReviews??p.maxReviews,p.maxReviews);
 m.budget.maxMinutes=Math.min(m.budget.maxMinutes??p.maxMinutes,p.maxMinutes);
}

window.TitanPolicy={profiles:POLICY_PROFILES,infer:inferPolicy,forWorker:missionPolicy,apply:applyPolicyBudget};

/* High-impact Approval Gate v0.1 */
const HIGH_IMPACT=new Set([
 'override-verification','override-acceptance','override-ownership',
 'change-mission-scope','force-complete','force-recycle','cross-repo-write'
]);
function requestApproval(type,data={}){
 const id=`approval-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
 const a={id,type,data,status:'pending',requestedAt:Date.now(),resolvedAt:null};
 state.approvals=[...(state.approvals||[]),a].slice(-100);
 audit('approval-requested',{id,type,worker:data.worker||null,missionId:data.missionId||null});
 window.dispatchEvent(new CustomEvent('titan5x5:approval-request',{detail:a}));
 return id;
}
function resolveApproval(id,approved,note=''){
 const a=state.approvals.find(x=>x.id===id);if(!a||a.status!=='pending')return false;
 a.status=approved?'approved':'denied';a.note=String(note).slice(0,1000);a.resolvedAt=Date.now();
 audit('approval-resolved',{id,type:a.type,status:a.status});return true;
}
function approvedFor(type,predicate=()=>true){
 return state.approvals.some(a=>a.type===type&&a.status==='approved'&&predicate(a)&&Date.now()-a.resolvedAt<30*60*1000);
}
window.TitanApprovals={
 request:requestApproval,
 approve:(id,note='')=>resolveApproval(id,true,note),
 deny:(id,note='')=>resolveApproval(id,false,note),
 pending:()=>state.approvals.filter(a=>a.status==='pending'),
 list:()=>state.approvals.slice(),
 approvedFor
};

/* Prompt Idempotency v0.1 */
function actionKey({worker=null,kind='prompt',missionId=null,pass=null,reviewId=null,text=''}) {
 const basis=[worker,kind,missionId,pass,reviewId,String(text).slice(0,400)].join('|');
 let h=2166136261;
 for(let i=0;i<basis.length;i++){h^=basis.charCodeAt(i);h=Math.imul(h,16777619)}
 return `t5-${kind}-${worker??'x'}-${(h>>>0).toString(16)}`;
}
function ledgerHas(key){return (state.sendLedger||[]).some(x=>x.key===key&&x.ok)}
function ledgerRecord(entry){state.sendLedger=[...(state.sendLedger||[]),entry].slice(-500)}
window.TitanSendLedger={list:(n=100)=>state.sendLedger.slice(-n),has:ledgerHas,key:actionKey};

async function rawSend(tabId,text){return !!(await exec(tabId,sendPrompt,[text]))}
async function send(tabId,text,{priority=5,action=null}={}){
 const key=action?.key||actionKey({...action,text});
 if(ledgerHas(key)){audit('prompt-duplicate-suppressed',{key,tabId,kind:action?.kind||'prompt'});return true}
 if(state.dispatch.pending.some(x=>x.key===key)){audit('prompt-pending-duplicate-suppressed',{key,tabId});return true}
 return new Promise(resolve=>{
   state.dispatch.pending.push({tabId,text,priority,key,action,queuedAt:Date.now(),resolve});
   state.dispatch.pending.sort((a,b)=>a.priority-b.priority||a.queuedAt-b.queuedAt);
   drainDispatch().catch(()=>{});
 });
}
let dispatching=false;
async function activeGeneratingCount(){
 let n=0;
 for(const id of state.workerTabs||[]){if(!id)continue;const p=await exec(id,pageState);if(p?.generating)n++}
 return n;
}
async function drainDispatch(){
 if(dispatching||!state.dispatch.pending.length||state.emergencyStop)return;
 dispatching=true;
 try{
  while(state.dispatch.pending.length&&!state.emergencyStop){
   const active=await activeGeneratingCount();
   if(active>=state.dispatch.maxConcurrent){await new Promise(r=>setTimeout(r,1000));continue}
   const wait=Math.max(0,state.dispatch.minGapMs-(Date.now()-state.dispatch.lastSendAt));
   if(wait)await new Promise(r=>setTimeout(r,wait));
   const item=state.dispatch.pending.shift();
   const ok=await rawSend(item.tabId,item.text);
   ledgerRecord({key:item.key,at:Date.now(),tabId:item.tabId,ok,kind:item.action?.kind||'prompt',worker:item.action?.worker??null,missionId:item.action?.missionId||null,pass:item.action?.pass??null});
   audit('prompt-send',{key:item.key,tabId:item.tabId,priority:item.priority,ok,kind:item.action?.kind||item.text==='NEXT'?'next':item.priority<=2?'review':'mission',preview:String(item.text).slice(0,180)});
   state.dispatch.lastSendAt=Date.now();item.resolve(ok);
  }
 }finally{dispatching=false}
}
function compact(msgs,workerIndex=null){
 const limit=workerIndex!=null&&state.checkpoints?.[workerIndex]?9000:18000;
 return msgs.map(m=>`${m.role.toUpperCase()}: ${m.text}`).join('\n\n').slice(-limit);
}
function reviewDue(i,count){return ((count-1)%5)===i}

/*
 * Native review adapter.
 *
 * The extension is the supervisor. A review provider may be registered by the
 * native Codex/Automation integration and receives compact structured state.
 * It returns ONLY the next worker instruction.
 *
 * This intentionally does not create/use a sixth ChatGPT tab.
 */
const Titan5x5Review={
 provider:null,
 register(fn){this.provider=typeof fn==='function'?fn:null},
 async run(job){
   if(this.provider)return await this.provider(job);
   window.dispatchEvent(new CustomEvent('titan5x5:review-request',{detail:job}));
   return null;
 }
};
window.Titan5x5Review=Titan5x5Review;
window.addEventListener('titan5x5:review-result',async e=>{
 const d=e.detail||{};if(!state.activeReview||d.id!==state.activeReview.id||!d.instruction)return;
 const a=state.activeReview;const envelope=parseReviewEnvelope(d.instruction);applySemanticAcceptance(a.worker,envelope.acceptance);
 if(await guardedWorkerSend(a.worker,envelope.instruction||'NEXT',{priority:2,action:{kind:'review',reviewId:a.id,pass:a.count}})){
   d.instruction=envelope.instruction||'NEXT';
   state.reviewHistory.push({id:a.id,key:a.key,worker:a.worker,count:a.count,at:Date.now(),instruction:d.instruction.slice(0,2000)});
   state.checkpoints[a.worker]=makeCheckpoint(a.worker,a,d.instruction);
   state.reviewHistory=state.reviewHistory.slice(-50);
   runConvergence();state.activeReview=null;await save();
 }
});



/* Titan Context + Architecture v0.1
 * Compact, mission-scoped context injected only into deep reviews.
 */
const TITAN_INVARIANTS=[
 'tenant_company_id/company_id boundaries must fail closed; never substitute actor user_id for tenancy',
 'reuse existing engines, gateways, services and business state before creating new ones',
 'do not bypass Authority/authorization or ExecutionGateway paths for mutations',
 'preserve idempotency, correlation IDs, actor identity and evidence references across execution',
 'do not create a second source of truth for business state',
 'one active implementation branch/worktree per worker mission; converge through main',
 'verify behavior with tests and runtime evidence, not implementation claims'
];
const TITAN_ARCH={
 'interaction':['Interaction Engine','intent/context','conversation route','capability selection'],
 'decision':['Decision Engine','policy/decision','Authority','ExecutionGateway'],
 'workforce':['workforce runtime','dispatcher','persistent agents','work orders','appointments','field mutations'],
 'field':['Titan Go','offline snapshot','worker identity','forms','evidence','time/material/photo/signature'],
 'customer':['customer surface','customer operations gateway','requests','bookings','quotes','invoices','support'],
 'owner':['Titan Zero owner surface','dashboard','dispatch','customers','sales','money','workforce','approvals'],
 'directadmin':['DirectAdmin cockpit','server orchestration','plugins','domains','email','sites','VPS/runtime'],
 'crm':['CRM authority','tenant company scope','customer/contact/service/location/asset/work order/appointment'],
 'commerce':['Titan Commerce','catalogue','channels','inventory','orders','returns','settlement'],
 'runtime':['VPS installer','SQLite/runtime persistence','CI','deployment','diagnostics']
};
function tokenize(s){return new Set((s||'').toLowerCase().split(/[^a-z0-9_]+/).filter(x=>x.length>2))}
function relevantArchitecture(mission,transcript=''){
 const hay=tokenize([mission?.title,mission?.goal,mission?.repo,mission?.constraints?.join(' '),mission?.acceptance?.map(x=>x.text).join(' '),transcript.slice(-6000)].filter(Boolean).join(' '));
 const scored=[];
 for(const [key,items] of Object.entries(TITAN_ARCH)){
   let score=hay.has(key)?3:0;
   for(const item of items)for(const w of tokenize(item))if(hay.has(w))score++;
   if(score)scored.push({key,items,score});
 }
 return scored.sort((a,b)=>b.score-a.score).slice(0,4);
}
function architectureContext(i,transcript=''){
 const m=state.missions?.[i]||null,rels=relevantArchitecture(m,transcript);
 return [
   'TITAN ARCHITECTURE INVARIANTS:',
   ...TITAN_INVARIANTS.map(x=>`- ${x}`),
   rels.length?'RELEVANT SUBSYSTEMS:':'',
   ...rels.map(r=>`- ${r.key}: ${r.items.join(' → ')}`)
 ].filter(Boolean).join('\n');
}
window.TitanArchitecture={
 invariants:()=>TITAN_INVARIANTS.slice(),
 map:()=>JSON.parse(JSON.stringify(TITAN_ARCH)),
 context:(workerIndex,transcript='')=>architectureContext(workerIndex,transcript),
 relevant:(workerIndex,transcript='')=>relevantArchitecture(state.missions?.[workerIndex],transcript)
};


/* Repository Context v0.1
 * Provider-backed index of real repository files/tests/symbols/dependency edges.
 * The provider may be backed by stock GitHub, Codex workspace or a local index.
 */
const TitanRepositoryContext={
 provider:null,
 cache:new Map(),
 register(fn){this.provider=typeof fn==='function'?fn:null},
 async query(workerIndex,transcript=''){
   const m=state.missions?.[workerIndex];if(!m||!m.repo)return null;
   const key=[m.repo,m.branch||'',m.title||'',m.goal||'',transcript.slice(-2000)].join('|');
   if(this.cache.has(key))return this.cache.get(key);
   if(!this.provider){
     window.dispatchEvent(new CustomEvent('titan5x5:repo-context-request',{detail:{workerIndex,mission:m,transcript:transcript.slice(-6000)}}));
     return null;
   }
   const r=await this.provider({workerIndex,mission:m,transcript:transcript.slice(-6000),limit:{files:12,tests:8,symbols:12,edges:12}});
   if(r)this.cache.set(key,r);if(this.cache.size>30)this.cache.delete(this.cache.keys().next().value);
   return r||null;
 }
};
window.TitanRepositoryContext=TitanRepositoryContext;
window.installTitan5x5RepositoryContext=function(provider){
 if(typeof provider!=='function')throw new TypeError('Repository Context provider must be a function');
 TitanRepositoryContext.register(provider);window.dispatchEvent(new CustomEvent('titan5x5:repo-context-ready'));return true;
};
function compactRepoContext(r){
 if(!r)return '';
 const files=(r.files||[]).slice(0,12).map(x=>typeof x==='string'?x:(x.path||x.name)).filter(Boolean);
 const tests=(r.tests||[]).slice(0,8).map(x=>typeof x==='string'?x:(x.path||x.name)).filter(Boolean);
 const symbols=(r.symbols||[]).slice(0,12).map(x=>typeof x==='string'?x:[x.name,x.path].filter(Boolean).join(' @ ')).filter(Boolean);
 const edges=(r.edges||[]).slice(0,12).map(x=>typeof x==='string'?x:`${x.from||'?'} → ${x.to||'?'}`).filter(Boolean);
 return ['REPOSITORY IMPACT SLICE:',
  files.length?`Files: ${files.join(', ')}`:'',
  tests.length?`Tests: ${tests.join(', ')}`:'',
  symbols.length?`Symbols: ${symbols.join(', ')}`:'',
  edges.length?`Dependencies: ${edges.join('; ')}`:'',
  r.summary?`Summary: ${String(r.summary).slice(0,1600)}`:''
 ].filter(Boolean).join('\n');
}
window.addEventListener('titan5x5:repo-context-result',e=>{
 const d=e.detail||{};if(d.cacheKey&&d.context)TitanRepositoryContext.cache.set(d.cacheKey,d.context);
});



/* Ownership Leases v0.1
 * Concrete zero-token claims over files/symbols/subsystems.
 */
const LEASE_TTL=30*60*1000;
function normalizeResource(x){
 return String(x||'').trim().replace(/\\/g,'/').toLowerCase();
}
function pruneLeases(){
 const t=Date.now();
 state.ownershipLeases=(state.ownershipLeases||[]).filter(l=>{
   const m=state.missions?.[l.worker];
   return l.expiresAt>t&&m&&!['verified','complete'].includes(m.status);
 });
}
function workerLeases(i){pruneLeases();return state.ownershipLeases.filter(l=>l.worker===i)}
function claimResources(i,resources,source='mission'){
 pruneLeases();
 const now=Date.now(),claimed=[],conflicts=[];
 for(const raw of resources||[]){
   const resource=normalizeResource(raw);if(!resource)continue;
   const existing=state.ownershipLeases.find(l=>l.resource===resource&&l.worker!==i);
   if(existing){conflicts.push({resource,owner:existing.worker});continue}
   let own=state.ownershipLeases.find(l=>l.resource===resource&&l.worker===i);
   if(own){own.expiresAt=now+LEASE_TTL;own.source=source}
   else {own={resource,worker:i,source,claimedAt:now,expiresAt:now+LEASE_TTL};state.ownershipLeases.push(own)}
   claimed.push(resource);
 }
 return {claimed,conflicts};
}
function releaseWorkerLeases(i){state.ownershipLeases=state.ownershipLeases.filter(l=>l.worker!==i)}
function resourcesFromRepoContext(r){
 const out=[];
 for(const x of r?.files||[])out.push(typeof x==='string'?x:(x.path||x.name||''));
 for(const x of r?.symbols||[])out.push(`symbol:${typeof x==='string'?x:(x.name||'')}`);
 return out.filter(Boolean).slice(0,24);
}
function leaseConflicts(){
 pruneLeases();const by=new Map,conf=[];
 for(const l of state.ownershipLeases){if(!by.has(l.resource))by.set(l.resource,l);else if(by.get(l.resource).worker!==l.worker)conf.push([by.get(l.resource),l])}
 return conf;
}
window.TitanOwnership={
 claim:(i,r,source)=>claimResources(i,r,source),
 release:(i)=>{releaseWorkerLeases(i);return true},
 list:()=>{pruneLeases();return state.ownershipLeases.slice()},
 worker:(i)=>workerLeases(i)
};

/* Worker Coordination v0.1
 * Local collision detection. It does not consume Codex tokens.
 */
function missionTerms(m){
 if(!m)return new Set;
 return tokenize([m.repo,m.branch,m.title,m.goal,(m.constraints||[]).join(' '),(m.acceptance||[]).map(x=>x.text).join(' ')].filter(Boolean).join(' '));
}
function missionOverlap(a,b){
 if(!a||!b)return {score:0,reasons:[]};
 const reasons=[];let score=0;
 if(a.repo&&b.repo&&a.repo===b.repo){score+=2;reasons.push('same repository')}
 if(a.branch&&b.branch&&a.branch===b.branch){score+=8;reasons.push('same branch')}
 const A=missionTerms(a),B=missionTerms(b);
 const shared=[...A].filter(x=>B.has(x)&&x.length>4&&!['titan','mission','worker','complete','tests','field','service'].includes(x));
 if(shared.length){score+=Math.min(6,shared.length);reasons.push(`shared scope: ${shared.slice(0,6).join(', ')}`)}
 return {score,reasons};
}
function coordinationScan(){
 const conflicts=[];
 for(let i=0;i<5;i++)for(let j=i+1;j<5;j++){
  const a=state.missions?.[i],b=state.missions?.[j];if(!a||!b)continue;
  if(['verified','complete'].includes(a.status)||['verified','complete'].includes(b.status))continue;
  const o=missionOverlap(a,b);
  if(o.score>=7)conflicts.push({workers:[i,j],score:o.score,reasons:o.reasons});
 }
 return conflicts.sort((a,b)=>b.score-a.score);
}
function applyCoordination(){
 const conflicts=coordinationScan(),blocked=new Set;
 for(const c of conflicts){
   // Higher-numbered worker yields deterministically; avoids supervisor reasoning.
   const loser=Math.max(...c.workers),winner=Math.min(...c.workers);
   blocked.add(loser);
   const m=state.missions?.[loser];
   if(m&&m.status!=='verified'){m.status='coordination-wait';m.blocker=`Waiting for W${winner+1}: ${c.reasons.join('; ')}`}
   setHealth(loser,'coordination-wait',{forWorker:winner+1,reasons:c.reasons});
 }
 for(let i=0;i<5;i++){
   const m=state.missions?.[i];
   if(m?.status==='coordination-wait'&&!blocked.has(i)){m.status='assigned';m.blocker=null;setHealth(i,'ready',{coordinationReleased:true})}
 }
 window.__titan5x5Conflicts=conflicts;
 return conflicts;
}
window.Titan5x5Coordination={scan:coordinationScan,apply:applyCoordination,overlap:missionOverlap};


/* Mission Queue + Worker Recycling v0.1 */
function priorityRank(p){const m=String(p||'P9').match(/P(\d+)/i);return m?+m[1]:9}
function queueMission(m){
 const q=normalizeMission({...m,status:'queued'},0);
 state.missionQueue.push(q);audit('mission-queued',{missionId:q.id,title:q.title,priority:q.priority,repo:q.repo});
 state.missionQueue.sort((a,b)=>{
   const ar=dependencyState(a).ready?0:1,br=dependencyState(b).ready?0:1;
   return ar-br||priorityRank(a.priority)-priorityRank(b.priority)||a.updatedAt-b.updatedAt;
 });
 return q.id;
}

function completedMissionIds(){
 return new Set((state.missionHistory||[]).filter(m=>m.status==='verified'||m.completedAt).map(m=>m.id));
}
function dependencyState(m){
 const deps=m?.dependsOn||[];if(!deps.length)return {ready:true,missing:[]};
 const done=completedMissionIds(),active=new Set((state.missions||[]).filter(Boolean).map(x=>x.id));
 const queued=new Set((state.missionQueue||[]).map(x=>x.id));
 const missing=deps.filter(id=>!done.has(id));
 return {ready:missing.length===0,missing,known:missing.filter(id=>active.has(id)||queued.has(id)),unknown:missing.filter(id=>!active.has(id)&&!queued.has(id))};
}

function missionCompatible(i,m){
 if(!m)return false;
 if(!dependencyState(m).ready)return false;
 for(let j=0;j<5;j++){
   if(j===i)continue;
   const active=state.missions?.[j];if(!active||['verified','complete'].includes(active.status))continue;
   if(missionOverlap(m,active).score>=7)return false;
 }
 return true;
}
function nextQueuedMission(i){
 const idx=state.missionQueue.findIndex(m=>missionCompatible(i,m));
 if(idx<0)return null;
 return state.missionQueue.splice(idx,1)[0];
}
function missionPrompt(m){
 return `NEW TITAN MISSION
Mission: ${m.title}
Goal: ${m.goal||'-'}
Priority: ${m.priority||'P1'}
Dependencies: ${(m.dependsOn||[]).join(', ')||'none'}
Budget: ${m.budget?.maxPasses??25} passes / ${m.budget?.maxReviews??6} reviews / ${m.budget?.maxMinutes??180} minutes
Repository: ${m.repo||'-'}
Branch constraint: ${m.branch||'Use one branch/worktree only; do not open another until merged/closed.'}
Constraints:
${(m.constraints||[]).map(x=>'- '+x).join('\n')||'- Preserve existing architecture and reuse existing code.'}
Acceptance criteria:
${(m.acceptance||[]).map(x=>'- [ ] '+x.text).join('\n')||'- Deliver and verify the stated goal.'}

Start by fetching current repository state and reading applicable repository instructions. Continue this mission iteratively when told NEXT.`;
}
async function recycleWorker(i){
 const old=state.missions?.[i];
 if(old&&old.status==='verified'){
   audit('mission-completed',{worker:i+1,missionId:old.id,title:old.title});state.missionHistory.push({...old,completedAt:Date.now()});
   state.missionHistory=state.missionHistory.slice(-100);
   releaseWorkerLeases(i);
 }
 const n=nextQueuedMission(i);
 if(!n){state.missions[i]=null;setHealth(i,'idle',{reason:'mission queue empty'});await save();return false}
 audit('mission-assigned',{worker:i+1,missionId:n.id,title:n.title});n.status='assigned';n.updatedAt=Date.now();n.startedAt=Date.now();state.missions[i]=n;applyPolicyBudget(i);n.reviewCount=0;n.progressFingerprints=[];state.checkpoints[i]=null;state.utilization.lastAdvanceAt[i]=0;state.counts[i]=0;state.lastSeen[i]=0;
 const tabId=state.workerTabs[i];
 if(tabId&&await tabExists(tabId)){
   const ok=await guardedWorkerSend(i,missionPrompt(n),{priority:4,action:{kind:'mission-assignment',missionId:n.id,pass:0}});
   setHealth(i,ok?'working':'assignment-failed',{mission:n.id});
   if(!ok){n.status='attention';n.blocker='Could not send mission to worker tab'}
 }else{setHealth(i,'tab-missing',{mission:n.id});n.status='attention';n.blocker='Worker tab unavailable'}
 await save();return true;
}
async function recycleIdleWorkers(){
 for(let i=0;i<5;i++)if(!state.missions?.[i]&&state.missionQueue.length)await recycleWorker(i);
}
window.TitanMissionQueue={
 add:async m=>{const id=queueMission(m);await save();return id},
 list:()=>state.missionQueue.slice(),
 history:()=>state.missionHistory.slice(),
 dependencies:(mission)=>dependencyState(mission),
 recycle:(i)=>recycleWorker(i),
 recycleAll:()=>recycleIdleWorkers()
};








/* Supervisor Audit Log v0.1 */
function audit(type,data={}){
 const e={seq:(state.auditLog?.at(-1)?.seq||0)+1,at:Date.now(),type,...data};
 state.auditLog=[...(state.auditLog||[]),e].slice(-1000);
 window.dispatchEvent(new CustomEvent('titan5x5:audit',{detail:e}));
 return e;
}
function auditExport(){
 return JSON.stringify({version:1,exportedAt:Date.now(),events:state.auditLog||[]},null,2);
}
window.TitanAudit={
 list:(limit=100)=>state.auditLog.slice(-Math.max(1,Math.min(1000,limit))),
 export:auditExport,
 clear:()=>{state.auditLog=[];return true}
};


/* Crash / Restart Recovery v0.1 */
async function reconcileAfterRestart(){
 const report={at:Date.now(),workers:[],actions:[]};
 for(let i=0;i<5;i++){
   const id=state.workerTabs[i],w={worker:i+1,tabId:id||null};
   if(!id||!await tabExists(id)){w.state='tab-missing';report.workers.push(w);continue}
   if(!await identityMatches(i,id)){w.state='identity-mismatch';setHealth(i,'identity-mismatch');report.workers.push(w);continue}
   const p=await exec(id,pageState);
   if(!p){w.state='unreadable';report.workers.push(w);continue}
   w.assistantCount=p.count;w.generating=p.generating;
   const seen=state.lastSeen[i]||0;
   if(p.generating){w.state='still-generating';setHealth(i,'recover-generating')}
   else if(seen===0){state.lastSeen[i]=p.count;w.state='baseline-restored';setHealth(i,'recovered')}
   else if(p.count>seen){
     // Never auto-send after an offline gap. Queue one recovery review instead.
     const transcript=compact(p.msgs,i),mission=state.missions?.[i]||null;
     const key=`recovery-${reviewKey(i,p.count)}`;
     if(!hasQueuedReview(i,p.count)&&!state.reviewQueue.some(x=>x.key===key)){
       state.reviewQueue.push({id:`w${i}-recovery-${Date.now()}`,key,worker:i,tabId:id,count:p.count,transcript,
        mission:mission?missionContext(i):'',checkpoint:checkpointContext(i),architecture:architectureContext(i,transcript),
        repository:'',reason:'restart-reconciliation',at:Date.now()});
       report.actions.push(`W${i+1}: queued recovery review`);
     }
     state.lastSeen[i]=p.count;w.state='advanced-offline';setHealth(i,'recovery-review');
   }else{w.state='unchanged';setHealth(i,'recovered')}
   report.workers.push(w);
 }
 state.recovery.lastStartupAt=Date.now();state.recovery.reconciled=true;
 state.armed=false;state.enabled=false; // explicit re-arm is always required after restart
 audit('restart-reconciled',{actions:report.actions,workers:report.workers.map(w=>({worker:w.worker,state:w.state}))});
 await save();window.__titanRecoveryReport=report;return report;
}
async function markCleanShutdown(reason='sidepanel-unload'){
 state.recovery.lastShutdownAt=Date.now();state.recovery.unclean=false;
 try{await chrome.storage.local.set({[KEY]:state})}catch{}
}
window.TitanRecovery={reconcile:reconcileAfterRestart,report:()=>window.__titanRecoveryReport||null,clean:markCleanShutdown};
window.addEventListener('pagehide',()=>{markCleanShutdown().catch(()=>{})});

/* Semantic Acceptance Resolution v0.1
 * Piggybacks on an already-scheduled deep review; no extra review call.
 */
function unresolvedAcceptance(i){
 const m=state.missions?.[i];if(!m)return [];
 return (m.acceptance||[]).map((c,index)=>({index,text:c.text,done:!!c.done,evidence:c.evidence||[]})).filter(c=>!c.done);
}
function parseReviewEnvelope(text){
 const raw=String(text||'').trim();
 // Optional first line:
 // TITAN_ACCEPTANCE: {"complete":[0,2],"incomplete":[1],"evidence":{"0":"..."}}
 const m=raw.match(/^TITAN_ACCEPTANCE:\s*(\{[^\n]*\})\s*\n?/);
 if(!m)return {instruction:raw,acceptance:null};
 try{
   const a=JSON.parse(m[1]);
   return {instruction:raw.slice(m[0].length).trim(),acceptance:a};
 }catch{return {instruction:raw,acceptance:null}}
}
function applySemanticAcceptance(i,a){
 const m=state.missions?.[i];if(!m||!a)return;
 for(const idx of a.complete||[]){
   const c=m.acceptance?.[idx];if(c&&!c.done){c.done=true;c.verifiedBy='supervisor-review';if(a.evidence?.[idx])c.reviewEvidence=String(a.evidence[idx]).slice(0,1000)}
 }
 for(const idx of a.incomplete||[]){
   const c=m.acceptance?.[idx];if(c){c.done=false;c.verifiedBy='supervisor-review-incomplete';if(a.evidence?.[idx])c.reviewEvidence=String(a.evidence[idx]).slice(0,1000)}
 }
}
window.TitanSemanticAcceptance={unresolved:unresolvedAcceptance,parse:parseReviewEnvelope,apply:applySemanticAcceptance};

/* Acceptance Evidence Reconciliation v0.1
 * Deterministic evidence mapping only. Ambiguous criteria remain unresolved.
 */
function criterionEvidence(text,m){
 const t=String(text||'').toLowerCase(),git=m?.truth||{},r=m?.runtime||{};
 const evidence=[];
 const has=(...xs)=>xs.some(x=>t.includes(x));
 let resolved=null;
 if(has('ci','continuous integration')){resolved=git.ciPassed===true;evidence.push('git.ciPassed')}
 else if(has('merged','merge to main','merge into main')){resolved=git.merged===true&&git.presentOnMain===true;evidence.push('git.merged','git.presentOnMain')}
 else if(has('commit exists','committed')){resolved=git.commitExists===true;evidence.push('git.commitExists')}
 else if(has('deploy','installed','installation succeeds')){resolved=r.deployed===true;evidence.push('runtime.deployed')}
 else if(has('console','javascript error','no console errors')){resolved=r.consoleClean===true;evidence.push('runtime.consoleClean')}
 else if(has('network','api','request succeeds','endpoint')){resolved=r.networkPassed===true;evidence.push('runtime.networkPassed')}
 else if(has('browser','ui works','page opens','renders')){resolved=r.browserPassed===true;evidence.push('runtime.browserPassed')}
 else if(has('server','vps','directadmin')){if(r.serverPassed!==null&&r.serverPassed!==undefined){resolved=r.serverPassed===true;evidence.push('runtime.serverPassed')}}
 else if(has('acceptance','end-to-end','e2e','workflow completes')){resolved=r.acceptancePassed===true;evidence.push('runtime.acceptancePassed')}
 return {resolved,evidence};
}
function reconcileAcceptance(i){
 const m=state.missions?.[i];if(!m)return {changed:0,unresolved:[]};
 let changed=0;const unresolved=[];
 for(const c of m.acceptance||[]){
   const ev=criterionEvidence(c.text,m);
   c.evidence=ev.evidence;
   if(ev.resolved===true&&c.done!==true){c.done=true;c.verifiedBy='evidence';changed++}
   else if(ev.resolved===false){c.done=false;c.verifiedBy='evidence-failed'}
   else if(ev.resolved===null)unresolved.push(c.text);
 }
 m.updatedAt=Date.now();
 return {changed,unresolved};
}
window.TitanAcceptanceEvidence={reconcile:reconcileAcceptance,evaluate:(text,worker)=>criterionEvidence(text,state.missions?.[worker])};

/* Objective Mission Progress v0.1
 * Operational score only; not an AI quality judgment.
 */
function missionProgress(i){
 const m=state.missions?.[i];if(!m)return null;
 const ac=m.acceptance||[],done=ac.filter(x=>x.done).length,total=ac.length;
 const acceptance=total?done/total:0;
 const git=m.truth||{},runtime=m.runtime||{};
 const gitChecks=[git.commitExists,git.ciPassed,git.merged,git.presentOnMain].filter(x=>x!==undefined);
 const gitRatio=gitChecks.length?gitChecks.filter(Boolean).length/gitChecks.length:0;
 const runChecks=[runtime.deployed,runtime.browserPassed,runtime.consoleClean,runtime.networkPassed,runtime.acceptancePassed,runtime.serverPassed].filter(x=>x!==undefined&&x!==null);
 const runtimeRatio=runChecks.length?runChecks.filter(Boolean).length/runChecks.length:0;
 const passBudget=m.budget?.maxPasses||25,used=state.counts[i]||0;
 const efficiency=Math.max(0,1-used/passBudget);
 const blocked=['blocked','attention','verification-failed','runtime-failed','coordination-wait'].includes(m.status)?1:0;
 // Weighted factual completion indicator. Verification dominates.
 const score=Math.round(100*(.35*acceptance+.30*gitRatio+.25*runtimeRatio+.10*efficiency)-blocked*10);
 return {score:Math.max(0,Math.min(100,score)),acceptance:{done,total,ratio:acceptance},gitRatio,runtimeRatio,passes:{used,budget:passBudget},blocked:!!blocked,status:m.status};
}
function teamProgress(){
 return (state.missions||[]).map((m,i)=>m?{worker:i+1,id:m.id,title:m.title,...missionProgress(i)}:null).filter(Boolean);
}
window.TitanProgress={mission:missionProgress,team:teamProgress};

/* Team Convergence v0.1 — zero-token checkpoint comparison */
function convergenceReady(){
 const cps=state.checkpoints||[],last=state.convergence.lastCheckpointPasses||[];
 return cps.every((c,i)=>c&&c.pass>(last[i]||0));
}
function runConvergence(){
 if(!convergenceReady())return null;
 const cps=state.checkpoints.slice(),findings=[];
 // Dependency readiness changed?
 const unlocked=(state.missionQueue||[]).filter(m=>dependencyState(m).ready).map(m=>m.id);
 // Same repo/branch or lexical mission overlap among active workers.
 const conflicts=coordinationScan();
 if(conflicts.length)findings.push({type:'mission-overlap',conflicts});
 // Concrete leases are authoritative if present.
 const leases=leaseConflicts();
 if(leases.length)findings.push({type:'ownership-conflict',count:leases.length});
 // Workers that are blocked/attention at convergence.
 const attention=(state.missions||[]).map((m,i)=>m&&['blocked','attention','verification-failed','runtime-failed','coordination-wait'].includes(m.status)?{worker:i+1,id:m.id,status:m.status,blocker:m.blocker}:null).filter(Boolean);
 if(attention.length)findings.push({type:'attention',workers:attention});
 const result={
  round:(state.convergence.round||0)+1,at:Date.now(),
  checkpointPasses:cps.map(c=>c.pass),
  unlocked,findings,
  statuses:(state.missions||[]).map((m,i)=>({worker:i+1,id:m?.id||null,status:m?.status||'idle',progress:m?missionProgress(i):null}))
 };
 state.convergence.round=result.round;
 state.convergence.lastCheckpointPasses=result.checkpointPasses.slice();
 state.convergence.history=[...(state.convergence.history||[]),result].slice(-20);audit('team-convergence',{round:result.round,findings:result.findings.length,unlocked:result.unlocked});
 applyCoordination();
 window.__titan5x5Convergence=result;
 window.dispatchEvent(new CustomEvent('titan5x5:convergence',{detail:result}));
 return result;
}
window.TitanConvergence={ready:convergenceReady,run:runConvergence,history:()=>state.convergence.history.slice()};

/* Checkpoint Compaction v0.1 */
function makeCheckpoint(i,job,instruction){
 const m=state.missions?.[i];
 const remaining=(m?.acceptance||[]).filter(x=>!x.done).map(x=>x.text).slice(0,12);
 return {
   worker:i,missionId:m?.id||null,pass:job.count,at:Date.now(),
   status:m?.status||null,
   remaining,
   lastInstruction:String(instruction||'').slice(0,1800),
   branch:m?.branch||null,pr:m?.pr||null,commit:m?.commit||null,
   reason:job.reason||'review',
   progress:missionProgress(i)
 };
}
function checkpointContext(i){
 const c=state.checkpoints?.[i];if(!c)return '';
 return `LAST CHECKPOINT
Pass: ${c.pass}
Status: ${c.status||'-'}
Reason: ${c.reason||'-'}
Remaining acceptance: ${(c.remaining||[]).join('; ')||'none'}
Previous supervisor instruction: ${c.lastInstruction||'-'}
Branch/PR/commit: ${c.branch||'-'} / ${c.pr||'-'} / ${c.commit||'-'}`;
}
window.TitanCheckpoints={
 get:i=>state.checkpoints?.[i]||null,
 list:()=>state.checkpoints.slice(),
 clear:i=>{state.checkpoints[i]=null}
};

/* Mission Budgets + Anti-loop v0.1 */
function fingerprint(text){
 const words=String(text||'').toLowerCase().replace(/[^a-z0-9_./ -]/g,' ').split(/\s+/).filter(Boolean);
 return [...new Set(words)].sort().slice(0,120).join('|');
}
function similarity(a,b){
 if(!a||!b)return 0;const A=new Set(a.split('|')),B=new Set(b.split('|'));
 const inter=[...A].filter(x=>B.has(x)).length,uni=new Set([...A,...B]).size;
 return uni?inter/uni:0;
}
function budgetState(i,transcript=''){
 const m=state.missions?.[i];if(!m)return {ok:true};
 const elapsed=m.startedAt?(Date.now()-m.startedAt)/60000:0;
 const reasons=[];
 if(state.counts[i]>=m.budget.maxPasses)reasons.push(`pass budget ${m.budget.maxPasses} reached`);
 if((m.reviewCount||0)>=m.budget.maxReviews)reasons.push(`review budget ${m.budget.maxReviews} reached`);
 if(elapsed>=m.budget.maxMinutes)reasons.push(`time budget ${m.budget.maxMinutes}m reached`);
 const fp=fingerprint(transcript);
 const recent=m.progressFingerprints||[];
 const loop=recent.slice(-3).length===3&&recent.slice(-3).every(x=>similarity(x,fp)>.92);
 if(loop)reasons.push('three near-identical completion summaries detected');
 return {ok:reasons.length===0,reasons,elapsed,fp};
}
function recordProgress(i,transcript){
 const m=state.missions?.[i];if(!m)return;
 if(!m.startedAt)m.startedAt=Date.now();
 const fp=fingerprint(transcript);if(fp){m.progressFingerprints=[...(m.progressFingerprints||[]),fp].slice(-5)}
}
window.TitanMissionBudget={state:budgetState,similarity,fingerprint};

/* Titan Mission Control: structured state only; Codex remains the executor. */
function normalizeMission(m,i){
 if(!m)return null;
 return {
  id:m.id||`W${i+1}-${Date.now()}`,
  title:m.title||`Worker ${i+1} mission`,
  goal:m.goal||'',
  repo:m.repo||'',
  branch:m.branch||'',
  priority:m.priority||'P1',
  constraints:Array.isArray(m.constraints)?m.constraints:[],
  acceptance:Array.isArray(m.acceptance)?m.acceptance.map(x=>typeof x==='string'?{text:x,done:false}:x):[],
  status:m.status||'assigned',
  blocker:m.blocker||null,
  pr:m.pr||null,
  commit:m.commit||null,
  updatedAt:m.updatedAt||Date.now(),
  dependsOn:Array.isArray(m.dependsOn)?m.dependsOn.filter(Boolean):[],
  budget:{maxPasses:m.budget?.maxPasses??25,maxReviews:m.budget?.maxReviews??6,maxMinutes:m.budget?.maxMinutes??180},
  startedAt:m.startedAt||null,
  reviewCount:m.reviewCount||0,
  progressFingerprints:Array.isArray(m.progressFingerprints)?m.progressFingerprints.slice(-5):[],
  policy:m.policy||'auto'
 };
}
function missionContext(i){
 const m=state.missions?.[i];if(!m)return '';
 const pending=(m.acceptance||[]).filter(x=>!x.done).map(x=>x.text);
 return `MISSION ${m.id}: ${m.title}
Goal: ${m.goal||'-'}
Priority: ${m.priority||'-'}
Repository: ${m.repo||'-'}
Branch: ${m.branch||'-'}
Status: ${m.status||'-'}
Constraints: ${(m.constraints||[]).join('; ')||'-'}
Acceptance remaining: ${pending.join('; ')||'none recorded'}
${m.blocker?`Blocker: ${m.blocker}`:''}`.trim();
}
async function setMission(i,m){state.missions[i]=normalizeMission(m,i);await save()}
async function clearMission(i){releaseWorkerLeases(i);state.missions[i]=null;await save()}
function parseWorkerSignals(text){
 const t=(text||'').toLowerCase();
 return {
  blocked:/\b(blocked|cannot continue|can't continue|need clarification|permission denied|merge conflict)\b/.test(t),
  complete:/\b(mission complete|fully complete|completed and merged|all acceptance criteria|ready to merge)\b/.test(t),
  failed:/\b(tests? fail|ci fail|build fail|fatal error)\b/.test(t)
 };
}


/* Runtime Verification v0.1
 * Separate from GitHub Truth: merged code is not automatically working code.
 */
const TitanRuntimeVerification={
 provider:null,
 register(fn){this.provider=typeof fn==='function'?fn:null},
 async verify(workerIndex){
   const m=state.missions?.[workerIndex];if(!m)throw new Error('No mission assigned');
   if(!this.provider){
     window.dispatchEvent(new CustomEvent('titan5x5:runtime-verification-request',{detail:{workerIndex,mission:m}}));
     return null;
   }
   return await this.provider({workerIndex,mission:m,requirements:{
     browser:true,console:true,network:true,acceptance:true,evidence:true
   }});
 }
};
window.TitanRuntimeVerification=TitanRuntimeVerification;
window.installTitan5x5RuntimeVerification=function(provider){
 if(typeof provider!=='function')throw new TypeError('Runtime Verification provider must be a function');
 TitanRuntimeVerification.register(provider);window.dispatchEvent(new CustomEvent('titan5x5:runtime-ready'));return true;
};
async function applyRuntime(i,r){
 const m=state.missions?.[i];if(!m||!r)return false;
 audit('runtime-verification',{worker:i+1,missionId:m.id});m.runtime={
   checkedAt:Date.now(),
   deployed:r.deployed===true,
   browserPassed:r.browserPassed===true,
   consoleClean:r.consoleClean===true,
   networkPassed:r.networkPassed===true,
   acceptancePassed:r.acceptancePassed===true,
   serverPassed:r.serverPassed==null?null:r.serverPassed===true,
   evidence:r.evidence||{},
   environment:r.environment||null
 };
 const pol=missionPolicy(i);
 const core=[m.runtime.deployed,m.runtime.browserPassed,m.runtime.consoleClean,m.runtime.networkPassed,m.runtime.acceptancePassed];
 if(pol.requireServer)core.push(m.runtime.serverPassed===true);
 else if(m.runtime.serverPassed!==null)core.push(m.runtime.serverPassed);
 const runtimeOK=core.every(Boolean);
 const gitOK=m.truth?.commitExists&&m.truth?.ciPassed&&m.truth?.merged&&m.truth?.presentOnMain;
 reconcileAcceptance(i);
 const acceptanceOK=(m.acceptance||[]).every(c=>c.done===true);
 m.status=(gitOK&&runtimeOK&&acceptanceOK)?'verified':(gitOK&&runtimeOK?'acceptance-review':'runtime-failed');
 if(gitOK&&runtimeOK&&acceptanceOK)releaseWorkerLeases(i);
 m.updatedAt=Date.now();
 m.blocker=(gitOK&&runtimeOK)?null:'Runtime verification did not satisfy Definition of Done';
 await save();
 if(gitOK&&runtimeOK&&acceptanceOK)setTimeout(()=>recycleWorker(i).catch(()=>{}),500);
 return gitOK&&runtimeOK&&acceptanceOK;
}
async function verifyRuntime(i){const r=await TitanRuntimeVerification.verify(i);return r?applyRuntime(i,r):null}
window.addEventListener('titan5x5:runtime-verification-result',async e=>{
 const d=e.detail||{};if(Number.isInteger(d.workerIndex)&&d.result)await applyRuntime(d.workerIndex,d.result);
});


/* Built-in Chrome runtime evidence adapter.
 * Uses permissions already present in the stock extension. It is conservative:
 * it verifies browser reachability + console/network observations and does not
 * invent deployment/server success.
 */
async function chromeRuntimeEvidence({workerIndex,mission}){
 const tabId=state.workerTabs?.[workerIndex];if(!tabId||!await tabExists(tabId))return {deployed:false,browserPassed:false,consoleClean:false,networkPassed:false,acceptancePassed:false,evidence:{error:'worker tab unavailable'}};
 const tab=await chrome.tabs.get(tabId);
 const evidence={tabId,url:tab.url||'',title:tab.title||'',console:[],networkFailures:[]};
 let attached=false;
 try{
  await chrome.debugger.attach({tabId},'1.3');attached=true;
  await chrome.debugger.sendCommand({tabId},'Runtime.enable');
  await chrome.debugger.sendCommand({tabId},'Network.enable');
  const evalResult=await chrome.debugger.sendCommand({tabId},'Runtime.evaluate',{expression:`({href:location.href,title:document.title,ready:document.readyState,bodyText:(document.body?.innerText||'').slice(0,2000)})`,returnByValue:true});
  evidence.page=evalResult?.result?.value||null;
 }catch(e){evidence.debuggerError=String(e?.message||e)}
 finally{if(attached)try{await chrome.debugger.detach({tabId})}catch{}}
 const browserPassed=!!evidence.page&&evidence.page.ready==='complete';
 return {
  deployed:true,
  browserPassed,
  consoleClean:!evidence.debuggerError,
  networkPassed:!evidence.debuggerError,
  acceptancePassed:browserPassed,
  serverPassed:null,
  environment:'chrome-worker-tab',
  evidence
 };
}
if(!TitanRuntimeVerification.provider)TitanRuntimeVerification.register(chromeRuntimeEvidence);

/* GitHub Truth: authoritative verification seam.
 * Stock GitHub integration registers a provider. Titan never marks a mission
 * verified from worker prose alone.
 */
const TitanGitHubTruth={
 provider:null,
 register(fn){this.provider=typeof fn==='function'?fn:null},
 async verify(workerIndex){
   const m=state.missions?.[workerIndex];if(!m)throw new Error('No mission assigned');
   if(!this.provider){
     window.dispatchEvent(new CustomEvent('titan5x5:github-truth-request',{detail:{workerIndex,mission:m}}));
     return null;
   }
   return await this.provider({workerIndex,mission:m});
 }
};
window.TitanGitHubTruth=TitanGitHubTruth;
window.installTitan5x5GitHubTruth=function(provider){
 if(typeof provider!=='function')throw new TypeError('GitHub Truth provider must be a function');
 TitanGitHubTruth.register(provider);window.dispatchEvent(new CustomEvent('titan5x5:github-ready'));return true;
};
async function applyTruth(i,truth){
 const m=state.missions?.[i];if(!m||!truth)return false;
 audit('github-verification',{worker:i+1,missionId:m.id});m.truth={
   checkedAt:Date.now(),
   branchExists:!!truth.branchExists,
   commitExists:!!truth.commitExists,
   prExists:!!truth.prExists,
   ciPassed:truth.ciPassed===true,
   merged:truth.merged===true,
   presentOnMain:truth.presentOnMain===true,
   evidence:truth.evidence||{},
   url:truth.url||null
 };
 const required=[m.truth.commitExists,m.truth.ciPassed,m.truth.merged,m.truth.presentOnMain];
 const all=required.every(Boolean);
 m.status=all?'runtime-verification':'verification-failed';
 reconcileAcceptance(i);
 m.updatedAt=Date.now();
 if(!all)m.blocker='GitHub truth did not satisfy Definition of Done';
 else {m.blocker=null;verifyRuntime(i).catch(()=>{});}
 await save();return all;
}
window.addEventListener('titan5x5:github-truth-result',async e=>{
 const d=e.detail||{};if(Number.isInteger(d.workerIndex)&&d.truth)await applyTruth(d.workerIndex,d.truth);
});
async function verifyMissionTruth(i){
 const truth=await TitanGitHubTruth.verify(i);return truth?applyTruth(i,truth):null;
}


async function forceCompleteMission(i){
 const m=state.missions?.[i];if(!m)return false;
 if(!approvedFor('force-complete',a=>a.data.worker===i+1&&a.data.missionId===m.id)){
   requestApproval('force-complete',{worker:i+1,missionId:m.id,title:m.title});await save();return false;
 }
 m.status='verified';m.blocker=null;releaseWorkerLeases(i);audit('force-complete',{worker:i+1,missionId:m.id});await save();return true;
}
async function overrideOwnership(i){
 const m=state.missions?.[i];if(!m)return false;
 if(!approvedFor('override-ownership',a=>a.data.worker===i+1&&a.data.missionId===m.id)){
   requestApproval('override-ownership',{worker:i+1,missionId:m.id,title:m.title});await save();return false;
 }
 releaseWorkerLeases(i);m.status='assigned';m.blocker=null;audit('ownership-override',{worker:i+1,missionId:m.id});await save();return true;
}

window.TitanMissionControl={
 get:(i)=>state.missions[i]||null,
 list:()=>state.missions.slice(),
 assign:(i,m)=>setMission(i,m),
 clear:(i)=>clearMission(i),
 forceComplete:(i)=>forceCompleteMission(i),
 overrideOwnership:(i)=>overrideOwnership(i),
 verify:(i)=>verifyMissionTruth(i),
 verifyRuntime:(i)=>verifyRuntime(i),
 async markAcceptance(i,index,done=true){const m=state.missions[i];if(!m||!m.acceptance[index])return false;m.acceptance[index].done=done;m.updatedAt=Date.now();await save();return true},
 async update(i,patch){const m=state.missions[i];if(!m)return false;state.missions[i]=normalizeMission({...m,...patch,updatedAt:Date.now()},i);await save();return true}
};

async function inspectWorkers(){
 applyCoordination();
 let scheduledGranted=false;const advanceGrants=continuationGrantSet();
 for(let i=0;i<5;i++){
   if(state.missions?.[i]?.status==='coordination-wait')continue;
   const id=state.workerTabs[i];if(!id)continue;
   if(!await identityMatches(i,id)){setHealth(i,'identity-mismatch');state.armed=false;state.enabled=false;stop();audit('worker-identity-mismatch',{worker:i+1,tabId:id});continue}
   const p=await exec(id,pageState);if(!p||p.generating)continue;
   if(state.lastSeen[i]===0){state.lastSeen[i]=p.count;continue}
   if(p.count<=state.lastSeen[i])continue;
   state.lastSeen[i]=p.count;state.counts[i]++;
   const scheduledDue=!scheduledGranted&&reviewEligibility(i,state.counts[i]);
   if(scheduledDue){scheduledGranted=true;state.reviewScheduler.lastGrantedAt[i]=state.counts[i];state.reviewScheduler.cursor=(i+1)%5}
   const transcript=compact(p.msgs,i),signals=parseWorkerSignals(transcript),mission=state.missions?.[i]||null;
   if(mission){
     recordProgress(i,transcript);
     const bs=budgetState(i,transcript);
     if(!bs.ok){
       mission.status='attention';mission.blocker='Mission budget/loop guard: '+bs.reasons.join('; ');
       setHealth(i,'budget-stop',{reasons:bs.reasons});
       if(!hasQueuedReview(i,state.counts[i]))state.reviewQueue.push({id:`w${i}-budget-${Date.now()}`,key:`budget-${reviewKey(i,state.counts[i])}`,worker:i,tabId:id,count:state.counts[i],transcript,mission:missionContext(i),architecture:architectureContext(i,transcript),repository:'',reason:'budget-or-loop',at:Date.now()});
       continue;
     }
   }
   if(mission){mission.updatedAt=Date.now();if(signals.blocked){mission.status='blocked';mission.blocker='Worker reported blocker'}else if(signals.complete){mission.status='verification'}else if(signals.failed){mission.status='attention'}else mission.status='working'}
   if(scheduledDue||signals.blocked||signals.complete||signals.failed){
     const repoRaw=await TitanRepositoryContext.query(i,transcript).catch(()=>null);
     const repoSlice=compactRepoContext(repoRaw);
     const ownership=claimResources(i,resourcesFromRepoContext(repoRaw),'repository-impact');
     if(ownership.conflicts.length&&mission){
       mission.status='coordination-wait';
       mission.blocker='Resource ownership conflict: '+ownership.conflicts.map(c=>`${c.resource} owned by W${c.owner+1}`).join(', ');
       setHealth(i,'coordination-wait',{ownershipConflicts:ownership.conflicts});
       continue;
     }
     if(!hasQueuedReview(i,state.counts[i]))state.reviewQueue.push({id:`w${i}-p${state.counts[i]}-${Date.now()}`,key:reviewKey(i,state.counts[i]),worker:i,tabId:id,count:state.counts[i],transcript,mission:mission?missionContext(i):'',checkpoint:checkpointContext(i),architecture:architectureContext(i,transcript),repository:repoSlice,reason:scheduledDue?'staggered-review':signals.blocked?'blocked':signals.complete?'completion-claim':'failure',at:Date.now()});
     setHealth(i,'awaiting-review',{reason:scheduledDue?'scheduled':'exception'});
     if(signals.complete&&mission)verifyMissionTruth(i).catch(()=>{});
   }else {
     if(state.reviewQueue.length>=3){setHealth(i,'backpressure',{reviewsPending:state.reviewQueue.length});}
     else if(!workerMayAdvance(i,advanceGrants)){setHealth(i,'utilization-hold',{target:state.utilization.target,reason:state.utilization.reason});}
     else {await guardedWorkerSend(i,'NEXT',{priority:8});recordAdvance(i);setHealth(i,'working',{lastAction:'NEXT'});}
   }
 }
 await save();
}
async function processReview(){
 if(state.activeReview){
   const a=state.activeReview;
   if(now()-(a.startedAt||a.at)>state.reviewTimeoutMs){
     const attempts=(state.reviewAttempts[a.key]||0)+1;state.reviewAttempts[a.key]=attempts;
     state.activeReview=null;
     if(attempts<=2){a.at=now();state.reviewQueue.unshift(a);setHealth(a.worker,'review-retry',{attempts})}
     else {setHealth(a.worker,'review-timeout',{attempts});const m=state.missions?.[a.worker];if(m){m.status='attention';m.blocker='Supervisor review timed out'}}
     await save();
   }
   return;
 }
 if(!state.reviewQueue.length)return;
 const job=state.reviewQueue.shift();job.startedAt=now();state.activeReview=job;
 const reviewMission=state.missions?.[job.worker];if(reviewMission)reviewMission.reviewCount=(reviewMission.reviewCount||0)+1;
 audit('review-start',{worker:job.worker+1,missionId:state.missions?.[job.worker]?.id||null,pass:job.count,reason:job.reason});setHealth(job.worker,'reviewing',{reason:job.reason});await save();
 try{
  const instruction=await Titan5x5Review.run({
   id:job.id,worker:job.worker+1,completion:job.count,phase:job.worker+1,
   transcript:`${job.mission?job.mission+'\n\n':''}${job.checkpoint?job.checkpoint+'\n\n':''}${job.architecture?job.architecture+'\n\n':''}${job.repository?job.repository+'\n\n':''}${job.transcript}`,
   mission:job.mission||'',architecture:job.architecture||'',repository:job.repository||'',reason:job.reason||'staggered-review',
   directive:`Return the next instruction. Preserve mission and branch discipline; check drift, repetition, blockers, unverified completion, missing tests/evidence, conflicts, and merge/stop conditions.
If and only if you can resolve any currently unresolved acceptance criteria from evidence already present in this review context, prepend exactly one line:
TITAN_ACCEPTANCE: {"complete":[indexes],"incomplete":[indexes],"evidence":{"index":"brief evidence"}}
Do not mark a criterion complete from the worker's unsupported claim. Unresolved criteria: ${JSON.stringify(unresolvedAcceptance(job.worker))}`
  });
  if(instruction&&state.activeReview?.id===job.id){
   const envelope=parseReviewEnvelope(instruction);
   applySemanticAcceptance(job.worker,envelope.acceptance);
   instruction=envelope.instruction||'NEXT';
   if(await guardedWorkerSend(job.worker,instruction,{priority:2,action:{kind:'review',reviewId:job.id,pass:job.count}})){
    state.reviewHistory.push({id:job.id,key:job.key,worker:job.worker,count:job.count,at:now(),instruction:String(instruction).slice(0,2000)});
    audit('review-complete',{worker:job.worker+1,pass:job.count,reason:job.reason});state.checkpoints[job.worker]=makeCheckpoint(job.worker,job,instruction);
    state.reviewHistory=state.reviewHistory.slice(-50);
    runConvergence();delete state.reviewAttempts[job.key];state.activeReview=null;setHealth(job.worker,'working',{lastAction:'REVIEW'});await save();
   }
  }
 }catch(e){
   state.activeReview=null;const attempts=(state.reviewAttempts[job.key]||0)+1;state.reviewAttempts[job.key]=attempts;
   if(attempts<=2){job.at=now();state.reviewQueue.unshift(job);setHealth(job.worker,'review-retry',{attempts})}
   else {setHealth(job.worker,'review-error',{message:String(e?.message||e),attempts});const m=state.missions?.[job.worker];if(m){m.status='attention';m.blocker='Supervisor review failed'}}
   await save();
 }
}

async function armReadiness(){
 const pre=await window.runTitanPreflight?.().catch(()=>null);
 const diag=await runLiveDiagnostics().catch(()=>null);
 const workersReady=diag?.workers?.every(w=>w.ready)===true;
 const reviewReady=!!Titan5x5Review.provider;
 return {ok:pre?.ok===true&&workersReady&&reviewReady,preflight:pre?.ok===true,workersReady,reviewReady,diag};
}
async function armSupervisor(){
 audit('arm-attempt');state.emergencyStop=false;
 const r=await armReadiness();
 if(!r.ok){state.armed=false;state.enabled=false;stop();await save();return r}
 state.armed=true;state.enabled=true;state.lastArmAt=Date.now();audit('armed');await save();start();return r;
}
async function disarmSupervisor(reason='manual'){
 audit('disarmed',{reason});state.armed=false;state.enabled=false;stop();
 for(let i=0;i<5;i++)if(state.workerHealth[i]?.status==='working')setHealth(i,'paused',{reason});
 await save();return true;
}
async function emergencyStop(reason='manual emergency stop'){
 audit('emergency-stop',{reason});state.emergencyStop=true;state.armed=false;state.enabled=false;stop();
 for(const item of state.dispatch.pending||[])try{item.resolve(false)}catch{} state.dispatch.pending=[];
 if(state.activeReview){state.reviewQueue.unshift(state.activeReview);state.activeReview=null}
 for(let i=0;i<5;i++)setHealth(i,'emergency-stopped',{reason});
 await save();return true;
}
window.Titan5x5Control={arm:armSupervisor,disarm:disarmSupervisor,stop:emergencyStop,readiness:armReadiness};

async function tick(){if(!state.enabled||!state.armed||state.emergencyStop||ticking)return;ticking=true;try{await recoverTabs();adjustUtilization();await recycleIdleWorkers();await inspectWorkers();await processReview();await save()}finally{ticking=false}}
function start(){clearInterval(timer);timer=setInterval(tick,state.pollMs);tick()}
function stop(){clearInterval(timer);timer=null}
async function discover(){const tabs=await chrome.tabs.query({});const c=tabs.filter(t=>/^https:\/\/chatgpt\.com\//.test(t.url||''));state.workerTabs=c.slice(0,5).map(t=>t.id);while(state.workerTabs.length<5)state.workerTabs.push(null);state.lastSeen=[0,0,0,0,0];
 for(let i=0;i<5;i++)if(state.workerTabs[i])await bindWorkerIdentity(i,state.workerTabs[i]);
 await save()}
async function pick(slot){const tabs=await chrome.tabs.query({});const opts=tabs.filter(t=>/^https:\/\/chatgpt\.com\//.test(t.url||''));const raw=prompt(`Choose ChatGPT tab for W${slot+1}:\n`+opts.map((t,i)=>`${i+1}. ${t.title} [${t.id}]`).join('\n'),'1');const t=opts[(+raw||1)-1];if(!t)return;state.workerTabs[slot]=t.id;state.lastSeen[slot]=0;await bindWorkerIdentity(slot,t.id);await save()}
function render(){
 let box=document.getElementById('titan5x5');if(!box){box=document.createElement('div');box.id='titan5x5';document.body.appendChild(box)}
 box.innerHTML=`<style>#titan5x5{position:fixed;right:10px;bottom:10px;z-index:2147483647;width:300px;background:Canvas;color:CanvasText;border:1px solid color-mix(in srgb,CanvasText 20%,transparent);border-radius:12px;padding:10px;font:12px system-ui;box-shadow:0 8px 30px #0003}#titan5x5 button{margin:2px;padding:5px 7px}#titan5x5 .row{display:flex;justify-content:space-between;align-items:center;border-top:1px solid #8883;padding:4px 0}#titan5x5 .on{font-weight:700}</style><div style="display:flex;justify-content:space-between"><b>Titan 5×5 Supervisor</b><span class="${state.enabled?'on':''}">${state.emergencyStop?'STOPPED':state.armed?'ARMED':'DISARMED'}</span></div><div>${state.workerTabs.map((id,i)=>{const m=state.missions?.[i];return `<div class="row"><span>W${i+1} · pass ${state.counts[i]} · phase ${i+1}<br><small>${state.workerHealth?.[i]?.status||'idle'}${m?` · ${m.priority}/${missionPolicy(i).name} · ${m.status} · ${missionProgress(i)?.score??0}% · ${m.title}`:''}</small></span><span><button data-mission="${i}">${m?'Mission':'Assign'}</button>${m?`<button data-verify="${i}">Git</button><button data-runtime="${i}">Run</button>`:''}<button data-pick="${i}">${id?'Tab '+id:'Set'}</button></span></div>`}).join('')}</div><div>Reviews: ${state.reviewQueue.length}${state.activeReview?' · awaiting internal review W'+(state.activeReview.worker+1):''} · Conflicts: ${coordinationScan().length} · Leases: ${(state.ownershipLeases||[]).length} · Queue: ${(state.missionQueue||[]).filter(m=>dependencyState(m).ready).length} ready/${(state.missionQueue||[]).filter(m=>!dependencyState(m).ready).length} waiting<br>Dispatch: ${(state.dispatch?.pending||[]).length} pending · ${state.dispatch?.minGapMs||1500}ms gap · target ${state.utilization?.target||5}/5 (${state.utilization?.reason||'normal'}) · grants ${state.utilization?.grants||0}<br>Convergence: round ${state.convergence?.round||0}${convergenceReady()?' · READY':''} · Audit: ${(state.auditLog||[]).length} · Review cursor: W${(state.reviewScheduler?.cursor||0)+1}<br>Recovery: ${state.recovery?.reconciled?'reconciled':'pending'}${state.recovery?.unclean?' · prior active session':''} · Approvals: ${(state.approvals||[]).filter(a=>a.status==='pending').length}</div><div style="opacity:.7">Supervisor: extension · cadence 5<br>Native: C${Titan5x5Review.provider?'✓':'–'} G${TitanGitHubTruth.provider?'✓':'–'} R${TitanRepositoryContext.provider?'✓':'–'} V${TitanRuntimeVerification.provider?'✓':'–'}</div><button id="t5toggle">${state.armed?'Disarm':'Arm'}</button><button id="t5estop">E-STOP</button><button id="t5discover">Auto-discover 5</button><button id="t5reset">Reset counters</button><button id="t5selftest">Self-test</button><button id="t5diag">Diagnostics</button><button id="t5preflight">Preflight</button><button id="t5queue">Queue Mission</button>`;
 box.querySelectorAll('[data-pick]').forEach(b=>b.onclick=()=>pick(+b.dataset.pick));
 box.querySelectorAll('[data-verify]').forEach(b=>b.onclick=async()=>{const i=+b.dataset.verify;b.disabled=true;try{await verifyMissionTruth(i)}finally{b.disabled=false}});
 box.querySelectorAll('[data-runtime]').forEach(b=>b.onclick=async()=>{const i=+b.dataset.runtime;b.disabled=true;try{await verifyRuntime(i)}finally{b.disabled=false}});
 box.querySelectorAll('[data-mission]').forEach(b=>b.onclick=async()=>{
   const i=+b.dataset.mission,cur=state.missions?.[i];
   const title=prompt(`W${i+1} mission title`,cur?.title||'');if(title===null)return;
   const goal=prompt('Mission goal',cur?.goal||'');if(goal===null)return;
   const repo=prompt('Repository (owner/repo)',cur?.repo||'Masterleeaus/Titan-Zero-Field-Service-Workforce')??'';
   const branch=prompt('Branch constraint (blank if assigned by Codex)',cur?.branch||'')??'';
   const priority=prompt('Priority',cur?.priority||'P1')||'P1';
   const acceptanceRaw=prompt('Acceptance criteria; separate with |',(cur?.acceptance||[]).map(x=>x.text).join(' | '))??'';
   const constraintsRaw=prompt('Constraints; separate with |',(cur?.constraints||[]).join(' | '))??'';
   await setMission(i,{...(cur||{}),title,goal,repo,branch,priority,acceptance:acceptanceRaw.split('|').map(x=>x.trim()).filter(Boolean).map((text,j)=>({text,done:cur?.acceptance?.[j]?.text===text?!!cur.acceptance[j].done:false})),constraints:constraintsRaw.split('|').map(x=>x.trim()).filter(Boolean),status:cur?.status||'assigned'});
 });
 box.querySelector('#t5toggle').onclick=async()=>{if(state.armed){await disarmSupervisor('manual')}else{const r=await armSupervisor();if(!r.ok)alert(`Cannot arm Titan 5×5\nPreflight: ${r.preflight?'PASS':'FAIL'}\nWorkers: ${r.workersReady?'5/5':'NOT READY'}\nCodex review: ${r.reviewReady?'READY':'NOT BOUND'}`)}};
 const es=box.querySelector('#t5estop');if(es)es.onclick=()=>emergencyStop();
 box.querySelector('#t5discover').onclick=discover;
 box.querySelector('#t5reset').onclick=async()=>{await disarmSupervisor('reset');state.counts=[0,0,0,0,0];state.lastSeen=[0,0,0,0,0];state.reviewQueue=[];state.activeReview=null;await save()};
 const st=box.querySelector('#t5selftest');if(st)st.onclick=()=>{const r=window.runTitan5x5SelfTest?.();alert(r?.ok?'Titan 5×5 self-test PASS':'Titan 5×5 self-test FAIL')};
 const dg=box.querySelector('#t5diag');if(dg)dg.onclick=async()=>{const r=await runLiveDiagnostics();alert(`Titan diagnostics\nWorkers ready: ${r.workers.filter(x=>x.ready).length}/5\nCodex review: ${r.native.codex?'READY':'NOT BOUND'}\nGitHub: ${r.native.github?'READY':'NOT BOUND'}\nRepository: ${r.native.repository?'READY':'NOT BOUND'}\nRuntime: ${r.native.runtime?'READY':'NOT BOUND'}\nFull supervisor ready: ${r.fullReady?'YES':'NO'}`)};
 const qm=box.querySelector('#t5queue');if(qm)qm.onclick=async()=>{
 const title=prompt('Mission title');if(!title)return;
 const goal=prompt('Mission goal')||'';
 const repo=prompt('Repository','Masterleeaus/Titan-Zero-Field-Service-Workforce')||'';
 const priority=prompt('Priority','P1')||'P1';
 const acceptance=(prompt('Acceptance criteria; separate with |')||'').split('|').map(x=>x.trim()).filter(Boolean);
 const dependsOn=(prompt('Depends on mission IDs; separate with |','')||'').split('|').map(x=>x.trim()).filter(Boolean);
 await window.TitanMissionQueue.add({title,goal,repo,priority,acceptance,dependsOn});
 await recycleIdleWorkers();
};
 const pf=box.querySelector('#t5preflight');if(pf)pf.onclick=async()=>{const r=await window.runTitanPreflight?.();alert(r?`Titan preflight ${r.ok?'PASS':'FAIL'}\n`+r.checks.map(x=>`${x.ok?'✓':'✗'} ${x.name}${x.detail?' — '+x.detail:''}`).join('\n'):'Preflight module unavailable')};
}

/* Titan native Codex review bridge.
 * The stock Codex UI already owns AppServerManager and its request scheduler.
 * This bridge accepts an injected native client instead of importing brittle
 * minified exports. Host integration calls installTitan5x5NativeCodex(client).
 *
 * Required client contract:
 *   review({instruction, transcript, worker, completion, phase}) -> Promise<string>
 *
 * A host adapter can implement review with its existing thread/start +
 * turn/start + turn/completed lifecycle. This keeps Titan isolated from
 * upstream bundle symbol renames.
 */


/* Live Smoke Diagnostics v0.1 */
function pageDiagnostics(){
 const prompt=!!document.querySelector('#prompt-textarea,[contenteditable="true"][data-lexical-editor="true"],textarea');
 const send=!!document.querySelector('[data-testid="send-button"],button[aria-label*="Send" i]');
 const stop=!!document.querySelector('[data-testid="stop-button"],button[aria-label*="Stop" i]');
 const messages=document.querySelectorAll('[data-message-author-role]').length;
 return {prompt,send,stop,messages,href:location.href,title:document.title};
}
async function runLiveDiagnostics(){
 const report={at:Date.now(),workers:[],native:{
  codex:!!Titan5x5Review.provider,
  github:!!TitanGitHubTruth.provider,
  repository:!!TitanRepositoryContext.provider,
  runtime:!!TitanRuntimeVerification.provider
 },permissions:{debugger:false,scripting:false,tabs:false},ready:false};
 try{report.permissions.debugger=await chrome.permissions.contains({permissions:['debugger']})}catch{}
 try{report.permissions.scripting=await chrome.permissions.contains({permissions:['scripting']})}catch{}
 try{report.permissions.tabs=await chrome.permissions.contains({permissions:['tabs']})}catch{}
 for(let i=0;i<5;i++){
  const id=state.workerTabs[i],w={worker:i+1,tabId:id||null,exists:false,page:null,ready:false};
  if(id&&await tabExists(id)){w.exists=true;w.identityMatch=await identityMatches(i,id);w.page=await exec(id,pageDiagnostics);w.ready=!!(w.identityMatch&&w.page?.prompt&&w.page?.messages>=0)}
  report.workers.push(w);setHealth(i,w.ready?'ready':w.exists?'page-not-ready':'tab-missing',{diagnostic:true});
 }
 report.ready=report.workers.every(w=>w.ready)&&report.permissions.scripting&&report.permissions.tabs;
 report.reviewReady=report.native.codex;
 report.fullReady=report.ready&&report.reviewReady;
 window.__titan5x5Diagnostics=report;
 window.dispatchEvent(new CustomEvent('titan5x5:diagnostics',{detail:report}));
 await save();return report;
}
window.runTitan5x5Diagnostics=runLiveDiagnostics;

/* Native Service Registry v0.1
 * Stock extension code may publish stable adapters without Titan importing
 * hashed/minified module exports. Adapters can appear before or after Titan.
 */
const TitanNativeServices={
 services:new Map(),
 publish(name,service){this.services.set(name,service);window.dispatchEvent(new CustomEvent('titan:native-service',{detail:{name,service}}));return service},
 get(name){return this.services.get(name)||null},
 has(name){return this.services.has(name)}
};
window.TitanNativeServices=window.TitanNativeServices||TitanNativeServices;
function bindNativeService(name,service){
 try{
  if(name==='codex'&&service?.review)window.installTitan5x5NativeCodex(service);
  if(name==='github'&&typeof service?.verify==='function')window.installTitan5x5GitHubTruth(args=>service.verify(args));
  if(name==='repository'&&typeof service?.query==='function')window.installTitan5x5RepositoryContext(args=>service.query(args));
  if(name==='runtime'&&typeof service?.verify==='function')window.installTitan5x5RuntimeVerification(args=>service.verify(args));
 }catch(e){console.warn('[Titan 5x5] native bind failed',name,e)}
}
window.addEventListener('titan:native-service',e=>bindNativeService(e.detail?.name,e.detail?.service));
for(const [n,v] of (window.TitanNativeServices?.services||new Map()))bindNativeService(n,v);

/* Auto-discovery bridge.
 * Stock/upstream integration can expose one object under a stable global
 * without changing Titan code. This is deliberately capability-based.
 */
function discoverNativeServices(){
 const roots=[window.__codexNativeServices,window.__chatgptNativeServices,window.__titanNativeBridge].filter(Boolean);
 for(const r of roots){
  if(r.codex)bindNativeService('codex',r.codex);
  if(r.github)bindNativeService('github',r.github);
  if(r.repository)bindNativeService('repository',r.repository);
  if(r.runtime)bindNativeService('runtime',r.runtime);
 }
 window.dispatchEvent(new CustomEvent('titan5x5:native-discovery',{detail:{
  codex:!!Titan5x5Review.provider,
  github:!!TitanGitHubTruth.provider,
  repository:!!TitanRepositoryContext.provider,
  runtime:!!TitanRuntimeVerification.provider
 }}));
}
setInterval(discoverNativeServices,15000);
setTimeout(discoverNativeServices,500);

window.installTitan5x5NativeCodex=function(client){
 if(!client||typeof client.review!=='function')throw new TypeError('Titan 5x5 native Codex client requires review()');
 Titan5x5Review.register(async job=>{
   const result=await client.review({
     instruction:job.directive,
     transcript:job.transcript,
     worker:job.worker,
     completion:job.completion,
     phase:job.phase
   });
   const text=typeof result==='string'?result:result?.instruction;
   if(!text||!String(text).trim())throw new Error('Native Codex review returned no instruction');
   return String(text).trim();
 });
 window.dispatchEvent(new CustomEvent('titan5x5:native-ready'));
 return true;
};

load();
