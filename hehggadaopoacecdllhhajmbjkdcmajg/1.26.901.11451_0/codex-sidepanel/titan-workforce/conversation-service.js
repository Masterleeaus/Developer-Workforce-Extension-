export const SUPPORTED_CHATGPT_ORIGINS=Object.freeze(["https://chatgpt.com"]);
const CONVERSATION_ID_RE=/^[A-Za-z0-9_-]{1,160}$/;

export function conversationIdentity(url){
 try{
  const u=new URL(url);
  if(!SUPPORTED_CHATGPT_ORIGINS.includes(u.origin))return null;
  const m=u.pathname.match(/^\/c\/([^/?#]+)\/?$/);
  const conversationId=m?.[1]||null;
  if(!conversationId||!CONVERSATION_ID_RE.test(conversationId))return null;
  return {origin:u.origin,conversationId,path:u.pathname,key:`${u.origin}/c/${conversationId}`,surface:"chatgpt_conversation"};
 }catch{return null}
}

function expectedIdentity(expected){
 if(!expected||typeof expected!=="object")return null;
 if(expected.origin&&expected.conversationId){
  return conversationIdentity(`${expected.origin}/c/${expected.conversationId}`);
 }
 if(expected.key)return conversationIdentity(expected.key);
 return null;
}

async function exec(tabId,func,args=[]){
 const r=await chrome.scripting.executeScript({target:{tabId},func,args});return r?.[0]?.result
}

function pageProbe(expectedConversationId){
 const m=location.origin==="https://chatgpt.com"&&location.pathname.match(/^\/c\/([^/?#]+)\/?$/);
 const identityMatches=!!m&&m[1]===expectedConversationId;
 const assistant=[...document.querySelectorAll('[data-message-author-role="assistant"]')];
 const stop=!!document.querySelector('button[data-testid="stop-button"],button[aria-label*="Stop generating" i]');
 const composer=document.querySelector('#prompt-textarea');
 return {assistantCount:assistant.length,generating:stop,composerReady:!!composer,identityMatches,lastText:(assistant.at(-1)?.innerText||"").slice(-12000)};
}

function sendPrompt(text,expectedConversationId){
 const m=location.origin==="https://chatgpt.com"&&location.pathname.match(/^\/c\/([^/?#]+)\/?$/);
 if(!m||m[1]!==expectedConversationId)return {ok:false,reason:"identity-mismatch"};
 if(document.querySelector('button[data-testid="stop-button"],button[aria-label*="Stop generating" i]'))return {ok:false,reason:"busy"};
 const el=document.querySelector('#prompt-textarea');if(!el)return {ok:false,reason:"composer-unavailable"};
 el.focus();
 if(el.tagName==="TEXTAREA"){
  el.value=text;el.dispatchEvent(new Event("input",{bubbles:true}));
 }else{
  el.innerHTML="";document.execCommand("insertText",false,text);el.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:text}));
 }
 const b=document.querySelector('[data-testid="send-button"]');
 if(b&&!b.disabled){b.click();return {ok:true}}
 el.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",code:"Enter",bubbles:true,cancelable:true}));
 return {ok:true};
}

function identityError(message,details={}){
 const e=new Error(message);e.code="CONVERSATION_IDENTITY_MISMATCH";Object.assign(e,details);return e;
}

export function createConversationService(){
 return {
  capabilities:["conversation_identity","send","observe"],
  async assertConversation(expected){
   const tabId=expected?.tabId;if(!tabId)throw identityError("Conversation tabId required");
   const wanted=expectedIdentity(expected);if(!wanted)throw identityError("Unsupported or unstable conversation identity",{expected});
   const tab=await chrome.tabs.get(tabId),actual=conversationIdentity(tab.url||"");
   if(!actual||actual.key!==wanted.key)throw identityError("Conversation identity mismatch",{expectedKey:wanted.key,actualKey:actual?.key||null,tabId});
   return {...actual,tabId};
  },
  async observe(conversation){
   const actual=await this.assertConversation(conversation);
   const probe=await exec(actual.tabId,pageProbe,[actual.conversationId]);
   if(!probe?.identityMatches)throw identityError("Conversation page identity mismatch",{tabId:actual.tabId,expectedConversationId:actual.conversationId});
   return probe;
  },
  async send({conversation,instruction,idempotencyKey}){
   if(typeof instruction!=="string"||!instruction.trim())throw new Error("Instruction is required");
   const actual=await this.assertConversation(conversation);
   const p=await exec(actual.tabId,pageProbe,[actual.conversationId]);
   if(!p?.identityMatches)throw identityError("Conversation page identity mismatch",{tabId:actual.tabId,expectedConversationId:actual.conversationId});
   if(p?.generating){const e=new Error("Conversation is busy");e.code="CONVERSATION_BUSY";throw e}
   if(!p?.composerReady){const e=new Error("Prompt composer unavailable");e.code="COMPOSER_UNAVAILABLE";throw e}
   const result=await exec(actual.tabId,sendPrompt,[instruction,actual.conversationId]);
   if(!result?.ok){
    if(result?.reason==="busy"){const e=new Error("Conversation is busy");e.code="CONVERSATION_BUSY";throw e}
    if(result?.reason==="identity-mismatch")throw identityError("Conversation changed before send",{tabId:actual.tabId,expectedConversationId:actual.conversationId});
    const e=new Error("Prompt composer unavailable");e.code="COMPOSER_UNAVAILABLE";throw e;
   }
   return {ok:true,idempotencyKey,at:Date.now(),conversationKey:actual.key};
  },
  async review({conversation,payload}){
   const instruction=typeof payload==="string"?payload:JSON.stringify(payload,null,2);
   return this.send({conversation,instruction,idempotencyKey:payload?.reviewId||payload?.id||null});
  }
 };
}

export function bindConversation(tabId){
 return chrome.tabs.get(tabId).then(tab=>{
  const id=conversationIdentity(tab.url||"");
  if(!id)throw identityError("Tab is not a supported ChatGPT conversation",{tabId,url:tab.url||null});
  return {...id,tabId,title:tab.title||"",boundAt:Date.now()}
 });
}
