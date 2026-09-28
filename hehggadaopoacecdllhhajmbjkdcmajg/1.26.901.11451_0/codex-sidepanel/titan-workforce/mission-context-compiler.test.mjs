import assert from "node:assert/strict";
import {TitanMissionCompiler} from "./mission-compiler.js";
import {TitanContextCompiler} from "./context-compiler.js";

const audits=[];
const profiles={
 selectProfilesForMission(_mission,{executionClass}={}){
  const ids={chat_worker:"architecture",work_supervisor:"mission-planning",codex_builder:"refactoring-code-quality",codex_orchestrator:"final-mission-qa"};
  return{primary:{id:ids[executionClass]},secondary:[{id:"tenant-isolation"}],executionClass};
 },
 compileProfileContext(cast){return{profileIds:[cast.primary.id,...cast.secondary.map(x=>x.id)],text:"PROFILE "+cast.executionClass+" "+cast.primary.id}}
};
const compiler=new TitanMissionCompiler({profiles,audit:(type,data)=>audits.push({type,data})});

const issue={
 number:31,
 repository:"Masterleeaus/Titan-Zero-Field-Service-Workforce",
 title:"P1 tenant-safe work order compiler",
 labels:["P1","security"],
 body:[
  "## Scope",
  "- src/work-orders/**",
  "- tests/work-orders/**",
  "## Acceptance",
  "- [ ] Work order completion remains tenant scoped",
  "- [ ] Tests pass",
  "## Protected",
  "- src/auth/**",
  "## Test plan",
  "- run integration tests",
  "Depends on #30"
 ].join("\n")
};

const a=compiler.fromGitHubIssue(issue);
const b=compiler.fromGitHubIssue(issue);
assert.equal(a.id,b.id,"GitHub issue mission id must be deterministic");
assert.equal(a.id,"gh-masterleeaus-titan-zero-field-service-workforce-31");
assert.equal(a.priority,"P1");
assert.equal(a.risk,"high");
assert.deepEqual(a.scopePaths,["src/work-orders/**","tests/work-orders/**"]);
assert.deepEqual(a.protectedPaths,["src/auth/**"]);
assert(a.dependencies.includes("#30"));
assert(a.acceptanceCriteria.some(x=>x.text.includes("tenant scoped")));
assert(a.testPlan.includes("run integration tests"));
assert(a.requiredProfiles.includes("architecture"));
assert(a.requiredProfiles.includes("tenant-isolation"));
assert(a.verificationRequirements.includes("security_review"));
assert.equal(a.researchEpochLimit,15);
assert(["A","B"].includes(a.assignedSquad));

const operator=compiler.fromOperator("Improve dispatch scheduler reliability");
assert.equal(operator.provenance.source,"operator_prompt");
assert(operator.acceptanceCriteria.length>=1);

const ci=compiler.fromCIFailure({
 title:"Typecheck failure",
 repository:"repo",
 message:"typescript typecheck failed",
 scopePaths:["src/**"]
});
assert(ci.verificationRequirements.includes("ci_repair"));
assert(ci.testPlan.some(x=>x.includes("codex_builder")));

const repositoryContext={
 architecture:{entryIds:["tenancy"],text:"ARCH tenant_company_id invariant"},
 repository:{
  repository:a.repository,commit:"abc",stale:false,
  files:[{path:"src/work-orders/service.js",kinds:["gateway"],score:9}],
  symbols:["completeWorkOrder"],tests:["tests/work-orders/service.test.js"],
  edges:[{from:"tests/work-orders/service.test.js",to:"src/work-orders/service.js",type:"import"}],
  duplicates:[]
 },
 impact:{changed:["src/work-orders/service.js"],impacted:["tests/work-orders/service.test.js"],tests:["tests/work-orders/service.test.js"],edges:[]}
};
const provenance={forMission(id){return[{id:"p1",type:"mission",missionId:id,parentIds:[],at:1}]}};
const contexts=new TitanContextCompiler({
 profiles,
 contextProvider:()=>repositoryContext,
 provenance,
 audit:(type,data)=>audits.push({type,data}),
 limits:{chat_worker:5000,work_supervisor:6500,codex_builder:7000,codex_orchestrator:7500}
});

const chat=contexts.forChat(a,{checkpoint:{summary:"prior compact state"},instruction:"Inspect tenant isolation paths only.",conversationHistory:"SHOULD NOT BE INCLUDED RAW"});
assert(chat.text.includes("Specific Pass Instruction"));
assert(chat.text.includes("Latest Checkpoint"));
assert(!chat.text.includes("SHOULD NOT BE INCLUDED RAW"));
assert(chat.characters<=chat.limit);
assert.deepEqual(chat.scopePaths,a.scopePaths);

const supervisor=contexts.forSupervisor(a,{
 workerResults:[1,2,3,4,5].map(n=>({workerId:"A"+n,summary:"worker "+n+" finding"})),
 checkpoint:{summary:"supervisor prior checkpoint"}
});
assert(supervisor.text.includes("Five-Pass Worker Results"));
assert(supervisor.text.includes("worker 5 finding"));
assert(supervisor.text.includes("mission-planning"));
assert(supervisor.characters<=supervisor.limit);

const delta={delta_id:"d1",scope_paths:["src/work-orders/service.js"],tasks:[{id:"t1",instruction:"Fix tenant check"}]};
const builder=contexts.forBuilder(a,{approvedDelta:delta});
assert(builder.text.includes("Approved Implementation Delta"));
assert(builder.text.includes("Relevant Tests"));
assert(builder.text.includes("refactoring-code-quality"));
assert(builder.characters<=builder.limit);

assert.throws(()=>contexts.forBuilder(a,{approvedDelta:{delta_id:"bad",scope_paths:["src/auth/secret.js"]}}),error=>error?.code==="CONTEXT_SCOPE_EXPANSION");

const orchestrator=contexts.forOrchestrator(a,{
 deltas:[delta],
 builderResults:[{builder_id:"BUILDER_A",tests_passed:true}],
 verificationEvidence:{git:{status:"pass"},ci:{status:"pass"},runtime:{status:"pass"}}
});
assert(orchestrator.text.includes("Builder Results"));
assert(orchestrator.text.includes("Verification Evidence"));
assert(orchestrator.text.includes("final-mission-qa"));
assert(orchestrator.provenance[0].id==="p1");

const compact=contexts.forSupervisor(a,{
 limit:2500,
 workerResults:Array.from({length:5},(_,i)=>({workerId:"A"+(i+1),summary:"x".repeat(3000)}))
});
assert(compact.characters<=2500);
assert(compact.truncated===true);

assert(audits.some(x=>x.type==="mission-compiled"));
assert(audits.some(x=>x.type==="context-compiled"));

console.log("Titan Mission + Context Compiler test PASS");
