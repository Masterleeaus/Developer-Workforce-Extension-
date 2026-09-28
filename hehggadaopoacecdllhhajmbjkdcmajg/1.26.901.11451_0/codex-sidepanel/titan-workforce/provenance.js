function provenanceError(code,message,details={}){
 const e=new Error(message);e.code=code;Object.assign(e,details);return e;
}
function clone(x){return x==null?x:JSON.parse(JSON.stringify(x))}

export function createProvenanceNode({id,type,missionId,parentIds=[],agentId=null,artifactId=null,metadata={}}){
 if(!id||!type||!missionId)throw provenanceError("INVALID_PROVENANCE_NODE","provenance id/type/missionId required");
 const parents=[...new Set((parentIds||[]).map(String).filter(Boolean))];
 return {id:String(id),type:String(type),missionId:String(missionId),parentIds:parents,agentId:agentId||null,artifactId:artifactId||null,metadata:clone(metadata)||{},at:Date.now()};
}

export class TitanProvenanceGraph{
 constructor(state){this.state=state;this.state.provenance=this.state.provenance||{}}
 get(id){return this.state.provenance[id]||null}

 integrityErrors({missionId=null}={}){
  const errors=[],graph=this.state.provenance||{},nodes=Object.entries(graph).filter(([,n])=>!missionId||n?.missionId===missionId);
  const nodeIds=new Set(nodes.map(([id])=>id));
  for(const [id,node] of nodes){
   if(!node||typeof node!=="object"){errors.push({code:"INVALID_NODE",nodeId:id});continue}
   if(node.id!==id)errors.push({code:"NODE_ID_MISMATCH",nodeId:id,storedId:node.id});
   if(!node.missionId||!this.state.missions?.[node.missionId])errors.push({code:"UNKNOWN_MISSION",nodeId:id,missionId:node.missionId||null});
   if(node.agentId&& !this.state.agents?.[node.agentId])errors.push({code:"UNKNOWN_AGENT",nodeId:id,agentId:node.agentId});
   const parents=Array.isArray(node.parentIds)?node.parentIds:[];
   if(!Array.isArray(node.parentIds))errors.push({code:"INVALID_PARENTS",nodeId:id});
   for(const parentId of parents){
    if(parentId===id){errors.push({code:"SELF_PARENT",nodeId:id,parentId});continue}
    const parent=graph[parentId];
    if(!parent){errors.push({code:"MISSING_PARENT",nodeId:id,parentId});continue}
    if(parent.missionId!==node.missionId)errors.push({code:"CROSS_MISSION_PARENT",nodeId:id,parentId,missionId:node.missionId,parentMissionId:parent.missionId});
   }
  }

  const color=new Map(),stack=[];
  const visit=id=>{
   const state=color.get(id)||0;
   if(state===2)return;
   if(state===1){
    const start=stack.indexOf(id),cycle=(start>=0?stack.slice(start):stack.slice()).concat(id);
    errors.push({code:"CYCLE",nodeId:id,cycle});return;
   }
   color.set(id,1);stack.push(id);
   const node=graph[id];
   for(const parentId of Array.isArray(node?.parentIds)?node.parentIds:[]){
    if(!graph[parentId])continue;
    if(missionId&&graph[parentId]?.missionId!==missionId)continue;
    visit(parentId);
   }
   stack.pop();color.set(id,2);
  };
  for(const id of nodeIds)visit(id);
  return errors;
 }

 assertIntegrity(options={}){
  const errors=this.integrityErrors(options);
  if(errors.length)throw provenanceError("PROVENANCE_INTEGRITY_ERROR","Provenance graph integrity check failed",{errors});
  return true;
 }

 add(node){
  if(!node||typeof node!=="object")throw provenanceError("INVALID_PROVENANCE_NODE","Provenance node required");
  if(this.state.provenance[node.id])throw provenanceError("DUPLICATE_PROVENANCE_NODE","Duplicate provenance node "+node.id,{nodeId:node.id});
  if(!this.state.missions?.[node.missionId])throw provenanceError("UNKNOWN_PROVENANCE_MISSION","Unknown provenance mission "+node.missionId,{nodeId:node.id,missionId:node.missionId});
  if(node.agentId&&!this.state.agents?.[node.agentId])throw provenanceError("UNKNOWN_PROVENANCE_AGENT","Unknown provenance agent "+node.agentId,{nodeId:node.id,agentId:node.agentId});
  const parents=[...new Set(Array.isArray(node.parentIds)?node.parentIds:[])];
  for(const parentId of parents){
   if(parentId===node.id)throw provenanceError("PROVENANCE_SELF_PARENT","Provenance node cannot parent itself",{nodeId:node.id,parentId});
   const parent=this.get(parentId);
   if(!parent)throw provenanceError("PROVENANCE_PARENT_MISSING","Provenance parent does not exist",{nodeId:node.id,parentId});
   if(parent.missionId!==node.missionId)throw provenanceError("PROVENANCE_CROSS_MISSION","Provenance parent belongs to another mission",{nodeId:node.id,parentId,missionId:node.missionId,parentMissionId:parent.missionId});
  }
  this.assertIntegrity({missionId:node.missionId});
  const stored={...clone(node),parentIds:parents};
  this.state.provenance[node.id]=stored;
  const after=this.integrityErrors({missionId:node.missionId});
  if(after.length){delete this.state.provenance[node.id];throw provenanceError("PROVENANCE_INTEGRITY_ERROR","Provenance node would make graph invalid",{nodeId:node.id,errors:after})}
  return stored
 }

 ancestry(id){
  const n=this.get(id);if(!n)return [];
  this.assertIntegrity({missionId:n.missionId});
  const seen=new Set(),out=[];
  const walk=nodeId=>{
   if(seen.has(nodeId))return;seen.add(nodeId);
   const node=this.get(nodeId);if(!node)return;
   out.push(node);
   for(const parentId of node.parentIds||[])walk(parentId);
  };
  walk(id);return out
 }

 forMission(missionId){
  this.assertIntegrity({missionId});
  return Object.values(this.state.provenance).filter(n=>n.missionId===missionId).sort((a,b)=>a.at-b.at)
 }
}
