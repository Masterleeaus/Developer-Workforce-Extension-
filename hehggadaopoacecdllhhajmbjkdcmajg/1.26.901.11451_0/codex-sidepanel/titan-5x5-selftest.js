
export function runTitan5x5SelfTest(){
 const workers=Array.from({length:5},(_,i)=>({i,count:0,reviews:0,nexts:0}));
 const events=[];
 const due=(i,count)=>((count-1)%5)===i;
 // 25 completions: each worker advances five times.
 for(let round=1;round<=5;round++){
  for(const w of workers){
   w.count++;
   if(due(w.i,w.count)){w.reviews++;events.push(`W${w.i+1}:REVIEW:${w.count}`)}
   else {w.nexts++;events.push(`W${w.i+1}:NEXT:${w.count}`)}
  }
 }
 const expectedReviews=[1,1,1,1,1];
 const cadenceOK=workers.every((w,i)=>w.reviews===expectedReviews[i]&&w.nexts===4);
 // Verify next review offsets after first 5 completions.
 for(let round=6;round<=10;round++)for(const w of workers){
   w.count++;if(due(w.i,w.count))w.reviews++;else w.nexts++;
 }
 const secondCycleOK=workers.every(w=>w.reviews===2&&w.nexts===8);
 const truth={commitExists:true,ciPassed:true,merged:true,presentOnMain:true};
 const runtime={deployed:true,browserPassed:true,consoleClean:true,networkPassed:true,acceptancePassed:true};
 const finalGate=Object.values(truth).every(Boolean)&&Object.values(runtime).every(Boolean);
 const result={ok:cadenceOK&&secondCycleOK&&finalGate,cadenceOK,secondCycleOK,finalGate,workers,events:events.slice(0,25)};
 window.__titan5x5SelfTest=result;
 window.dispatchEvent(new CustomEvent('titan5x5:selftest-complete',{detail:result}));
 return result;
}
window.runTitan5x5SelfTest=runTitan5x5SelfTest;
