import fs from "node:fs";import path from "node:path";import {spawnSync} from "node:child_process";import {fileURLToPath} from "node:url";
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,".."),repo=path.resolve(root,"..","..");
const checks=[\n ["fresh-install-upgrade",["node",path.join(root,"tests/install-upgrade-acceptance.mjs")],true],
 ["package-integrity",["node",path.join(root,"tests/package-integrity.test.js")],true],
 ["wp4-core",["node",path.join(root,"codex-sidepanel/titan-workforce/core-selftest.mjs")],true],
 ["autonomous-chat-work",["node",path.join(root,"codex-sidepanel/titan-workforce/live-chat-runtime.test.mjs")],true],
 ["control-safety",["node",path.join(root,"codex-sidepanel/titan-workforce/control-selftest.mjs")],true],
 ["scope-enforcement",["node",path.join(root,"codex-sidepanel/titan-workforce/scoped-codex-capability.test.mjs")],true],
 ["observability-replay",["node",path.join(root,"codex-sidepanel/titan-workforce/observability.test.mjs")],true]
];
const results=[];for(const [id,cmd,required] of checks){const r=spawnSync(cmd[0],cmd.slice(1),{cwd:repo,encoding:"utf8"});results.push({id,required,status:r.status===0?"PASS":"FAIL",exitCode:r.status,stdout:(r.stdout||"").slice(-4000),stderr:(r.stderr||"").slice(-4000)})}
const manifest=JSON.parse(fs.readFileSync(path.join(root,"manifest.json"),"utf8"));
const builderFile=path.join(root,"codex-sidepanel/titan-workforce/native-codex-runtime.test.mjs");
const builderAvailable=fs.existsSync(builderFile);
results.push({id:"native-codex-orchestrator",required:false,status:builderAvailable?"AVAILABLE":"PENDING_CAPABILITY",evidence:builderAvailable?"#16 native acceptance entrypoint detected":"Issue #16 has not yet supplied the native Builder/Orchestrator acceptance entrypoint"});
const mandatoryPass=results.filter(x=>x.required).every(x=>x.status==="PASS");
const certificate={schemaVersion:1,kind:"developer-workforce-acceptance-certificate",generatedAt:new Date().toISOString(),extension:{name:manifest.name,version:manifest.version,manifestVersion:manifest.manifest_version},mandatoryPass,releaseEligible:mandatoryPass&&builderAvailable,stages:results,notes:builderAvailable?[]:["Native Codex/Orchestrator stage remains pending until #16 lands; release eligibility is false until present."]};
const outDir=path.join(repo,"artifacts","acceptance");fs.mkdirSync(outDir,{recursive:true});fs.writeFileSync(path.join(outDir,"certificate.json"),JSON.stringify(certificate,null,2));
const md=["# Developer Workforce Acceptance Certificate","",`Generated: ${certificate.generatedAt}`,`Extension: ${manifest.name} v${manifest.version}`,`Mandatory stages: ${mandatoryPass?"PASS":"FAIL"}`,`Release eligible: ${certificate.releaseEligible?"YES":"NO"}`,"","| Stage | Required | Status |","|---|---:|---|",...results.map(x=>`| ${x.id} | ${x.required?"yes":"no"} | ${x.status} |`),"",...certificate.notes.map(x=>"- "+x)];fs.writeFileSync(path.join(outDir,"certificate.md"),md.join("\n")+"\n");
console.log(md.join("\n"));if(!mandatoryPass)process.exit(1);
