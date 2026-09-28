export const ACTION_RISK=Object.freeze({
  AUTOMATIC:"automatic",
  APPROVAL:"approval"
});

const APPROVAL_ACTION_PATTERNS=[
  [/\bgit\.merge\b/,"merge-main"],
  [/\bserver\.deploy\b/,"production-deploy"],
  [/server.*restart|restart.*server/,"server-restart"],
  [/migration.*destructive|destructive.*migration/,"destructive-migration"],
  [/tenant|company.*boundary|boundary.*company/,"tenant-boundary-change"],
  [/secret|credential/,"secret-access"]
];

function textOf(input){
  return [
    input?.name,input?.classification,input?.context?.action,input?.context?.operation,
    input?.context?.mission?.title,input?.context?.mission?.goal,
    input?.args?.action,input?.args?.operation,input?.args?.kind
  ].filter(Boolean).join(" ").toLowerCase();
}
export function classifyHighImpactAction(input={}){
  const text=textOf(input);
  for(const [pattern,type] of APPROVAL_ACTION_PATTERNS)if(pattern.test(text))return {risk:ACTION_RISK.APPROVAL,type};
  if(["DESTRUCTIVE","EXTERNAL_SIDE_EFFECT","SERVER_ADMIN","SECRET_ACCESS"].includes(String(input.classification||"").toUpperCase())){
    return {risk:ACTION_RISK.APPROVAL,type:String(input.classification||"high-impact").toLowerCase()};
  }
  return {risk:ACTION_RISK.AUTOMATIC,type:"routine"};
}

function approvalRequest(input,classification){
  const context=input.context||{};
  return {
    type:"high-impact:"+classification.type+":"+input.name,
    missionId:context.missionId||context.mission?.id||null,
    packetId:context.packetId||null,
    capability:input.name,
    actionType:classification.type,
    executionClass:context.executionClass||null,
    repository:context.repository||context.mission?.repository||context.mission?.repo||null,
    requestedAt:Date.now()
  };
}

export function createHighImpactAuthorizer({approvalStore,audit=()=>{},additionalPolicy=null}={}){
  return async input=>{
    const classification=classifyHighImpactAction(input);
    if(typeof additionalPolicy==="function"){
      const extra=await additionalPolicy(input,classification);
      if(extra===false||extra?.allowed===false){
        audit("high-impact-policy-denied",{capability:input.name,reason:extra?.reason||"additional-policy"});
        return {allowed:false,reason:extra?.reason||"additional-policy"};
      }
      if(extra?.allowed===true&&classification.risk===ACTION_RISK.AUTOMATIC)return {allowed:true,reason:extra.reason||"additional-policy-approved"};
    }
    if(classification.risk===ACTION_RISK.AUTOMATIC){
      audit("high-impact-policy-allowed",{capability:input.name,actionType:classification.type});
      return {allowed:true,reason:"automatic"};
    }
    if(!approvalStore){
      audit("high-impact-policy-denied",{capability:input.name,actionType:classification.type,reason:"approval-store-unavailable"});
      return {allowed:false,reason:"approval-required"};
    }
    const request=approvalRequest(input,classification);
    const approval=await approvalStore.request(request);
    if(!approval?.approved){
      audit("high-impact-policy-pending",{capability:input.name,actionType:classification.type,approvalId:approval?.id||null,missionId:request.missionId});
      return {allowed:false,reason:"approval-required",approvalId:approval?.id||null};
    }
    audit("high-impact-policy-allowed",{capability:input.name,actionType:classification.type,approvalId:approval.id,missionId:request.missionId});
    return {allowed:true,reason:"approved",approvalId:approval.id};
  };
}
