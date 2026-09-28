export function createProvenanceNode({id,type,missionId,parentIds=[],agentId=null,artifactId=null,metadata={}}){
 if(!id||!type||!missionId)throw new Error("provenance id/type/missionId required");
 return {id,type,missionId,parentIds:[...new Set(parentIds)],agentId,artifactId,metadata,at:Date.now()};
}
export class TitanProvenanceGraph{
 constructor(state){this.state=state;this.state.provenance=this.state.provenance||{}}
 add(node){if(this.state.provenance[node.id])throw new Error("Duplicate provenance node "+node.id);this.state.provenance[node.id]=node;return node}
 get(id){return this.state.provenance[id]||null}
 ancestry(id,seen=new Set()){if(seen.has(id))return [];seen.add(id);const n=this.get(id);if(!n)return [];return [n,...n.parentIds.flatMap(p=>this.ancestry(p,seen))]}
 forMission(missionId){return Object.values(this.state.provenance).filter(n=>n.missionId===missionId).sort((a,b)=>a.at-b.at)}
}
