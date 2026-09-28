"use strict";
const assert=require("node:assert/strict");
const P=require("../titan-agent-profiles.js");
function test(name,fn){try{fn();console.log("ok - "+name)}catch(e){console.error("not ok - "+name);throw e}}

test("catalogue contains roughly 50 unique profiles",()=>{
  const all=P.listProfiles();
  assert.ok(all.length>=45&&all.length<=60,"expected roughly 50 profiles, got "+all.length);
  assert.equal(new Set(all.map(x=>x.id)).size,all.length);
});
test("profile lookup works by id and name",()=>{
  assert.equal(P.getProfile("architecture").name,"Architecture");
  assert.equal(P.getProfile("ExecutionGateway").id,"executiongateway");
  assert.equal(P.getProfile("missing-profile"),null);
});
test("composition supports one primary plus secondary lenses",()=>{
  const c=P.composeProfiles("crm",["tenant-isolation","security"],{executionClass:"work_supervisor"});
  assert.equal(c.primary.id,"crm");
  assert.deepEqual(c.secondary.map(x=>x.id),["tenant-isolation","security"]);
});
test("execution class compatibility is enforced",()=>{
  assert.equal(P.validateExecutionClass("directadmin","codex_builder").ok,true);
  assert.equal(P.validateExecutionClass("directadmin","chat_worker").ok,false);
  assert.throws(()=>P.composeProfiles("directadmin",[],{executionClass:"chat_worker"}),/incompatible/);
});
test("mission selection is deterministic and honors explicit overrides",()=>{
  const m={id:"M-1",title:"Harden CRM tenant isolation",goal:"Fail closed for cross-company API requests",repo:"Titan-Zero",constraints:["preserve company_id"],acceptance:["cross-company access denied","integration tests pass"]};
  const a=P.selectProfilesForMission(m,{executionClass:"work_supervisor"});
  const b=P.selectProfilesForMission(JSON.parse(JSON.stringify(m)),{executionClass:"work_supervisor"});
  assert.equal(a.primary.id,"tenant-isolation");
  assert.equal(a.primary.id,b.primary.id);
  assert.deepEqual(a.secondary.map(x=>x.id),b.secondary.map(x=>x.id));
  assert.equal(P.selectProfilesForMission({...m,primaryProfile:"crm"},{executionClass:"work_supervisor"}).primary.id,"crm");
});
test("compiled context is injection ready",()=>{
  const c=P.compileProfileContext({title:"Repair payment refund idempotency",goal:"Prevent duplicate refunds on retries",constraints:["preserve correlation and evidence"]},{executionClass:"work_supervisor"});
  assert.match(c.text,/TITAN AGENT PROFILE CONTEXT/);
  assert.match(c.text,/Primary profile: Payments/);
  assert.match(c.text,/financial_integrity_tests/);
  assert.match(c.text,/Fail closed when tenant\/company scope is unresolved/);
});
test("registry extension API registers custom profiles",()=>{
  const r=new P.AgentProfileRegistry(P.listProfiles());
  const x=r.register({id:"custom-titan-specialist",name:"Custom Titan Specialist",role:"specialist",domain:"custom",expertise:["custom"],architectureContext:["Titan"],invariants:["Preserve state ownership"],preferredExecutionClass:"chat_worker",compatibleExecutionClasses:["chat_worker"],allowedCapabilities:["read_repo"],verificationRequirements:["mission_acceptance"],outputContract:["report result"],riskPolicyHints:["minimal scope"],scopePatterns:["custom titan"]});
  assert.equal(x.id,"custom-titan-specialist");
  assert.throws(()=>r.register(x),/already registered/);
});
test("Mission Control adapter preserves original mission object",()=>{
  const m={id:"W1-123",title:"SQLite upgrade migration",goal:"Preserve legacy data",policy:"production"};
  const a=P.adaptMissionControlMission(m,{executionClass:"codex_builder"});
  assert.strictEqual(a.mission,m);
  assert.equal(a.executionClass,"codex_builder");
  assert.ok(a.primaryProfile);
  assert.match(a.compiledProfileContext,/TITAN AGENT PROFILE CONTEXT/);
});
console.log("\n"+P.listProfiles().length+" profiles loaded; all tests passed.");
