import assert from "node:assert/strict";
import {createVerificationState} from "./verification-plane.js";
import {
  TitanRuntimeVerifierRegistry,
  runtimeVerificationPlan,
  verifyMissionRuntime,
  recordMissionRuntimeGate
} from "./runtime-verifiers.js";
import {TitanCredentialBroker} from "./credential-broker.js";
import {TitanApprovalStore} from "./approvals.js";
import {TitanCapabilityBroker} from "./capability-broker.js";
import {createHighImpactAuthorizer,classifyHighImpactAction,ACTION_RISK} from "./high-impact-policy.js";

function serviceMap(entries){const m=new Map(entries);return {get:k=>m.get(k)||null}}
function state(){return {approvals:{}}}

{
  const mission={id:"m-runtime",runtimeRequirements:["browser/ui","tenant isolation","sqlite/database"]};
  assert.deepEqual(runtimeVerificationPlan(mission),["browser_ui","tenant_isolation","sqlite_database"]);
  const services=serviceMap([
    ["browser",{inspect:async()=>({passed:true,evidence:["browser:ok"]})}],
    ["runtime",{verify:async({requirement})=>({passed:true,evidence:["runtime:"+requirement]})}]
  ]);
  const result=await verifyMissionRuntime(mission,{services,registry:new TitanRuntimeVerifierRegistry()});
  assert.equal(result.status,"pass");
  assert.equal(result.results.length,3);
  assert(result.evidence.includes("browser:ok"));
  const verification=createVerificationState(mission.id);
  recordMissionRuntimeGate(verification,result);
  assert.equal(verification.gates.runtime.status,"pass");
  assert.equal(verification.status,"pending");
}

{
  const mission={id:"m-server",runtimeRequirements:["directadmin/server/plugin"]};
  const services=serviceMap([]);
  const result=await verifyMissionRuntime(mission,{services});
  assert.equal(result.status,"blocked");
  assert.equal(result.results[0].details.reason,"runtime-service-unavailable");
}

{
  const s=state();
  const approvals=new TitanApprovalStore(s);
  const broker=new TitanCredentialBroker(s,{approvalStore:approvals});
  broker.register({
    name:"deploy-token",
    capability:"server.deploy",
    scope:["deploy"],
    repository:"Masterleeaus/Titan-Zero",
    allowedExecutionClasses:["codex_builder"],
    allowedProfiles:["vps-linux"],
    approvalState:"required"
  },async(args)=>({deployed:true,target:args.target}));

  let approvalId=null;
  try{
    await broker.request("deploy-token",{
      missionId:"m1",
      repository:"Masterleeaus/Titan-Zero",
      executionClass:"codex_builder",
      profileIds:["vps-linux"],
      scope:["deploy"]
    });
    assert.fail("approval should be required");
  }catch(error){
    assert.equal(error.code,"CREDENTIAL_APPROVAL_REQUIRED");
    approvalId=error.approvalId;
  }
  assert(approvalId);
  approvals.decide(approvalId,{approved:true,actor:"human"});
  const lease=await broker.request("deploy-token",{
    missionId:"m1",
    repository:"Masterleeaus/Titan-Zero",
    executionClass:"codex_builder",
    profileIds:["vps-linux"],
    scope:["deploy"]
  });
  assert.equal(lease.credential,"deploy-token");
  assert.equal("secret" in lease,false);
  const out=await broker.execute(lease.id,{target:"test"},{missionId:"m1"});
  assert.deepEqual(out,{deployed:true,target:"test"});
  assert.equal(s.credentials["deploy-token"].secret,undefined);
  assert(s.credentialAudit.some(e=>e.type==="credential-execution-complete"));

  await assert.rejects(
    ()=>broker.request("deploy-token",{
      missionId:"m2",
      repository:"Other/Repo",
      executionClass:"codex_builder",
      profileIds:["vps-linux"],
      scope:["deploy"]
    }),
    e=>e.code==="CREDENTIAL_SCOPE_DENIED"
  );
}

{
  const s=state();
  const approvals=new TitanApprovalStore(s);
  const audit=[];
  const authorize=createHighImpactAuthorizer({approvalStore:approvals,audit:(t,d)=>audit.push({t,d})});
  const cap=new TitanCapabilityBroker({authorize});
  cap.register("repo.read",async()=>({ok:true}),{classification:"READ"});
  cap.register("git.merge",async()=>({merged:true}),{classification:"WRITE"});
  cap.register("server.deploy",async()=>({deployed:true}),{classification:"SERVER_ADMIN"});

  assert.equal(classifyHighImpactAction({name:"repo.read",classification:"READ"}).risk,ACTION_RISK.AUTOMATIC);
  assert.equal(classifyHighImpactAction({name:"git.merge",classification:"WRITE"}).risk,ACTION_RISK.APPROVAL);

  const read=await cap.call("repo.read",{},{
    missionId:"m-policy",
    allowedCapabilities:["repo.read"]
  });
  assert.equal(read.ok,true);

  let mergeApproval;
  try{
    await cap.call("git.merge",{},{
      missionId:"m-policy",
      allowedCapabilities:["git.merge"],
      executionClass:"codex_builder"
    });
    assert.fail("merge should require approval");
  }catch(error){
    assert.equal(error.code,"CAPABILITY_DENIED");
    mergeApproval=Object.values(s.approvals).find(x=>x.type.includes("merge-main"));
  }
  assert(mergeApproval);
  approvals.decide(mergeApproval.id,{approved:true,actor:"human"});
  const merged=await cap.call("git.merge",{},{
    missionId:"m-policy",
    allowedCapabilities:["git.merge"],
    executionClass:"codex_builder"
  });
  assert.equal(merged.merged,true);

  await assert.rejects(
    ()=>cap.call("server.deploy",{},{
      missionId:"m-policy",
      allowedCapabilities:["server.deploy"],
      executionClass:"codex_builder"
    }),
    e=>e.code==="CAPABILITY_DENIED"
  );
  assert(audit.some(x=>x.t==="high-impact-policy-pending"));
}

console.log("runtime/secrets/high-impact policy tests passed");
