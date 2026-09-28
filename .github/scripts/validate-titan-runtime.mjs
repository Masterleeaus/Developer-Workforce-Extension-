import {mkdtempSync,readdirSync,readFileSync,rmSync,statSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename,dirname,extname,join,normalize,resolve} from "node:path";
import {spawnSync} from "node:child_process";

const repoRoot=resolve(process.cwd());
const packageRoot=resolve(repoRoot,"hehggadaopoacecdllhhajmbjkdcmajg/1.26.901.11451_0");
const errors=[];

function walk(dir,predicate,out=[]){
 if(!statSafe(dir)?.isDirectory())return out;
 for(const name of readdirSync(dir)){
  const p=join(dir,name),s=statSafe(p);
  if(s?.isDirectory())walk(p,predicate,out);
  else if(s?.isFile()&&predicate(p))out.push(p);
 }
 return out;
}
function statSafe(p){try{return statSync(p)}catch{return null}}
function rel(p){return p.startsWith(repoRoot)?p.slice(repoRoot.length+1):p}

function runtimeFiles(){
 const files=new Set();
 const sidepanel=join(packageRoot,"codex-sidepanel");
 for(const p of walk(join(sidepanel,"titan-workforce"),p=>[".js",".mjs"].includes(extname(p))))files.add(p);
 for(const p of walk(join(packageRoot,"titan-workforce"),p=>extname(p)===".js"))files.add(p);
 for(const name of readdirSync(sidepanel)){
  const p=join(sidepanel,name),s=statSafe(p);
  if(s?.isFile()&&name.startsWith("titan-")&&[".js",".mjs"].includes(extname(name)))files.add(p);
 }
 for(const name of readdirSync(packageRoot)){
  const p=join(packageRoot,name),s=statSafe(p);
  if(s?.isFile()&&name.startsWith("titan-")&&[".js",".mjs"].includes(extname(name)))files.add(p);
 }
 return [...files].sort();
}

export function checkSyntax(file){
 const r=spawnSync(process.execPath,["--check",file],{encoding:"utf8"});
 return {ok:r.status===0,status:r.status,output:(r.stderr||r.stdout||"").trim()};
}

function importSpecifiers(source){
 const out=[];
 const re=/(?:import|export)\s+(?:[^"'\n]*?\s+from\s+)?["'](\.{1,2}\/[^"']+)["']/g;
 let m;while((m=re.exec(source)))out.push(m[1]);
 return out;
}
function resolveImport(from,spec){
 const base=resolve(dirname(from),spec);
 const candidates=extname(base)?[base]:[base,base+".js",base+".mjs",join(base,"index.js"),join(base,"index.mjs")];
 return candidates.find(p=>statSafe(p)?.isFile())||null;
}

export function validateFile(file){
 const problems=[];
 const syntax=checkSyntax(file);
 if(!syntax.ok)problems.push({kind:"syntax",file:rel(file),detail:syntax.output});
 let source="";
 try{source=readFileSync(file,"utf8")}catch(e){problems.push({kind:"read",file:rel(file),detail:String(e.message||e)});return problems}
 for(const spec of importSpecifiers(source)){
  if(!resolveImport(file,spec))problems.push({kind:"missing-import",file:rel(file),specifier:spec});
 }
 return problems;
}

function negativeSelfTest(){
 const dir=mkdtempSync(join(tmpdir(),"titan-runtime-validator-"));
 try{
  const invalid=join(dir,"invalid.js");writeFileSync(invalid,"const x = ;\n");
  if(checkSyntax(invalid).ok)throw new Error("negative syntax fixture was not rejected");
  const importer=join(dir,"importer.mjs");writeFileSync(importer,'import "./missing.js";\nexport const ok=true;\n');
  const missing=validateFile(importer).some(x=>x.kind==="missing-import");
  if(!missing)throw new Error("negative missing-import fixture was not rejected");
 }finally{rmSync(dir,{recursive:true,force:true})}
}

negativeSelfTest();
const files=runtimeFiles();
if(!files.length)errors.push({kind:"discovery",detail:"No Titan runtime JavaScript files discovered"});
for(const file of files)errors.push(...validateFile(file));

if(errors.length){
 console.error("Titan runtime parse/import validation FAILED");
 for(const e of errors)console.error(JSON.stringify(e));
 process.exit(1);
}
console.log(`Titan runtime parse/import validation PASS (${files.length} files)`);
