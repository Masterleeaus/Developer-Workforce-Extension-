import assert from "node:assert/strict";
import {TitanExecutionServices} from "./execution-services.js";
import {installStockNativeEventBridge} from "./native-bridge.js";
import {createGitHubRestService,createRepositoryRestService,createConversationCodexService,installStockServiceFallbacks} from "./stock-service-fallbacks.js";

function response(body,status=200){return {ok:status>=200&&status<300,status,async json(){return body}}}
function githubFetch(url){
 const u=new URL(url),p=u.pathname+u.search;
 if(p==="/repos/acme/titan")return Promise.resolve(response({default_branch:"main"}));
 if(p.includes("/branches/feature"))return Promise.resolve(response({commit:{sha:"abc123"}}));
 if(p.includes("/pulls?"))return Promise.resolve(response([{number:7,merged_at:"2026-09-01T00:00:00Z",html_url:"https://github.com/acme/titan/pull/7",head:{ref:"feature"}}]));
 if(p.includes("/commits/abc123/status"))return Promise.resolve(response({state:"success",statuses:[{state:"success"}]}));
 if(p.includes("/commits/abc123/check-runs"))return Promise.resolve(response({total_count:1,check_runs:[{status:"completed",conclusion:"success"}]}));
 if(p.includes("/compare/main...abc123"))return Promise.resolve(response({status:"behind"}));
 if(p.includes("/git/trees/feature?recursive=1"))return Promise.resolve(response({tree:[
  {type:"blob",path:"src/payments/refund.js",size:200},
  {type:"blob",path:"src/payments/refund.test.js",size:150},
  {type:"blob",path:"README.md",size:100}
 ]}));
 if(p.includes("/contents/src/payments/refund.js"))return Promise.resolve(response({encoding:"base64",content:Buffer.from('import {guard} from "./guard.js"; export function refundPayment(){}').toString("base64")}));
 if(p.includes("/contents/src/payments/refund.test.js"))return Promise.resolve(response({encoding:"base64",content:Buffer.from('import {refundPayment} from "./refund.js"; const refundTest = true;').toString("base64")}));
 return Promise.resolve(response({message:"not found"},404));
}

{
 const s=createGitHubRestService({fetchImpl:githubFetch});
 const result=await s.verify({mission:{repository:"acme/titan",branch:"feature"}});
 assert.equal(result.branchExists,true);
 assert.equal(result.commit,"abc123");
 assert.equal(result.prExists,true);
 assert.equal(result.ciPassed,true);
 assert.equal(result.merged,true);
 assert.equal(result.presentOnMain,true);
 assert.equal(result.source,"github-rest-fallback");
 console.log("ok - GitHub REST verification");
}
{
 const s=createRepositoryRestService({fetchImpl:githubFetch});
 const result=await s.query({mission:{repository:"acme/titan",branch:"feature",title:"Fix payment refund"},transcript:"refund payment regression"});
 assert(result.files.includes("src/payments/refund.js"));
 assert(result.tests.includes("src/payments/refund.test.js"));
 assert(result.symbols.some(x=>x.name==="refundPayment"));
 assert(result.edges.some(x=>x.to==="./guard.js"));
 console.log("ok - repository REST context");
}
{
 const slot={id:"BUILDER_A",conversation:{tabId:1,key:"https://chatgpt.com/c/abc"}};
 const registry={get:id=>id==="BUILDER_A"?slot:id==="ORCHESTRATOR"?{...slot,id:"ORCHESTRATOR"}:null};
 let observed=0,sent=0;
 const conversationService={
  async observe(){observed++;return observed===1?{assistantCount:2,generating:false,lastText:"old"}:{assistantCount:3,generating:false,lastText:'{"files_changed":["src/a.js"],"tests":[{"passed":true}]}' }},
  async send(){sent++;return {ok:true}}
 };
 const s=createConversationCodexService({registry,conversationService,pollMs:0,timeoutMs:50,sleepFn:async()=>{}});
 const result=await s.build({builderId:"BUILDER_A",packet:{packet_id:"p1",goal:"change"}});
 assert.deepEqual(result.files_changed,["src/a.js"]);
 assert.equal(sent,1);
 console.log("ok - conversation Codex build");
}
{
 const registry={get:()=>({id:"BUILDER_A",conversation:null})};
 const s=createConversationCodexService({registry,conversationService:{observe(){},send(){}}});
 await assert.rejects(()=>s.build({builderId:"BUILDER_A",packet:{}}),e=>e.code==="CODEX_CONVERSATION_UNBOUND");
 console.log("ok - Codex unbound fails closed");
}
{
 const services=new TitanExecutionServices();
 const registry={get:id=>({id,conversation:{tabId:1,key:"x"}})};
 const conversationService={observe:async()=>({assistantCount:0,generating:false,lastText:""}),send:async()=>({ok:true})};
 const result=installStockServiceFallbacks(services,{registry,conversationService,fetchImpl:githubFetch});
 assert.deepEqual(result.installed.sort(),["codex","github","repository"]);
 assert.equal(services.get("codex").source,"conversation-fallback");
 assert.equal(services.get("github").source,"github-rest-fallback");
 console.log("ok - fallback installation");
}
{
 const services=new TitanExecutionServices();
 services.register("codex",{source:"conversation-fallback",capabilities:["build"],build:async()=>({})});
 const target=new EventTarget();
 const events=[];
 installStockNativeEventBridge(services,(type,data)=>events.push({type,data}),target);
 const native={source:"stock-native",capabilities:["build"],build:async()=>({native:true})};
 const EventCtor=globalThis.CustomEvent||class extends Event{constructor(type,opts={}){super(type);this.detail=opts.detail}};
 target.dispatchEvent(new EventCtor("titan:stock-native-service",{detail:{kind:"codex",service:native}}));
 assert.equal(services.get("codex").source,"stock-native");
 assert(events.some(x=>x.type==="native-service-registered"));
 console.log("ok - native service supersedes fallback");
}
{
 const services=new TitanExecutionServices();
 services.register("github",{source:"native",capabilities:["verify"],verify:async()=>({native:true})});
 const result=installStockServiceFallbacks(services,{fetchImpl:githubFetch});
 assert(!result.installed.includes("github"));
 assert.equal(services.get("github").source,"native");
 console.log("ok - native service preserved over fallback");
}
console.log("stock service fallback tests passed");
