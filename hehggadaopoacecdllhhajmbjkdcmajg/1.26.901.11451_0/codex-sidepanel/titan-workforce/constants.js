export const WORKFORCE_SCHEMA_VERSION=4;
export const EXECUTION_CLASSES=Object.freeze(["chat_worker","work_supervisor","codex_builder","codex_orchestrator"]);
export const CHAT_SLOTS=Object.freeze(["A1","A2","A3","A4","A5","B1","B2","B3","B4","B5"]);
export const SUPERVISOR_SLOTS=Object.freeze(["SUPERVISOR_A","SUPERVISOR_B"]);
export const BUILDER_SLOTS=Object.freeze(["BUILDER_A","BUILDER_B"]);
export const ORCHESTRATOR_SLOTS=Object.freeze(["ORCHESTRATOR"]);
export const SLOT_IDS=Object.freeze([...CHAT_SLOTS,...SUPERVISOR_SLOTS,...BUILDER_SLOTS,...ORCHESTRATOR_SLOTS]);
export const SQUADS=Object.freeze({A:["A1","A2","A3","A4","A5"],B:["B1","B2","B3","B4","B5"]});
export const SLOT_CLASS=Object.freeze(Object.fromEntries([
 ...CHAT_SLOTS.map(id=>[id,"chat_worker"]),
 ...SUPERVISOR_SLOTS.map(id=>[id,"work_supervisor"]),
 ...BUILDER_SLOTS.map(id=>[id,"codex_builder"]),
 ...ORCHESTRATOR_SLOTS.map(id=>[id,"codex_orchestrator"])
]));
export const SLOT_SQUAD=Object.freeze(Object.fromEntries([...SQUADS.A.map(id=>[id,"A"]),...SQUADS.B.map(id=>[id,"B"]),["SUPERVISOR_A","A"],["SUPERVISOR_B","B"]]));
