function conversationIdentity(url){
 try{const u=new URL(url),m=u.pathname.match(/^\/c\/([^/?#]+)/);return {origin:u.origin,conversationId:m?.[1]||null,key:m?.[1]?`${u.origin}/c/${m[1]}`:`${u.origin}${u.pathname}`}}catch{return null}
}
async function exec(tabId,func,args=[]){const r=await chrome.scripting.executeScript({target:{tabId},func,args});return r?.[0]?.result}
function pageProbe(){
 const assistant=[...document.querySelectorAll('[data-message-author-role="assistant"]')];
 const stop=!!document.querySelector('button[data-testid="stop-button"],button[aria-label*="Stop generating" i]');
 const composer=document.querySelector('#prompt-textarea,[contenteditable="true"][data-lexical-editor="true"],textarea');
 return {assistantCount:assistant.length,generating:stop,composerReady:!!composer,lastText:(assistant.at(-1)?.innerText||"").slice(-12000)};
}
function sendPrompt(text){
 const el=document.querySelector('#prompt-textarea,[contenteditable="true"][data-lexical-editor="true"],textarea');if(!el)return false;
 el.focus();if(el.tagName==="TEXTAREA"){el.value=text;el.dispatchEvent(new Event("input",{bubbles:true}))}else{el.innerHTML="";document.execCommand("insertText",false,text);el.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:text}))}
 const b=document.querySelector('[data-testid="send-button"],button[aria-label*="Send" i]');if(b&&!b.disabled){b.click();return true}el.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",code:"Enter",bubbles:true,cancelable:true}));return true;
}
export function createConversationService(){
 return {
  capabilities:["conversation_identity","send","observe"],
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
  async review({conversation,payload,timeoutMs=180000,pollMs=750}){
   const instruction=typeof payload==="string"?payload:JSON.stringify(payload,null,2);
   const before=await this.observe(conversation);
   await this.send({conversation,instruction,idempotencyKey:payload?.reviewId||payload?.review_id||payload?.id||null});
   const started=Date.now();
   while(Date.now()-started<timeoutMs){
    await new Promise(resolve=>setTimeout(resolve,pollMs));
    const current=await this.observe(conversation);
    if((current?.assistantCount||0)>(before?.assistantCount||0)&&!current?.generating&&String(current?.lastText||"").trim()){
     const text=String(current.lastText).trim();
     let parsed=null;
     const fenced=text.match(/```(?:json)?\\s*([\\s\\S]*?)```/i);
     const candidate=(fenced?.[1]||text).trim();
     try{parsed=JSON.parse(candidate)}catch{
      const object=candidate.match(/\\{[\\s\\S]*\\}/);
      if(object)try{parsed=JSON.parse(object[0])}catch{}
     }
     return {ok:true,text,parsed,assistantCount:current.assistantCount,at:Date.now()};
    }
   }
   const e=new Error("Work supervisor response timed out");e.code="WORK_RESPONSE_TIMEOUT";throw e;
  }
 };
}
export function bindConversation(tabId){
 return chrome.tabs.get(tabId).then(tab=>{const id=conversationIdentity(tab.url||"");if(!id)throw new Error("Cannot bind conversation");return {...id,tabId,title:tab.title||"",boundAt:Date.now()}});
}
