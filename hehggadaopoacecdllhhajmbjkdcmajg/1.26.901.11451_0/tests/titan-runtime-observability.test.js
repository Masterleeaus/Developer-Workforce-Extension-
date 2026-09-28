"use strict";

const assert=require("node:assert/strict");
const {
  RuntimeObservability,
  createRuntimeObservability,
  installRuntimeObservability,
  sanitize,
  category
}=require("../codex-sidepanel/titan-runtime-observability.js");

function test(name,fn){
  Promise.resolve().then(fn).then(
    ()=>console.log("ok - "+name),
    error=>{console.error("not ok - "+name);process.exitCode=1;console.error(error)}
  );
}

test("sanitizer redacts sensitive values and strips URL query",()=>{
  const out=sanitize({
    token:"abc",
    authorization:"Bearer xyz",
    nested:{password:"secret",url:"https://example.test/path?token=secret#frag"},
    safe:"hello"
  });
  assert.equal(out.token,"[redacted]");
  assert.equal(out.authorization,"[redacted]");
  assert.equal(out.nested.password,"[redacted]");
  assert.equal(out.nested.url,"https://example.test/path");
  assert.equal(out.safe,"hello");
});

test("category classifies common runtime failures",()=>{
  assert.equal(category(new Error("Permission denied")), "permission");
  assert.equal(category(new Error("native host unreachable")), "native-host");
  assert.equal(category(new Error("microphone blocked")), "media");
  assert.equal(category(new Error("sendMessage port closed")), "messaging");
  assert.equal(category(new Error("websocket connection timeout")), "network");
});

test("records are bounded",()=>{
  let now=0;
  const obs=new RuntimeObservability({maxEvents:10,dedupeMs:0,now:()=>++now});
  for(let i=0;i<25;i++)obs.record({subsystem:"test",operation:"op"+i,error:new Error("e"+i)});
  assert.equal(obs.list().length,10);
  assert.equal(obs.list()[0].operation,"op15");
});

test("duplicate failures are collapsed with occurrence count",()=>{
  let now=1000;
  const obs=createRuntimeObservability({dedupeMs:30000,now:()=>now});
  obs.record({subsystem:"auth",operation:"revalidate",error:new Error("session expired")});
  now+=100;
  obs.record({subsystem:"auth",operation:"revalidate",error:new Error("session expired")});
  const events=obs.list();
  assert.equal(events.length,1);
  assert.equal(events[0].repeatCount,2);
  assert.equal(obs.status().totalOccurrences,2);
});

test("guard records then rethrows failures",async()=>{
  const obs=createRuntimeObservability();
  await assert.rejects(
    ()=>obs.guard("native-host","connect",async()=>{throw new Error("native host unreachable")}),
    /native host unreachable/
  );
  const [entry]=obs.list();
  assert.equal(entry.subsystem,"native-host");
  assert.equal(entry.operation,"connect");
  assert.equal(entry.category,"native-host");
});

test("install captures Titan stable error events",()=>{
  const listeners=new Map();
  const root={
    addEventListener(name,fn){const a=listeners.get(name)||[];a.push(fn);listeners.set(name,a)},
    dispatchEvent(){return true}
  };
  const obs=createRuntimeObservability();
  installRuntimeObservability(root,obs);
  const fire=(name,detail)=>{for(const fn of listeners.get(name)||[])fn({detail})};
  fire("titan-workforce:error",{message:"bootstrap exploded",token:"must redact"});
  fire("titan:stock-native-error",{message:"native host unreachable",authorization:"secret"});
  const entries=obs.list();
  assert.equal(entries.length,2);
  assert.equal(entries[0].subsystem,"workforce-bootstrap");
  assert.equal(entries[0].detail.token,"[redacted]");
  assert.equal(entries[1].category,"native-host");
  assert.equal(entries[1].detail.authorization,"[redacted]");
});

process.on("beforeExit",()=>{
  if(process.exitCode)throw new Error("Runtime observability tests failed");
  console.log("\nRuntime observability tests passed.");
});
