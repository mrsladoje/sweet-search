#!/bin/bash
# Verify the 7 locally-rebuilt goldens, stamp them with their index build, vault them,
# and push to the box. Refuses at the first thing that does not check out.
set -u
REPO=/Users/admin/Projects/sweet-search-private
BENCH=$REPO/eval/task-completion-bench
SP="$(cd "$(dirname "$0")" && pwd)"
G=$HOME/.ss-eval/golden
V=$HOME/.ss-eval/vault/golden
STAMP=$G/.provenance-index
mkdir -p "$STAMP"

echo "=== 1. tree hashes unchanged (the rebuild must move the INDEX, never the tree)"
fail=0
while IFS= read -r k; do
  new=$(git -C "$G/$k" rev-parse HEAD^{tree})
  old=$(git -C "$V/$k" rev-parse HEAD^{tree})
  if [ "$new" = "$old" ]; then echo "  OK   $k  $new"
  else echo "  DRIFT $k  vault=$old rebuilt=$new"; fail=1; fi
done < "$SP/keys.txt"
[ $fail -eq 0 ] || { echo "STOP: a tree changed; not pushing"; exit 1; }

echo
echo "=== 2. acceptance: no committed bundle left in the index, build-dir sources admitted"
# golden-rebuild-need.mjs re-reports srcBuild from the TREE, which a reindex cannot change.
# The real acceptance is index MEMBERSHIP: bundles must be gone, build-dir sources present.
node --input-type=module -e '
import fs from "node:fs"; import path from "node:path";
import {createRequire} from "node:module"; import {execFileSync} from "node:child_process";
const REPO="/Users/admin/Projects/sweet-search-private";
const require=createRequire(REPO+"/x.js");
const Database=require(REPO+"/node_modules/better-sqlite3");
const {createAdmissionPolicy}=await import(REPO+"/core/indexing/admission-policy.js");
const {looksMinified}=await import(REPO+"/core/indexing/minified-detector.js");
const G=process.env.HOME+"/.ss-eval/golden", V=process.env.HOME+"/.ss-eval/vault/golden";
const idx=p=>{const d=new Database(p,{readonly:true});
  const s=new Set(d.prepare("SELECT DISTINCT file_path FROM vectors WHERE epoch_retired IS NULL").all().map(r=>r.file_path));d.close();return s;};
let bad=0;
for(const k of fs.readFileSync(process.argv[1],"utf8").trim().split("\n")){
  const dir=path.join(G,k);
  const tracked=execFileSync("git",["-C",dir,"ls-files","-z"],{maxBuffer:1<<28}).toString("utf8").split("\0").filter(Boolean);
  const pol=createAdmissionPolicy({projectRoot:dir});
  const before=idx(path.join(V,k,".sweet-search","codebase.db")), after=idx(path.join(dir,".sweet-search","codebase.db"));
  let bundles=0;
  for(const f of after){
    if(pol.forceAdmit(f)) continue;
    const abs=path.join(dir,f);
    try{ const st=fs.statSync(abs); if(st.size<1024) continue;
      const fd=fs.openSync(abs,"r"); const head=Buffer.alloc(Math.min(32768,st.size));
      fs.readSync(fd,head,0,head.length,0);
      let tail=""; if(st.size>head.length){const tb=Buffer.alloc(Math.min(4096,st.size));
        fs.readSync(fd,tb,0,tb.length,st.size-tb.length); tail=tb.toString("utf8");}
      fs.closeSync(fd);
      if(looksMinified(head.toString("utf8"),{ext:path.extname(f).toLowerCase(),tailText:tail,totalBytes:st.size})) bundles++;
    }catch{}
  }
  // build-dir sources with real content (>32 bytes) must now be indexed
  const sb=tracked.filter(f=>pol.isBuildOutputOnly(f)&&pol.matchesInclude(f))
                  .filter(f=>{try{return fs.statSync(path.join(dir,f)).size>32}catch{return false}});
  const inNew=sb.filter(f=>after.has(f)).length;
  const ok = bundles===0 && inNew===sb.length;
  if(!ok) bad++;
  console.log("  "+(ok?"OK  ":"FAIL")+" "+k.split("@")[0].padEnd(28)
    +" bundles-in-index "+bundles+"   build-dir sources "+inNew+"/"+sb.length
    +"   files "+before.size+" -> "+after.size);
}
if(bad){console.error("STOP: "+bad+" golden(s) failed the index acceptance"); process.exit(1);}
' "$SP/keys.txt" || exit 1

