export function staleMissionActions(missions,{now=Date.now(),staleMs=24*3600000}={}){
 return Object.values(missions||{}).filter(m=>!["verified","cancelled","superseded"].includes(m.status)).filter(m=>now-(m.updatedAt||m.createdAt||now)>=staleMs).map(m=>({missionId:m.id,action:m.supersededBy?"archive":"replan",ageMs:now-(m.updatedAt||m.createdAt||now)}));
}
export function conversationRotationNeeded(slot,{now=Date.now(),maxAgeMs=7*24*3600000,maxMissions=10,maxFailures=3}={}){
 const c=slot?.conversation;if(!c)return {rotate:false};
 const reasons=[];if(c.boundAt&&now-c.boundAt>maxAgeMs)reasons.push("age");if((c.missionsCompleted||0)>=maxMissions)reasons.push("mission-count");if((c.failures||0)>=maxFailures)reasons.push("failures");if(c.contextDegraded)reasons.push("context-degraded");
 return {rotate:reasons.length>0,reasons};
}
export function staleWorkItems(items,{now=Date.now(),staleMs=3*3600000}={}){
 return (items||[]).filter(x=>now-(x.updatedAt||x.createdAt||now)>=staleMs).map(x=>({...x,reaperAction:x.merged?"remove":x.prOpen?"finish-or-merge":"inspect"}));
}
