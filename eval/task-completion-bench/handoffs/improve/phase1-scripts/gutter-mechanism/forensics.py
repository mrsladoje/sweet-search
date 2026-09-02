#!/usr/bin/env python3
"""Stage-2: every failed edit on the six tasks, all 9 runs, both arms.
For each: the attempted anchor, the best-matching region on disk (golden base), a
character-level classification of the difference, and the most recent prior tool output
that showed the region (surface + whether the anchor is a faithful copy of what was shown)."""
import json, os, re, sys, collections
sys.path.insert(0,'/tmp/gutter-inv')
from census import (R, RUNS, SIX, walk, jl, text_of, events_codex, events_opencode, events_claude,
                    trace_files, is_edit, classify_fail)
GOLDEN='/root/.ss-eval/golden'
BASE={'jashkenas__underscore-2757':'4bd6f69b33179517d4ff9f6020637d6f336c5f99',
 'pytask-dev__pytask-210':'30227332d58cbe0dc8a055cafd5711eb1cd653d8',
 'rstudio-education__gradethis-161':'2e64380c0e96eff7b3e3a52b0af79cdc5c6b5ec6',
 'teleporthq__teleport-code-generators-291':'ee3baaf6246efd494d6bc406a541edf9d370eacd',
 'ontodev__robot-710':'691d0dd57b97309da2e05b86bc0d6bcace1ecf78',
 'epiforecasts__scoringutils-229':'53436b609c29c7b72016ea645601a21a8ee3564b'}
gdirs=os.listdir(GOLDEN) if os.path.isdir(GOLDEN) else []
def golden_for(task):
    sha=BASE.get(task)
    for d in gdirs:
        if sha and d.endswith('@'+sha): return os.path.join(GOLDEN,d)
    repo=task.split('__',1)[1].rsplit('-',1)[0]
    for d in gdirs:
        if repo in d: return os.path.join(GOLDEN,d)
    return None
def resolve(gold,fp):
    if not gold: return None
    rel=re.sub(r'^/root/\.ss-eval/runs/[^/]+/','',fp).lstrip('./')
    for c in (rel, '/'.join(rel.split('/')[1:])):
        if c and os.path.isfile(os.path.join(gold,c)): return os.path.join(gold,c)
    return None

# ---- anchors
def patch_chunks(patch):
    """[(file,[anchor lines (ctx+old, prefix stripped)], ctx_header)]"""
    out=[]; cur=None; lines=patch.split('\n'); i=0
    while i<len(lines):
        ln=lines[i]
        if ln.startswith('*** Update File: '): cur={'file':ln[len('*** Update File: '):].strip(),'chunks':[]}; out.append(cur); i+=1; continue
        if ln.startswith('*** Add File: ') or ln.startswith('*** Delete File: ') or ln.startswith('*** End Patch') or ln.startswith('*** Begin Patch') or ln.startswith('*** Move to:'):
            if not ln.startswith('*** Move to:'): cur=None if not ln.startswith('*** Update') else cur
            i+=1; continue
        if cur is None: i+=1; continue
        if ln.startswith('@@'):
            hdr=ln[2:].strip(); cur['chunks'].append({'hdr':hdr,'anchor':[],'raw':[]}); i+=1; continue
        if not cur['chunks']: cur['chunks'].append({'hdr':'','anchor':[],'raw':[]})
        ch=cur['chunks'][-1]
        if ln.startswith('*** End of File'): i+=1; continue
        ch['raw'].append(ln)
        if ln.startswith('+'): pass
        elif ln.startswith('-') or ln.startswith(' '): ch['anchor'].append(ln[1:])
        else: ch['anchor'].append(ln)  # no prefix: lenient context
        i+=1
    return [(o['file'],c['anchor'],c['hdr'],c['raw']) for o in out for c in o['chunks']]

def anchors_for(harness,e):
    t=e['tool']; inp=e['input'] or {}
    if harness=='claude':
        if t=='Edit': return [(inp.get('file_path',''),str(inp.get('old_string','')).split('\n'),'',None)]
        if t=='MultiEdit': return [(inp.get('file_path',''),str(x.get('old_string','')).split('\n'),'',None) for x in inp.get('edits',[])]
        return []
    if harness=='opencode':
        if t=='apply_patch': return patch_chunks(str(inp.get('patchText','')))
        if t=='edit': return [(inp.get('filePath',''),str(inp.get('oldString','')).split('\n'),'',None)]
        return []
    if harness=='codex':
        cmd=str(inp.get('cmd') or '')
        m=re.search(r'\*\*\* Begin Patch.*?\*\*\* End Patch',cmd,re.S)
        return patch_chunks(m.group(0)) if m else []
    return []

