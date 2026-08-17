// Does the checker only say NO, or does it say WHAT? Starting from the one-quadrant patch
// the arms actually wrote, repeatedly admit exactly the states the counterexamples name and
// re-run. If it converges on the reference allow-sets, the counterexample list is a
// specification of the fix rather than a bare rejection.
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os"; import path from "node:path";
import { analyze } from "/root/w0-p4-statecheck.mjs";
const B="/root/sweet-search-private/eval/task-completion-bench";
const spec=JSON.parse(readFileSync(B+"/select/.cache/tasks_full_luna_rotate20.json","utf8")).find(t=>t.instance_id==="apple__swift-nio-http2-145");
const gold="/root/.ss-eval/golden/apple__swift-nio-http2@"+spec.base_commit;
const FILE="Sources/NIOHTTP2/StreamStateMachine.swift";
function after(patch){ const d=mkdtempSync(path.join(tmpdir(),"cv-"));
  try{ execFileSync("bash",["-c",`git -C ${gold} archive HEAD | tar -x -C ${d}`]);
    if(patch) execFileSync("git",["-C",d,"apply","--whitespace=nowarn","-"],{input:patch});
    return readFileSync(path.join(d,FILE),"utf8"); } finally { rmSync(d,{recursive:true,force:true}); } }
const base=after(null);
const goldAllow=analyze(after(spec.patch),base).allow;
const rec=JSON.parse(readFileSync(B+"/results/sb-codex-20260811/sweet/patches.json","utf8")).find(p=>p.instance_id==="apple__swift-nio-http2-145");
let text=after(rec.patch);
// admit(state, op): move a state into the operation`s allowing arm, the way a maintainer would
const PAT={ halfOpenLocalPeerIdle:".halfOpenLocalPeerIdle(localWindow: _, localContentLength: _, remoteWindow: _)",
  halfClosedLocalPeerIdle:".halfClosedLocalPeerIdle(remoteWindow: _)",
  halfOpenRemoteLocalIdle:".halfOpenRemoteLocalIdle(localWindow: _, remoteContentLength: _, remoteWindow: _)",
  halfClosedRemoteLocalIdle:".halfClosedRemoteLocalIdle(localWindow: _)" };
function admit(t,fn,state){ const at=t.indexOf(`mutating func ${fn}(`); const e=t.indexOf("\n    mutating func ",at+10);
  const stop=e<0?t.length:e; let b=t.slice(at,stop);
  const sw=b.indexOf("switch self.state {"); const fc=b.indexOf("case ",sw);
  b=b.slice(0,fc+5)+PAT[state]+",\n             "+b.slice(fc+5);
  const rj=b.lastIndexOf("case ."); const re=new RegExp(`\\.${state}\\b(?!\\()\\s*,\\s*`,"g");
  b=b.slice(0,rj)+b.slice(rj).replace(re,"");
  return t.slice(0,at)+b+t.slice(stop); }
for(let round=1; round<=6; round++){
  const r=analyze(text,base);
  console.log(`round ${round}: recv=${r.allow.receivePushPromise.length} send=${r.allow.sendPushPromise.length} counterexamples=${r.findings.length}`);
  for(const f of r.findings) console.log(`   [${f.rule}] admit ${f.state} to ${f.op}`);
  if(!r.findings.length){
    const same=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
    console.log("\nCONVERGED after "+(round-1)+" rounds of following the counterexamples");
    console.log("matches the reference allow-sets exactly: "+
      (same(r.allow.receivePushPromise,goldAllow.receivePushPromise)&&same(r.allow.sendPushPromise,goldAllow.sendPushPromise)));
    break; }
  for(const f of r.findings) text=admit(text,f.op,f.state);
}
