const READ="READ",WRITE="WRITE",EXTERNAL="EXTERNAL_SIDE_EFFECT",SERVER="SERVER_ADMIN";

function method(service,names){
 for(const name of names){
  if(typeof service?.[name]==="function")return service[name].bind(service);
 }
 return null;
}
async function serviceRequest(service,methodName,params,context={}){
 if(typeof service?.request!=="function")throw Object.assign(new Error("Service request unavailable: "+methodName),{code:"SERVICE_METHOD_UNAVAILABLE"});
 return service.request({method:methodName,params,signal:context.signal});
}
function registerIf(broker,name,handler,options){
 if(typeof handler!=="function")return false;
 broker.register(name,handler,options);return true;
}
export const EXECUTION_CLASS_CAPABILITIES=Object.freeze({
 chat_worker:Object.freeze([
  "repo.read","repo.search","repo.diff","github.status","github.pr","github.actions",
  "browser.inspect","browser.console","browser.network","browser.screenshot","runtime.verify","mcp.list"
 ]),
 work_supervisor:Object.freeze([
  "repo.read","repo.search","repo.diff","git.status","github.status","github.pr","github.actions",
  "browser.inspect","browser.console","browser.network","browser.screenshot","runtime.verify","mcp.list"
 ]),
 codex_builder:Object.freeze([
  "repo.read","repo.search","repo.diff","git.status","git.branch","git.commit","git.worktree",
  "github.status","github.pr","github.actions","codex.thread.start","codex.thread.resume",
  "codex.turn.start","codex.turn.steer","codex.turn.interrupt","codex.build",
  "terminal.exec","terminal.test","terminal.build","browser.inspect","browser.console",
  "browser.network","browser.screenshot","runtime.verify","server.inspect","mcp.list","mcp.call"
 ]),
 codex_orchestrator:Object.freeze([
  "repo.read","repo.search","repo.diff","git.status","github.status","github.pr","github.actions",
  "codex.thread.start","codex.thread.resume","codex.turn.start","codex.turn.steer",
  "codex.turn.interrupt","codex.orchestrate","terminal.exec","terminal.test",
  "browser.inspect","browser.console","browser.network","browser.screenshot",
  "runtime.verify","server.inspect","mcp.list","mcp.call"
 ])
});
export const PROFILE_CAPABILITY_ALIASES=Object.freeze({
 read_repo:Object.freeze(["repo.read","repo.search","repo.diff"]),
 read_mission:Object.freeze([]),
 reason:Object.freeze([]),
 produce_handoff:Object.freeze([])
});
export function capabilitiesForExecutionContext({executionClass,profileCapabilities=[]}={}){
 const out=new Set(EXECUTION_CLASS_CAPABILITIES[executionClass]||[]);
 for(const capability of profileCapabilities||[]){
  const aliases=PROFILE_CAPABILITY_ALIASES[capability]||[capability];
  for(const name of aliases)out.add(name);
 }
 return [...out];
}
export function installExecutionCapabilities({services,broker,audit=()=>{}}={}){
 if(!services||!broker)throw new Error("services and broker are required");
 const registered=[];
 const add=(name,handler,classification=READ,source="execution-services",timeoutMs=30000)=>{
  if(!handler)return;
  registerIf(broker,name,handler,{classification,source,timeoutMs});
  registered.push(name);
 };
 const sync=()=>{
  for(const name of [...registered])broker.unregister(name);
  registered.length=0;

  const repository=services.get("repository");
  if(repository){
   add("repo.search",method(repository,["query","search"])?(args,ctx)=>(method(repository,["query","search"]))(args,ctx):null,READ,repository.source||"repository");
   add("repo.read",method(repository,["read"])?(args,ctx)=>repository.read(args,ctx):null,READ,repository.source||"repository");
   add("repo.diff",method(repository,["diff"])?(args,ctx)=>repository.diff(args,ctx):null,READ,repository.source||"repository");
  }

  const git=services.get("git");
  if(git){
   const direct=(names,requestMethod)=>(args,ctx)=>{
    const fn=method(git,names);
    return fn?fn(args,{signal:ctx.signal}):serviceRequest(git,requestMethod,args,ctx);
   };
   add("git.status",direct(["status"],"status"),READ,git.source||"git");
   add("git.branch",direct(["branch","createBranch"],"branch"),WRITE,git.source||"git");
   add("git.commit",direct(["commit"],"commit"),WRITE,git.source||"git");
   add("git.merge",direct(["merge"],"merge"),WRITE,git.source||"git");
   add("git.worktree",direct(["worktree"],"worktree"),WRITE,git.source||"git");
   add("repo.diff",(args,ctx)=>{const fn=method(git,["diff"]);return fn?fn(args,{signal:ctx.signal}):serviceRequest(git,"diff",args,ctx)},READ,git.source||"git");
  }

  const github=services.get("github");
  if(github){
   add("github.status",(args,ctx)=>{
    const fn=method(github,["status","verify"]);return fn?fn(args,{signal:ctx.signal}):serviceRequest(github,"status",args,ctx);
   },READ,github.source||"github");
   add("github.issue",(args,ctx)=>{
    const fn=method(github,["issue"]);return fn?fn(args,{signal:ctx.signal}):serviceRequest(github,"issue",args,ctx);
   },WRITE,github.source||"github");
   add("github.pr",(args,ctx)=>{
    const fn=method(github,["pr","pullRequest"]);return fn?fn(args,{signal:ctx.signal}):serviceRequest(github,"pr",args,ctx);
   },WRITE,github.source||"github");
   add("github.actions",(args,ctx)=>{
    const fn=method(github,["actions"]);return fn?fn(args,{signal:ctx.signal}):serviceRequest(github,"actions",args,ctx);
   },READ,github.source||"github");
  }

  const codex=services.get("codex");
  if(codex){
   if(typeof codex.request==="function"){
    const req=methodName=>(args,ctx)=>codex.request(methodName,args,{signal:ctx.signal});
    add("codex.thread.start",req("thread/start"),WRITE,codex.source||"codex",120000);
    add("codex.thread.resume",req("thread/resume"),WRITE,codex.source||"codex",120000);
    add("codex.turn.start",req("turn/start"),WRITE,codex.source||"codex",180000);
    add("codex.turn.steer",req("turn/steer"),WRITE,codex.source||"codex",60000);
    add("codex.turn.interrupt",req("turn/interrupt"),WRITE,codex.source||"codex",30000);
   }
   add("codex.build",method(codex,["build","execute"])?(args,ctx)=>(method(codex,["build","execute"]))(args,{signal:ctx.signal}):null,WRITE,codex.source||"codex",180000);
   add("codex.orchestrate",method(codex,["orchestrate","review"])?(args,ctx)=>(method(codex,["orchestrate","review"]))(args,{signal:ctx.signal}):null,WRITE,codex.source||"codex",180000);
  }

  const terminal=services.get("terminal");
  if(terminal){
   add("terminal.exec",method(terminal,["exec","run"])?(args,ctx)=>(method(terminal,["exec","run"]))(args,{signal:ctx.signal}):null,WRITE,terminal.source||"terminal",120000);
   add("terminal.test",method(terminal,["test"])?(args,ctx)=>terminal.test(args,{signal:ctx.signal}):method(terminal,["exec","run"])?(args,ctx)=>(method(terminal,["exec","run"]))({...args,kind:"test"},{signal:ctx.signal}):null,WRITE,terminal.source||"terminal",180000);
   add("terminal.build",method(terminal,["build"])?(args,ctx)=>terminal.build(args,{signal:ctx.signal}):method(terminal,["exec","run"])?(args,ctx)=>(method(terminal,["exec","run"]))({...args,kind:"build"},{signal:ctx.signal}):null,WRITE,terminal.source||"terminal",180000);
  }

  const browser=services.get("browser");
  if(browser){
   add("browser.inspect",method(browser,["inspect"])?(args,ctx)=>browser.inspect(args,{signal:ctx.signal}):null,READ,browser.source||"browser");
   add("browser.console",method(browser,["console","logs"])?(args,ctx)=>(method(browser,["console","logs"]))(args,{signal:ctx.signal}):null,READ,browser.source||"browser");
   add("browser.network",method(browser,["network"])?(args,ctx)=>browser.network(args,{signal:ctx.signal}):null,READ,browser.source||"browser");
   add("browser.screenshot",method(browser,["screenshot"])?(args,ctx)=>browser.screenshot(args,{signal:ctx.signal}):null,READ,browser.source||"browser");
  }

  const runtime=services.get("runtime");
  if(runtime)add("runtime.verify",method(runtime,["verify"])?(args,ctx)=>runtime.verify(args,{signal:ctx.signal}):null,READ,runtime.source||"runtime",120000);

  const server=services.get("server");
  if(server){
   add("server.inspect",method(server,["inspect"])?(args,ctx)=>server.inspect(args,{signal:ctx.signal}):null,READ,server.source||"server");
   add("server.deploy",method(server,["deploy"])?(args,ctx)=>server.deploy(args,{signal:ctx.signal}):null,SERVER,server.source||"server",180000);
  }

  audit("execution-capabilities-synced",{registered:[...registered]});
  return [...registered];
 };
 return {sync,list:()=>[...registered]};
}
