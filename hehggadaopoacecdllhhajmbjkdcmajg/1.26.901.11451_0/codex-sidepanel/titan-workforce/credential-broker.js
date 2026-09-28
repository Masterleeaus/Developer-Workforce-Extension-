function now(){return Date.now()}
function uniq(a){return [...new Set((a||[]).filter(Boolean).map(String))]}
function opaqueId(prefix){return prefix+"-"+now()+"-"+Math.random().toString(36).slice(2,10)}
function brokerError(code,message,extra={}){return Object.assign(new Error(message),{code,...extra})}
function matches(value,allowed){
  if(!allowed?.length)return true;
  return allowed.includes("*")||allowed.includes(value);
}
function cloneMetadata(grant){
  const {executor,...safe}=grant;
  return JSON.parse(JSON.stringify(safe));
}

export class TitanCredentialBroker{
  constructor(state,{audit=()=>{},approvalStore=null}={}){
    if(!state)throw new Error("Credential broker state is required");
    this.state=state;
    this.audit=audit;
    this.approvalStore=approvalStore;
    this.executors=new Map();
    this.state.credentials=this.state.credentials||{};
    this.state.credentialLeases=this.state.credentialLeases||{};
    this.state.credentialAudit=this.state.credentialAudit||[];
  }
  register(spec,executor){
    if(!spec?.name)throw new Error("Credential/capability name required");
    if(typeof executor!=="function")throw new Error("Credential executor required: "+spec.name);
    const name=String(spec.name);
    const metadata={
      name,
      capability:spec.capability||name,
      scope:uniq(spec.scope||spec.scopes||[]),
      repository:spec.repository||null,
      server:spec.server||null,
      expiresAt:Number(spec.expiresAt||0)||null,
      allowedExecutionClasses:uniq(spec.allowedExecutionClasses||[]),
      allowedProfiles:uniq(spec.allowedProfiles||[]),
      approvalState:spec.approvalState||"required",
      createdAt:spec.createdAt||now(),
      updatedAt:now()
    };
    this.state.credentials[name]=metadata;
    this.executors.set(name,executor);
    this._audit("credential-registered",{name,capability:metadata.capability,scope:metadata.scope});
    return cloneMetadata(metadata);
  }
  unregister(name){this.executors.delete(name);delete this.state.credentials[name];return true}
  list(){return Object.values(this.state.credentials).map(cloneMetadata)}
  get(name){const m=this.state.credentials[name];return m?cloneMetadata(m):null}
  _audit(type,detail={}){
    const event={type,at:now(),...detail};
    this.state.credentialAudit.push(event);
    this.state.credentialAudit=this.state.credentialAudit.slice(-500);
    this.audit(type,detail);
    return event;
  }
  _validateGrant(metadata,context={}){
    if(metadata.expiresAt&&metadata.expiresAt<=now())throw brokerError("CREDENTIAL_EXPIRED","Credential capability expired: "+metadata.name,{name:metadata.name});
    if(metadata.repository&&context.repository&&metadata.repository!==context.repository)throw brokerError("CREDENTIAL_SCOPE_DENIED","Credential repository scope mismatch",{name:metadata.name});
    if(metadata.server&&context.server&&metadata.server!==context.server)throw brokerError("CREDENTIAL_SCOPE_DENIED","Credential server scope mismatch",{name:metadata.name});
    if(!matches(context.executionClass,metadata.allowedExecutionClasses))throw brokerError("CREDENTIAL_EXECUTION_CLASS_DENIED","Execution class is not allowed for credential capability",{name:metadata.name});
    const profiles=uniq(context.profileIds||context.profiles||[]);
    if(metadata.allowedProfiles.length&&!profiles.some(p=>matches(p,metadata.allowedProfiles)))throw brokerError("CREDENTIAL_PROFILE_DENIED","Active profiles are not allowed for credential capability",{name:metadata.name});
    const requestedScopes=uniq(context.scope||context.scopes||[]);
    if(metadata.scope.length&&requestedScopes.some(s=>!matches(s,metadata.scope)))throw brokerError("CREDENTIAL_SCOPE_DENIED","Requested scope exceeds credential grant",{name:metadata.name});
    return true;
  }
  async request(name,context={}){
    const metadata=this.state.credentials[name];
    if(!metadata)throw brokerError("CREDENTIAL_UNAVAILABLE","Credential capability unavailable: "+name,{name});
    this._validateGrant(metadata,context);
    let approval=null;
    if(metadata.approvalState!=="approved"){
      if(!this.approvalStore)throw brokerError("CREDENTIAL_APPROVAL_REQUIRED","Credential capability requires approval: "+name,{name});
      const request={
        type:"secret-access:"+name,
        missionId:context.missionId||null,
        packetId:context.packetId||null,
        credential:name,
        executionClass:context.executionClass||null,
        scope:uniq(context.scope||context.scopes||[])
      };
      approval=await this.approvalStore.request(request);
      if(!approval?.approved)throw brokerError("CREDENTIAL_APPROVAL_REQUIRED","Credential capability requires approval: "+name,{name,approvalId:approval?.id||null});
    }
    const leaseId=opaqueId("credential-lease");
    const lease={
      id:leaseId,
      credential:name,
      capability:metadata.capability,
      missionId:context.missionId||null,
      executionClass:context.executionClass||null,
      profileIds:uniq(context.profileIds||context.profiles||[]),
      repository:context.repository||metadata.repository||null,
      server:context.server||metadata.server||null,
      scope:uniq(context.scope||context.scopes||[]),
      approvalId:approval?.id||null,
      createdAt:now(),
      expiresAt:Math.min(
        metadata.expiresAt||Number.MAX_SAFE_INTEGER,
        Number(context.leaseExpiresAt||0)||now()+15*60*1000
      )
    };
    this.state.credentialLeases[leaseId]=lease;
    this._audit("credential-lease-created",{leaseId,credential:name,missionId:lease.missionId,approvalId:lease.approvalId});
    return JSON.parse(JSON.stringify(lease));
  }
  async execute(leaseId,args={},context={}){
    const lease=this.state.credentialLeases[leaseId];
    if(!lease)throw brokerError("CREDENTIAL_LEASE_INVALID","Unknown credential lease",{leaseId});
    if(lease.expiresAt<=now())throw brokerError("CREDENTIAL_LEASE_EXPIRED","Credential lease expired",{leaseId});
    if(context.missionId&&lease.missionId&&context.missionId!==lease.missionId)throw brokerError("CREDENTIAL_LEASE_SCOPE_MISMATCH","Credential lease mission mismatch",{leaseId});
    const metadata=this.state.credentials[lease.credential];
    if(!metadata)throw brokerError("CREDENTIAL_UNAVAILABLE","Credential capability no longer registered",{leaseId});
    this._validateGrant(metadata,{...context,executionClass:context.executionClass||lease.executionClass,profileIds:context.profileIds||lease.profileIds,repository:context.repository||lease.repository,server:context.server||lease.server,scope:context.scope||lease.scope});
    const executor=this.executors.get(lease.credential);
    if(typeof executor!=="function")throw brokerError("CREDENTIAL_EXECUTOR_UNAVAILABLE","Credential executor unavailable",{leaseId});
    this._audit("credential-execution-started",{leaseId,credential:lease.credential,missionId:lease.missionId});
    try{
      const result=await executor(args,{...context,lease:JSON.parse(JSON.stringify(lease))});
      this._audit("credential-execution-complete",{leaseId,credential:lease.credential,missionId:lease.missionId});
      return result;
    }catch(error){
      this._audit("credential-execution-failed",{leaseId,credential:lease.credential,missionId:lease.missionId,error:String(error?.message||error)});
      throw error;
    }
  }
  revokeLease(leaseId,reason="manual"){
    const lease=this.state.credentialLeases[leaseId];
    if(!lease)return false;
    delete this.state.credentialLeases[leaseId];
    this._audit("credential-lease-revoked",{leaseId,credential:lease.credential,reason});
    return true;
  }
  pruneExpired(){
    let removed=0;
    for(const [id,lease] of Object.entries(this.state.credentialLeases)){
      if(Number(lease.expiresAt||0)<=now()){delete this.state.credentialLeases[id];removed++}
    }
    if(removed)this._audit("credential-leases-pruned",{removed});
    return removed;
  }
}
