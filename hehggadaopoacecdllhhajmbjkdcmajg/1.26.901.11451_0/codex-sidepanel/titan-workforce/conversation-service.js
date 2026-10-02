function conversationIdentity(url){
 try{const u=new URL(url),m=u.pathname.match(/^\/c\/([^/?#]+)/);return {origin:u.origin,conversationId:m?.[1]||null,key:m?.[1]?`${u.origin}/c/${m[1]}`:`${u.origin}${u.pathname}`}}catch{return null}
}
async function exec(tabId,func,args=[]){const r=await chrome.scripting.executeScript({target:{tabId},func,args});return r?.[0]?.result}
function pageProbe(){
 const assistant=[...document.querySelectorAll('[data-message-author-role="assistant"]')];
 const stop=!!document.querySelector('button[data-testid="stop-button"],button[aria-label*="Stop generating" i]');
 const composer=document.querySelector('#prompt-textarea,[contenteditable="true"][data-lexical-editor="true"],textarea');
 const user=[...document.querySelectorAll('[data-message-author-role="user"]')];
 return {assistantCount:assistant.length,generating:stop,composerReady:!!composer,lastText:(assistant.at(-1)?.innerText||"").slice(-12000),lastUserText:(user.at(-1)?.innerText||"").slice(-12000)};
}
function sendPrompt(text){
 const el=document.querySelector('#prompt-textarea,[contenteditable="true"][data-lexical-editor="true"],textarea');if(!el)return false;
 el.focus();if(el.tagName==="TEXTAREA"){el.value=text;el.dispatchEvent(new Event("input",{bubbles:true}))}else{el.innerHTML="";document.execCommand("insertText",false,text);el.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:text}))}
 const b=document.querySelector('[data-testid="send-button"],button[aria-label*="Send" i]');if(b&&!b.disabled){b.click();return true}el.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",code:"Enter",bubbles:true,cancelable:true}));return true;
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitUntil(fn,{timeoutMs=30000,intervalMs=250}={}){
 const start=Date.now();let lastError=null;
 while(Date.now()-start<timeoutMs){try{const value=await fn();if(value)return value}catch(error){lastError=error}await sleep(intervalMs)}
 if(lastError)throw lastError;throw Object.assign(new Error("Conversation readiness timed out"),{code:"CONVERSATION_TIMEOUT"});
}
export function createConversationService(){
 return {
  capabilities:["conversation_identity","send","observe","create"],
  async assertConversation(expected){
   const tabId=expected?.tabId;if(!tabId)throw new Error("Conversation tabId required");
   const tab=await chrome.tabs.get(tabId),actual=conversationIdentity(tab.url||"");
   const key=expected.key||expected.conversationKey;
   if(!actual||!key||actual.key!==key){const e=new Error("Conversation identity mismatch");e.code="CONVERSATION_IDENTITY_MISMATCH";throw e}
   return actual;
  },
  async observe(conversation){
   await this.assertConversation(conversation);return exec(conversation.tabId,pageProbe);
  },
  async send({conversation,instruction,idempotencyKey}){
   await this.assertConversation(conversation);
   const p=await exec(conversation.tabId,pageProbe);if(p?.generating){const e=new Error("Conversation is busy");e.code="CONVERSATION_BUSY";throw e}
   const ok=await exec(conversation.tabId,sendPrompt,[instruction]);if(!ok)throw new Error("Prompt composer unavailable");
   return {ok:true,idempotencyKey,at:Date.now()};
  },
  async review({conversation,payload}){
   const instruction=typeof payload==="string"?payload:JSON.stringify(payload,null,2);
   return this.send({conversation,instruction,idempotencyKey:payload?.reviewId||payload?.id||null});
  },
  async create({initialInstruction,active=false,timeoutMs=30000}={}){
   if(!initialInstruction||typeof initialInstruction!=="string")throw Object.assign(new Error("Initial continuation instruction required"),{code:"CONVERSATION_CONTINUATION_REQUIRED"});
   const tab=await chrome.tabs.create({url:"https://chatgpt.com/",active:!!active});
   if(!tab?.id)throw Object.assign(new Error("Failed to create ChatGPT tab"),{code:"CONVERSATION_CREATE_FAILED"});
   const tabId=tab.id;
   try{
    await waitUntil(async()=>{
     const current=await chrome.tabs.get(tabId);
     if(current.status!=="complete")return null;
     const p=await exec(tabId,pageProbe).catch(()=>null);
     return p?.composerReady?p:null;
    },{timeoutMs});
    const ok=await exec(tabId,sendPrompt,[initialInstruction]);
    if(!ok)throw Object.assign(new Error("Prompt composer unavailable in fresh conversation"),{code:"CONVERSATION_COMPOSER_UNAVAILABLE"});
    const stable=await waitUntil(async()=>{
     const current=await chrome.tabs.get(tabId),identity=conversationIdentity(current.url||"");
     if(!identity?.conversationId)return null;
     return {...identity,tabId,title:current.title||"",boundAt:Date.now()};
    },{timeoutMs});
    return stable;
   }catch(error){
    try{await chrome.tabs.remove(tabId)}catch{}
    throw error;
   }
  }
 };
}
export function bindConversation(tabId){
 return chrome.tabs.get(tabId).then(tab=>{const id=conversationIdentity(tab.url||"");if(!id)throw new Error("Cannot bind conversation");return {...id,tabId,title:tab.title||"",boundAt:Date.now()}});
}