# ---- gutter stripping for shown outputs
GUT=re.compile(r'^(\s*\d+\t|\d+\| |[^\s:]+:\d+[:-] ?)')
def strip_gutter(line):
    return GUT.sub('',line,count=1)

def classify_line(a,b):
    """a=attempted, b=on disk"""
    if a==b: return []
    d=[]
    ai=re.match(r'^[ \t]*',a).group(0); bi=re.match(r'^[ \t]*',b).group(0)
    if ai!=bi:
        if ('\t' in ai)!=('\t' in bi): d.append('indent TAB<->SPACE')
        else: d.append(f'indent {len(bi)}->{len(ai)} ({len(ai)-len(bi):+d})')
    at=re.search(r'[ \t]*$',a).group(0); bt=re.search(r'[ \t]*$',b).group(0)
    if at!=bt: d.append('trailing-ws '+('stripped' if len(bt)>len(at) else 'added'))
    if a.strip()!=b.strip():
        if re.sub(r'\s+','',a)==re.sub(r'\s+','',b): d.append('interior-ws')
        else: d.append('BODY differs')
    return d

def best_window(src_lines, anchor):
    """find start index in src_lines whose window best matches anchor (fewest differing lines)"""
    A=[x for x in anchor]
    while A and A[-1]=='' : A=A[:-1]
    if not A: return None
    first=next((x for x in A if x.strip()),None)
    if first is None: return None
    cands=[i for i,l in enumerate(src_lines) if l.strip()==first.strip()]
    if not cands:
        # fuzzy: first 20 non-space chars
        key=re.sub(r'\s+','',first)[:20]
        cands=[i for i,l in enumerate(src_lines) if key and key in re.sub(r'\s+','',l)]
    best=None
    off=A.index(first)
    for i in cands:
        s=i-off
        if s<0: continue
        win=src_lines[s:s+len(A)]
        diffs=sum(1 for k in range(len(A)) if (win[k] if k<len(win) else None)!=A[k])
        if best is None or diffs<best[1]: best=(s,diffs)
    return best

