import assert from "node:assert/strict";
import fs from "node:fs";

const client=fs.readFileSync(new URL("./sidepanel-client.js",import.meta.url),"utf8");
const owner=fs.readFileSync(new URL("./runtime-owner.js",import.meta.url),"utf8");
const controls=fs.readFileSync(new URL("./controls.js",import.meta.url),"utf8");

for(const text of [
 "Squad A · A1–A5 + Supervisor A",
 "Squad B · B1–B5 + Supervisor B",
 "Codex builders",
 "Codex orchestrator",
 "Mission queue, approvals, scope & evidence",
 "rotate-conversation",
 "quarantine-all",
 "quarantine-squad",
 "Chat workers",
 "Work supervisors"
]) assert(client.includes(text),"cockpit missing "+text);

for(const action of ["rotateConversation","conversationLifecycleStatus","quarantineAll","unquarantineAll","quarantineSquad","unquarantineSquad"]){
 assert(owner.includes(action),"runtime owner missing "+action);
}
for(const method of ["quarantineAll","unquarantineAll","quarantineSquad","unquarantineSquad"]){
 assert(controls.includes(method),"controls missing "+method);
}
assert(!/Titan5x5|titan5x5/.test(client),"cockpit must not depend on legacy 5x5 UI");

console.log("Titan cockpit hierarchy/lifecycle UI tests PASS");