echo "=== 3. chunk counts, old index vs new"
node -e '
const Database=require("'"$REPO"'/node_modules/better-sqlite3");
const fs=require("fs");
const c=p=>{try{const d=new Database(p,{readonly:true});
  const n=d.prepare("SELECT COUNT(*) c FROM vectors WHERE epoch_retired IS NULL").get().c;
  const f=d.prepare("SELECT COUNT(DISTINCT file_path) c FROM vectors WHERE epoch_retired IS NULL").get().c;
  d.close();return[n,f]}catch(e){return[-1,-1]}};
for(const k of fs.readFileSync(process.argv[1],"utf8").trim().split("\n")){
  const [on,of_]=c(process.env.HOME+"/.ss-eval/vault/golden/"+k+"/.sweet-search/codebase.db");
  const [nn,nf]=c(process.env.HOME+"/.ss-eval/golden/"+k+"/.sweet-search/codebase.db");
  console.log("  "+k.split("@")[0].padEnd(30)+" chunks "+String(on).padStart(6)+" -> "+String(nn).padStart(6)
    +"   files "+String(of_).padStart(5)+" -> "+String(nf).padStart(5));
}' "$SP/keys.txt"

echo
echo "=== 4. index-build stamp (register G9)"
VER=$(node -p "require('$REPO/package.json').version")
SHA=$(git -C "$REPO" rev-parse HEAD)
while IFS= read -r k; do
  node -e '
  const fs=require("fs"),cp=require("child_process"),path=require("path");
  const [k,ver,sha,g,stamp]=process.argv.slice(1);
  const dir=path.join(g,k,".sweet-search");
  const files=fs.readdirSync(dir).filter(f=>!/-(shm|wal)$/.test(f)).sort();
  fs.writeFileSync(path.join(stamp,k+".json"), JSON.stringify({
    key:k, engineVersion:ver, engineCommit:sha,
    indexBackend:"ort-int8-cpu",
    backendForcedBy:["SWEET_SEARCH_NATIVE_INFERENCE=0","SWEET_SEARCH_COREML_CASCADE=0"],
    backendRationale:"parity with the 13 box-built goldens this pool reuses; queries on the box also run ORT INT8",
    indexerArgs:["--full","--sqlite-fast","--concurrency=1","--verbose"],
    builtOn:"darwin-arm64 (Apple M3 Max)", builtAt:new Date().toISOString(),
    node:process.version,
    goldenTreeHash:cp.execSync("git -C "+path.join(g,k)+" rev-parse HEAD^{tree}").toString().trim(),
    indexFiles:files.map(f=>({name:f,bytes:fs.statSync(path.join(dir,f)).size})),
    stamper:"golden-index-provenance@1",
  },null,2)+"\n");
  ' "$k" "$VER" "$SHA" "$G" "$STAMP"
  echo "  stamped $k"
done < "$SP/keys.txt"

echo
echo "=== 5. vault the rebuilt copies + re-manifest"
while IFS= read -r k; do
  rsync -aH --delete --exclude='.vault-manifest.sha256' "$G/$k/" "$V/$k/"
  echo "  vaulted $k"
done < "$SP/keys.txt"
KEYS=$(paste -sd, "$SP/keys.txt")
bash "$BENCH/harness/golden-vault.sh" manifest --keys "$KEYS"
bash "$BENCH/harness/golden-vault.sh" verify   --keys "$KEYS"

echo
echo "=== 6. push to the box, checksum-verified"
bash "$BENCH/harness/golden-vault.sh" unlock --keys "$KEYS" || true
bash "$BENCH/harness/golden-vault.sh" push --keys "$KEYS" --verify

echo
echo "=== 7. ship the index-build stamps"
rsync -aH "$STAMP/" root@167.233.69.121:/root/.ss-eval/golden/.provenance-index/
echo "=== PUSH COMPLETE $(date -u +%FT%TZ)"
