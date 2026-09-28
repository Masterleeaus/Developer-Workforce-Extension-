import {SLOT_IDS,SLOT_CLASS,SLOT_SQUAD} from "./constants.js";

export const PIPELINE_SLOT_TO_CANONICAL=Object.freeze({
 "supervisor-a":"SUPERVISOR_A",
 "supervisor-b":"SUPERVISOR_B",
 "builder-a":"BUILDER_A",
 "builder-b":"BUILDER_B",
 "orchestrator":"ORCHESTRATOR"
});

export const CANONICAL_SLOT_TO_PIPELINE=Object.freeze(Object.fromEntries(
 Object.entries(PIPELINE_SLOT_TO_CANONICAL).map(([pipeline,canonical])=>[canonical,pipeline])
));

function slotError(message,details={}){
 const e=new Error(message);e.code="INVALID_AGENT_SLOT";Object.assign(e,details);return e;
}

export function canonicalSlotId(id,{expectedExecutionClass=null}={}){
 if(typeof id!=="string"||!id.trim())throw slotError("Agent slot id is required",{slotId:id});
 const raw=id.trim();
 const canonical=SLOT_IDS.includes(raw)?raw:PIPELINE_SLOT_TO_CANONICAL[raw]||null;
 if(!canonical)throw slotError("Unknown agent slot "+raw,{slotId:raw});
 if(expectedExecutionClass&&SLOT_CLASS[canonical]!==expectedExecutionClass){
  throw slotError("Agent slot "+raw+" is not "+expectedExecutionClass,{slotId:raw,canonicalSlotId:canonical,actualExecutionClass:SLOT_CLASS[canonical],expectedExecutionClass});
 }
 return canonical;
}

export function pipelineSlotId(id){
 const canonical=canonicalSlotId(id);
 return CANONICAL_SLOT_TO_PIPELINE[canonical]||canonical;
}

export function canonicalSupervisorForSquad(squad){
 const s=String(squad||"").toUpperCase();
 if(s==="A")return "SUPERVISOR_A";
 if(s==="B")return "SUPERVISOR_B";
 throw slotError("Unknown squad "+String(squad),{squad});
}

export function canonicalizePipelineSlot(id,expectedExecutionClass=null){
 const canonical=canonicalSlotId(id,{expectedExecutionClass});
 return Object.freeze({
  inputSlotId:id,
  canonicalSlotId:canonical,
  pipelineSlotId:pipelineSlotId(canonical),
  executionClass:SLOT_CLASS[canonical],
  squad:SLOT_SQUAD[canonical]||null
 });
}
