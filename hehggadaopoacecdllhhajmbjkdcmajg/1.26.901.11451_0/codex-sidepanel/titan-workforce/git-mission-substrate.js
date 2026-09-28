const clone=x=>x==null?x:JSON.parse(JSON.stringify(x));
const terminal=s=>["merged","closed","released","stale-cleaned"].includes(String(s||"").toLowerCase());
function err(code,message,details={}){const e=new Error(message);e.code=code;Object.assign(e,details);return e}
export class TitanGitMissionSubstrate{
 constructor(state,{audit=()=>{},now=()=>Date.now(),leaseMs=60*60*1000}={}){this.state=state;this.audit=audit;this.now=now;this.leaseMs=leaseMs;state.gitSubstrate=state.gitSubstrate||{missions:{},history:[]}}
 record(type,data){const e={type,at:this.now(),...clone(data)};this.state.gitSubstrate.history.push(e);this.state.gitSubstrate.history=this.state.gitSubstrate.history.slice(-1000);this.audit("git-substrate-"+type,data);return e}
 get(missionId){return this.state.gitSubstrate.missions[missionId]||null}
 acquire({missionId,builderId,branch,worktree,baseCommit=null,scopePaths=[]}){
  if(!missionId||!builderId||!branch||!worktree)throw err("GIT_LEASE_INPUT_REQUIRED","missionId, builderId, branch and worktree are required");
  const existing=this.get(missionId),now=this.now();
  if(existing&&!terminal(existing.status)&&existing.leaseExpiresAt>now){
   const same=existing.builderId===builderId&&existing.branch===branch&&existing.worktree===worktree;
   if(!same)throw err("MISSION_GIT_LEASE_CONFLICT","Mission already has an active branch/worktree/builder lease",{missionId,existing:clone(existing)});
   existing.leaseExpiresAt=now+this.leaseMs;existing.updatedAt=now;return clone(existing);
  }
  for(const [otherId,x] of Object.entries(this.state.gitSubstrate.missions)){if(otherId!==missionId&&!terminal(x.status)&&(x.branch===branch||x.worktree===worktree))throw err("GIT_RESOURCE_ALREADY_LEASED","Branch or worktree already leased",{missionId,otherMissionId:otherId,branch,worktree})}
  const lease={missionId,builderId,branch,worktree,baseCommit,scopePaths:[...scopePaths],status:"active",dirty:false,createdAt:now,updatedAt:now,leaseExpiresAt:now+this.leaseMs};
  this.state.gitSubstrate.missions[missionId]=lease;this.record("lease-acquired",{missionId,builderId,branch,worktree});return clone(lease);
 }
 heartbeat(missionId,builderId){const x=this.get(missionId);if(!x)throw err("GIT_LEASE_NOT_FOUND","Mission Git lease not found",{missionId});if(x.builderId!==builderId)throw err("GIT_LEASE_OWNER_MISMATCH","Only lease owner may heartbeat",{missionId,builderId});x.leaseExpiresAt=this.now()+this.leaseMs;x.updatedAt=this.now();return clone(x)}
 assertClean(missionId,{dirty=false,untracked=[],modified=[]}={}){const x=this.get(missionId);if(!x)throw err("GIT_LEASE_NOT_FOUND","Mission Git lease not found",{missionId});x.dirty=!!dirty||untracked.length>0||modified.length>0;x.dirtyEvidence={untracked:[...untracked],modified:[...modified],checkedAt:this.now()};x.updatedAt=this.now();if(x.dirty)throw err("DIRTY_WORKTREE","Builder worktree has uncommitted changes",{missionId,evidence:clone(x.dirtyEvidence)});return true}
 markPullRequest(missionId,{number,url,state="open",headSha=null}={}){const x=this.get(missionId);if(!x)throw err("GIT_LEASE_NOT_FOUND","Mission Git lease not found",{missionId});x.pullRequest={number,url,state,headSha,updatedAt:this.now()};x.updatedAt=this.now();this.record("pr-updated",{missionId,number,state,headSha});return clone(x)}
 markCI(missionId,{status,headSha,failures=[]}={}){const x=this.get(missionId);if(!x)throw err("GIT_LEASE_NOT_FOUND","Mission Git lease not found",{missionId});x.ci={status,headSha,failures:clone(failures),updatedAt:this.now()};x.updatedAt=this.now();return clone(x)}
 assertGitHubTruthComplete(missionId,{merged=false,mergeCommit=null,ciStatus=null,verified=false}={}){const x=this.get(missionId);if(!x)throw err("GIT_LEASE_NOT_FOUND","Mission Git lease not found",{missionId});if(!merged||!mergeCommit)throw err("GITHUB_MERGE_EVIDENCE_REQUIRED","Mission cannot complete without merged PR evidence",{missionId});if(!["success","pass","passed"].includes(String(ciStatus||x.ci?.status||"").toLowerCase()))throw err("GITHUB_CI_EVIDENCE_REQUIRED","Mission cannot complete without passing CI",{missionId});if(!verified)throw err("VERIFICATION_EVIDENCE_REQUIRED","Mission cannot complete without verification evidence",{missionId});x.status="merged";x.mergeCommit=mergeCommit;x.completedAt=this.now();this.record("github-truth-complete",{missionId,mergeCommit});return clone(x)}
 stale({now=this.now()}={}){return Object.values(this.state.gitSubstrate.missions).filter(x=>!terminal(x.status)&&x.leaseExpiresAt<=now).map(clone)}
 release(missionId,{reason="released",merged=false}={}){const x=this.get(missionId);if(!x)return null;if(x.dirty&&!merged)throw err("DIRTY_WORKTREE_CLEANUP_BLOCKED","Dirty worktree cannot be automatically cleaned",{missionId});x.status=merged?"merged":"released";x.releaseReason=reason;x.releasedAt=this.now();this.record("lease-released",{missionId,reason,merged});return clone(x)}
}
