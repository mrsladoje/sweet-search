#!/bin/bash
# final-boxcheck.sh -- read-only verification of refuted/weakened panel claims (tag: final)
# Runs on the evidence box. Writes nothing under results/. Scratch under /tmp/fp-inv/final/.
set -u
mkdir -p /tmp/fp-inv/final
R=/root/sweet-search-private/eval/task-completion-bench/results

echo "===== 1. claude-code 2.1.218 binary: read-before-edit gate and tab separator gate ====="
B=/root/.local/share/claude/versions/2.1.218
ls -la "$B" 2>&1 | head -3
file "$B" 2>&1 | head -2
echo "--- gate string"
grep -a -o 'File has not been read yet[^"]\{0,60\}' "$B" | head -2
echo "--- model set (grg)"
grep -a -o 'grg=new Set(\[[^]]*\])' "$B" | head -2
echo "--- gate function around the throw (200 chars each side)"
grep -a -o '.\{260\}File has not been read yet' "$B" | head -1 | tail -c 400
echo
echo "--- tengu_tab_read_sep"
grep -a -o '.\{120\}tengu_tab_read_sep.\{60\}' "$B" | head -2
echo "--- Edit prompt strip sentence"
grep -a -o 'Strip the Read line prefix[^.]\{0,160\}' "$B" | head -2

echo
echo "===== 2. rows.json: keys, degenReran, idxSource, harness-version field ====="
node - <<'EOF'
const fs=require('fs');
const R='/root/sweet-search-private/eval/task-completion-bench/results/';
const runs=['fp-codex-tab-20260826','fp-opencode-tab-20260826','fp-claudecode-tab-20260826','fp-claudecode-none-20260826','fp-claudecode-pipe-20260826','rb-claudecode-20260824','rp-oc-tab-20260827'];
for (const r of runs){
  let rows; try{rows=JSON.parse(fs.readFileSync(R+r+'/rows.json'))}catch(e){console.log(r,'ERR',e.message);continue}
  const keys=Object.keys(rows[0]||{});
  const dg={}; for(const x of rows.filter(x=>x.degenReran)) dg[x.arm]=(dg[x.arm]||0)+1;
  const idx=[...new Set(rows.map(x=>x.idxSource))];
  const ver=keys.filter(k=>/version|harnessv|cliv|apipath|provider|transport/i.test(k));
  const nullRes=rows.filter(x=>x.resolved==null).length;
  const nullF2p=rows.filter(x=>x.f2pFrac==null).length;
  console.log(r,'n='+rows.length,'degenReran='+JSON.stringify(dg),'idxSource='+JSON.stringify(idx),'versionLikeKeys='+JSON.stringify(ver),'nullResolved='+nullRes,'nullF2p='+nullF2p,'model='+[...new Set(rows.map(x=>x.model))].join('|'));
  if(r==='fp-codex-tab-20260826') console.log('  KEYS:',keys.join(','));
}
EOF

echo
echo "===== 3. pool, controls in pilot logs, b2 goldens ====="
echo "--- pool.txt"; cat /root/fresh-run/pool.txt | tr '\n' ' '; echo
echo "--- control ids in pilot logs (count of files mentioning each)"
for c in scoringutils parcels robot zlint dot-prop; do n=$(grep -l -- "$c" /root/fresh-run/*.log 2>/dev/null | wc -l); echo "  $c: $n files"; done
echo "--- goldens for bfgroup (dates)"
ls -la --time-style=long-iso /root/.ss-eval/golden/ 2>/dev/null | grep -i bfgroup | head -5
echo "--- .jam files in the b2 golden, and src/build"
G=$(ls -d /root/.ss-eval/golden/bfgroup__b2@* 2>/dev/null | head -1); echo "golden=$G"
if [ -n "$G" ]; then find "$G" -name '*.jam' -not -path '*/.git/*' | wc -l; ls "$G/src/build" 2>/dev/null | head -3; ls -la "$G/src/tools/stage.jam" 2>/dev/null; fi
echo "--- indexed .jam rows in codebase.db (if sqlite3 present)"
DB=$(find "$G" -maxdepth 2 -name 'codebase.db' 2>/dev/null | head -1); echo "db=$DB"
if [ -n "$DB" ] && command -v sqlite3 >/dev/null; then sqlite3 "$DB" "select count(*) from vectors" 2>/dev/null; sqlite3 "$DB" "select count(*) from vectors where file like '%.jam'" 2>/dev/null; sqlite3 "$DB" "select count(*) from vectors where file like '%src/build/%'" 2>/dev/null; fi

echo
echo "===== 4. codex silent carry: bytes of call_ADEK3QSj7eIywkhn1mkeUSfv ====="
python3 - <<'EOF'
import json,glob,re
fs=glob.glob('/root/sweet-search-private/eval/task-completion-bench/results/fp-codex-tab-20260826/agent-state/devlooped__moq-1262-sweet/codex-home/sessions/2026/08/27/rollout-2026-08-27T00-34-45-01a040a4-*.jsonl')
print('files',fs)
gold='/root/.ss-eval/golden/devlooped__moq@eef6e1b8f9686f227e247956f4b235f9774f0afc/src/Moq/ExpressionComparer.cs'
try:
    gl=open(gold,encoding='utf-8',errors='replace').read().split('\n')
    print('gold line 36:',repr(gl[35]))
except Exception as e: print('gold read err',e)
for f in fs:
    calls={}
    outs={}
    shown=[]
    for line in open(f,encoding='utf-8',errors='replace'):
        try: rec=json.loads(line)
        except: continue
        p=rec.get('payload') or {}
        t=p.get('type')
        if t=='function_call':
            calls[p.get('call_id')]=p
        elif t=='function_call_output':
            outs[p.get('call_id')]=p
            o=p.get('output') or ''
            if isinstance(o,str) and '\tif (x is MemberExpression)' in o:
                for l in o.split('\n'):
                    if 'if (x is MemberExpression)' in l: shown.append(l)
    cid='call_ADEK3QSj7eIywkhn1mkeUSfv'
    c=calls.get(cid)
    if not c: print('call not found'); continue
    args=c.get('arguments') or ''
    try: a=json.loads(args); cmd=a.get('cmd') or a.get('command') or str(a)
    except: cmd=args
    for l in cmd.split('\n'):
        if 'if (x is MemberExpression)' in l: print('PATCH LINE :',repr(l))
    o=outs.get(cid,{}).get('output') or ''
    print('OUTPUT head:',repr(o[:200]))
    print('earlier showings of that line in tool outputs:')
    for s in shown[:4]: print('   ',repr(s))
EOF

echo
echo "===== 5. harness versions on the box today ====="
(codex --version 2>/dev/null || /root/.local/bin/codex --version 2>/dev/null) | head -1
(opencode --version 2>/dev/null || /root/.local/bin/opencode --version 2>/dev/null) | head -1
(/root/.local/bin/claude --version 2>/dev/null || claude --version 2>/dev/null) | head -1
echo "===== done ====="
