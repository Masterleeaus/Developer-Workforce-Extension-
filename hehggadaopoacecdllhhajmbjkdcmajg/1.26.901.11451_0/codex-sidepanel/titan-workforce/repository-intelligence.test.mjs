import assert from "node:assert/strict";
import {TitanRepositoryIntelligence} from "./repository-intelligence.js";
import {TitanArchitectureIndex,TITAN_ARCHITECTURE_INDEX_VERSION} from "./architecture-index.js";

const state={};
const audit=[];
const repo=new TitanRepositoryIntelligence({state,audit:(type,data)=>audit.push({type,data})});
const repository="Masterleeaus/Titan-Zero-Field-Service-Workforce";

const first=repo.createIndex({
 repository,
 commit:"c1",
 files:[
  {path:"src/authority.js",content:'export function authorize(ctx){ return !!ctx.tenant_company_id }'},
  {path:"src/work-order-service.js",content:'import {authorize} from "./authority.js"; export function completeWorkOrder(job){ return authorize(job) }'},
  {path:"tests/work-order-service.test.js",content:'import {completeWorkOrder} from "../src/work-order-service.js"; export const testComplete=()=>completeWorkOrder({tenant_company_id:"t1"})'},
  {path:"migrations/001.sql",content:"CREATE TABLE work_orders (id TEXT PRIMARY KEY);"},
  {path:"src/duplicate-a.js",content:"export function normalizeState(x){return x}"},
  {path:"src/duplicate-b.js",content:"export function normalizeState(x){return x}"},
  {path:"directadmin/plugin.conf",content:"name=titan-workforce"}
 ]
});

assert.equal(first.repository,repository);
assert.equal(first.commit,"c1");
assert(first.edges.some(e=>e.from==="src/work-order-service.js"&&e.to==="src/authority.js"));
assert(first.edges.some(e=>e.from==="tests/work-order-service.test.js"&&e.to==="src/work-order-service.js"));
assert(first.duplicates.some(d=>d.symbol==="normalizeState"));
assert(first.files["migrations/001.sql"].tables.includes("work_orders"));
assert(first.files["directadmin/plugin.conf"].kinds.includes("plugin"));

const slice=repo.query({
 repository,
 title:"Complete work order through Authority",
 goal:"Verify work order completion and tests",
 scopePaths:["src/work-order-service.js"]
});
assert(slice.files.some(x=>x.path==="src/work-order-service.js"));
assert(slice.files.some(x=>x.path==="src/authority.js")||slice.edges.some(e=>e.to==="src/authority.js"));
assert(slice.tests.includes("tests/work-order-service.test.js"));
assert(slice.edges.length>0);

const impact=repo.impact(repository,"c1",["src/authority.js"],{depth:3});
assert(impact.impacted.includes("src/work-order-service.js"));
assert(impact.impacted.includes("tests/work-order-service.test.js"));
assert(impact.tests.includes("tests/work-order-service.test.js"));

const second=repo.applyChanges({
 repository,
 baseCommit:"c1",
 nextCommit:"c2",
 changes:[
  {path:"src/duplicate-b.js",status:"removed"},
  {path:"src/execution-gateway.js",status:"added",content:'import {completeWorkOrder} from "./work-order-service.js"; export class ExecutionGateway{}'}
 ]
});
assert.equal(second.commit,"c2");
assert(!second.files["src/duplicate-b.js"]);
assert(second.files["src/execution-gateway.js"].symbols.includes("ExecutionGateway"));
assert(!second.duplicates.some(d=>d.symbol==="normalizeState"));
assert.equal(repo.isStale(repository,"c1"),true);
assert.equal(repo.isStale(repository,"c2"),false);
assert.equal(repo.query({repository,title:"gateway work order"},{commit:"c1"}).stale,true);
assert.equal(repo.status(repository).commit,"c2");

const architecture=new TitanArchitectureIndex();
assert.equal(architecture.version,TITAN_ARCHITECTURE_INDEX_VERSION);
const directadmin=architecture.compile({title:"DirectAdmin plugin deployment",goal:"Expose server capability"});
assert(directadmin.entryIds.includes("directadmin"));
assert(directadmin.text.includes("DirectAdmin"));
const tenant=architecture.compile({title:"CRM tenant isolation",goal:"Prevent cross-company access"});
assert(tenant.entryIds.includes("tenancy"));
assert(tenant.text.includes("tenant_company_id"));

assert(audit.some(x=>x.type==="repository-index-created"));
assert(audit.some(x=>x.type==="repository-index-incremental"));
assert(state.repositoryIntelligence.latestByRepository[repository].endsWith("@c2"));

console.log("Titan Repository Intelligence test PASS");