def main():
    rows=[]
    for run,harness in RUNS.items():
        asd=os.path.join(R,run,'agent-state')
        if not os.path.isdir(asd): continue
        for cell in sorted(os.listdir(asd)):
            m=re.match(r'(.*)-(sweet|native)$',cell)
            if not m: continue
            task,arm=m.groups()
            if task not in SIX: continue
            gold=golden_for(task)
            for f in trace_files(run,harness,cell):
                ev={'codex':events_codex,'opencode':events_opencode,'claude':events_claude}[harness](f)
                shown=[]  # (idx, surface, text)
                for idx,e in enumerate(ev):
                    if e['kind']!='result': continue
                    out=e.get('output') or ''
                    # record what surface this output is
                    t=e['tool'] or ''; inp=e['input'] or {}
                    cmd=str(inp.get('cmd') or inp.get('command') or '')
                    surf=None
                    if harness=='claude' and t=='Read': surf='native-Read'
                    elif harness=='opencode' and t=='read': surf='native-read'
                    elif re.search(r'\bss-read\b',cmd): surf='ss-read'
                    elif re.search(r'\bss-grep\b',cmd): surf='ss-grep'
                    elif re.search(r'\bss-search\b',cmd): surf='ss-search'
                    elif re.search(r'\bss-semantic\b',cmd): surf='ss-semantic'
                    elif re.search(r'\bss-find\b',cmd): surf='ss-find'
                    elif re.search(r'\b(cat|sed|nl|head|tail|grep|rg|awk)\b',cmd): surf='shell:'+re.search(r'\b(cat|sed|nl|head|tail|grep|rg|awk)\b',cmd).group(1)
                    elif t in ('exec_command','bash','Bash'): surf='shell:other'
                    if surf and out: shown.append((idx,surf,out))
                    et=is_edit(harness,e)
                    if not et: continue
                    fl=[k for k in classify_fail(harness,e) if k in ('cc:not-found','ap:expected-lines','ap:context','oc:oldstring-notfound')]
                    if not fl: continue
                    # which anchor failed? for apply_patch use the error's quoted lines to pick the chunk
                    errout=out
                    anchors=anchors_for(harness,e)
                    failed=[]
                    mm=re.search(r'Failed to find expected lines in (\S+):\n(.*)',errout,re.S)
                    if mm:
                        q=mm.group(2).split('\n')
                        # match chunk whose anchor equals quoted (trim trailing)
                        for a in anchors:
                            if [x for x in a[1] if True][:len(q)]==q[:len(a[1])] or '\n'.join(a[1]).startswith('\n'.join(q[:2])):
                                failed.append(a); break
                        if not failed and anchors: failed=[(mm.group(1),q,'',None)]
                    else:
                        failed=anchors
                    for (fp,anchor,hdr,raw) in failed:
                        rec={'run':run,'harness':harness,'arm':arm,'task':task,'tool':et,'kind':fl,'file':fp,'anchor':anchor[:6],'n_anchor':len(anchor),'hdr':hdr}
                        # gutter residue in anchor?
                        rec['gutter_residue']=any(re.match(r'^\s*\d+(\t|\| )',x) for x in anchor)
                        abs_=resolve(gold,fp)
                        rec['golden']=bool(abs_)
                        if abs_:
                            src=open(abs_,encoding='utf8',errors='replace').read()
                            sl=src.split('\n')
                            if '\n'.join(anchor) in src: rec['disk']='EXACT-IN-BASE (file changed by earlier edit, or not-unique)'
                            else:
                                bw=best_window(sl,anchor)
                                if bw is None: rec['disk']='NO CANDIDATE (first line absent from base)'
                                else:
                                    s,nd=bw; win=sl[s:s+len(anchor)]
                                    kinds=collections.Counter()
                                    ex=None
                                    for k in range(len(anchor)):
                                        b=win[k] if k<len(win) else ''
                                        for c in classify_line(anchor[k],b): kinds[c]+=1
                                        if ex is None and anchor[k]!=b: ex=(k,anchor[k],b)
                                    rec['disk']=f'base line {s+1}, {nd}/{len(anchor)} lines differ: {dict(kinds)}'
                                    rec['first_diff']=ex
                        # provenance: most recent prior output whose gutter-stripped lines contain the first anchor line trimmed
                        first=next((x for x in anchor if x.strip()),'')
                        prov=None
                        for (sidx,surf,txt) in reversed(shown):
                            if sidx>=idx: continue
                            ls=txt.split('\n')
                            for k,l in enumerate(ls):
                                if l.strip()==first.strip() or strip_gutter(l).strip()==first.strip():
                                    stripped=strip_gutter(l)
                                    g='tab' if re.match(r'^\s*\d+\t',l) else 'pipe' if re.match(r'^\d+\| ',l) else 'grep' if re.match(r'^[^\s:]+:\d+[:-]',l) else 'none'
                                    # compare the whole anchor to the shown window (stripped)
                                    win=[strip_gutter(x) for x in ls[k:k+len(anchor)]]
                                    faithful=(win==anchor) or (win[:len(anchor)-1]==anchor[:-1] and anchor[-1]=='' )
                                    # naive strip: strip only 'N|' keep space
                                    naive=[re.sub(r'^\d+\|','',x,count=1) for x in ls[k:k+len(anchor)]]
                                    rec['prov']={'surface':surf,'gutter':g,'shown_first':l[:90],'faithful_copy':faithful,'matches_naive_pipe_strip':(g=='pipe' and naive==anchor)}
                                    prov=True; break
                            if prov: break
                        if not prov: rec['prov']=None
                        rows.append(rec)
    # print
    for r in rows:
        print(f"\n### {r['run']} {r['arm']} {r['task']} [{r['tool']}] {r['kind']} file={os.path.basename(r['file'])} n_anchor={r['n_anchor']} hdr={r['hdr']!r} residue={r['gutter_residue']}")
        for a in r['anchor'][:4]: print(f"    anchor: {a!r}")
        print(f"    disk: {r.get('disk')}")
        if r.get('first_diff'): k,a,b=r['first_diff']; print(f"    first diff @+{k}: attempted={a!r}\n                  ondisk   ={b!r}")
        print(f"    prov: {r.get('prov')}")
    json.dump(rows,open('/tmp/gutter-inv/forensics.json','w'),default=str)
    # summary
    print('\n\n===== SUMMARY =====')
    agg=collections.defaultdict(collections.Counter)
    for r in rows:
        key=f"{r['harness']}/{r['arm']}/{r['run']}"
        d=r.get('disk','?')
        cls='exact-in-base' if d.startswith('EXACT') else 'no-candidate' if d.startswith('NO') else 'body' if 'BODY' in d else 'indent' if 'indent' in d else 'trailing' if 'trailing' in d else 'interior' if 'interior' in d else 'other:'+d[:30]
        agg[key][cls]+=1
        agg[key]['prov:'+((r['prov'] or {}).get('surface','none')+'/'+(r['prov'] or {}).get('gutter','-'))]+=1
        if (r['prov'] or {}).get('matches_naive_pipe_strip'): agg[key]['NAIVE-PIPE-STRIP']+=1
        if (r['prov'] or {}).get('faithful_copy'): agg[key]['faithful-copy-of-shown']+=1
    for k,v in sorted(agg.items()): print(k, dict(v))
if __name__=="__main__": main()
