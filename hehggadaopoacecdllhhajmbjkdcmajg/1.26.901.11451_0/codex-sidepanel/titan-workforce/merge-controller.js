export function integrationPressure(x={}){
 const score=Math.min(20,(x.openPRs||0)+(x.ciPending||0)*2+(x.conflicts||0)*3+(x.verificationBacklog||0)*2+(x.mainChurn||0));
 const state=score>=12?"frozen":score>=7?"throttled":"open";
 return {score,state};
}
export class TitanMergeController{
 constructor({maxMergesPerHour=6,audit=()=>{}}={}){this.maxMergesPerHour=maxMergesPerHour;this.audit=audit;this.merges=[];this.state="open"}
 evaluate(metrics={}){const p=integrationPressure(metrics);const recent=this.merges.filter(t=>Date.now()-t<3600000);this.merges=recent;if(recent.length>=this.maxMergesPerHour)p.state="frozen";this.state=p.state;this.audit("merge-pressure",{...p,mergesLastHour:recent.length});return {...p,mergesLastHour:recent.length}}
 canMerge(){return this.state==="open"}
 recordMerge(at=Date.now()){this.merges.push(at);return this.merges.length}
}
