#!/usr/bin/env python3
"""Surface-coverage audit over the full 13-task rb runs (sweet arm): code lines delivered per
surface and gutter form, sub-15 blocks, and harness-side truncation."""
import json, os, re, sys, collections
sys.path.insert(0,'/tmp/gutter-inv')
from census import R, jl, events_codex, events_opencode, events_claude, trace_files
RB={'rb-codex-20260825':'codex','rb-opencode-20260824':'opencode','rb-claudecode-20260824':'claude'}
GUT_TAB=re.compile(r'^\s*\d+\t'); GUT_PIPE=re.compile(r'^\d+\| '); GREP=re.compile(r'^[^\s:]+:\d+[:-]')
def fenced_blocks(lines):
    """yield (header_line_before_fence, body_lines) for each ``` fenced block"""
    i=0
    while i<len(lines):
        if lines[i].startswith('```'):
            hdr=lines[i-1] if i>0 else ''
            j=i+1; body=[]
            while j<len(lines) and not lines[j].startswith('```'): body.append(lines[j]); j+=1
            yield hdr,body; i=j+1
        else: i+=1
def main():
    for run,harness in RB.items():
        agg=collections.Counter(); blocks=collections.Counter(); trunc=collections.Counter(); calls=collections.Counter()
        asd=os.path.join(R,run,'agent-state')
        for cell in sorted(os.listdir(asd)):
            if not cell.endswith('-sweet'): continue
            for f in trace_files(run,harness,cell):
                ev={'codex':events_codex,'opencode':events_opencode,'claude':events_claude}[harness](f)
                for e in ev:
                    if e['kind']!='result': continue
                    out=e.get('output') or ''; inp=e['input'] or {}
                    cmd=str(inp.get('cmd') or inp.get('command') or '')
                    tools=re.findall(r'\bss-(?:read|grep|search|semantic|find|trace)\b',cmd)
                    for t in tools: calls[t]+=1
                    lines=out.split('\n')
                    # truncation evidence
                    if harness=='codex':
                        m=re.search(r'Original token count: (\d+)',out)
                        cap=inp.get('max_output_tokens')
                        if m and cap and int(m.group(1))>int(cap): trunc['codex:over-cap']+=1
                        if re.search(r'omitted|\.\.\. \[|truncated \d+|tokens? truncated',out,re.I) and 'see the rest' not in out: trunc['codex:marker']+=1
                    if harness=='opencode':
                        for mm in re.findall(r'[^\n]{0,60}truncated[^\n]{0,60}',out):
                            if 'see the rest' in mm: continue
                            trunc['oc:'+re.sub(r'\d+','N',mm.strip())[:70]]+=1
                    if harness=='claude':
                        for mm in re.findall(r'[^\n]{0,40}lines truncated[^\n]{0,40}',out): trunc['cc:'+re.sub(r'\d+','N',mm.strip())[:70]]+=1
                    # surfaces
                    surf=None
                    if tools: surf=tools[0]
                    elif harness=='claude' and e['tool']=='Read': surf='native-Read'
                    elif harness=='opencode' and e['tool']=='read': surf='native-read'
                    elif re.search(r'\b(cat -n|nl |sed -n|grep -n|rg -n)',cmd): surf='shell-read'
                    if not surf: continue
                    if surf in ('ss-read','ss-search','ss-semantic','ss-find'):
                        for hdr,body in fenced_blocks(lines):
                            if not body: continue
                            g='tab' if GUT_TAB.match(body[0]) else 'pipe' if GUT_PIPE.match(body[0]) else 'none'
                            n=len(body)
                            kind='ss-read' if hdr.startswith('# ss-read') else 'ss-search-hit' if hdr.startswith('## #') or hdr.startswith('```') or 'score=' in hdr else 'ss-semantic-span' if hdr.startswith('-- ') else surf+'-block'
                            blocks[f"{kind}/{g}/{'<15' if n<15 else '>=15'}"]+=1
                            agg[f"lines:{kind}/{g}"]+=n
                    elif surf=='ss-grep':
                        n=sum(1 for l in lines if GREP.match(l)); agg['lines:ss-grep/grep-colon']+=n
                        n2=sum(1 for l in lines if GUT_TAB.match(l) or GUT_PIPE.match(l)); agg['lines:ss-grep/gutter']+=n2
                    else:
                        n=sum(1 for l in lines if GUT_TAB.match(l)); agg[f'lines:{surf}/tab']+=n
                        n2=sum(1 for l in lines if not GUT_TAB.match(l) and l.strip()); agg[f'lines:{surf}/none']+=n2
        print(f"\n===== {run} ({harness}, sweet, 13 tasks)")
        print("  calls:",dict(calls))
        print("  blocks:"); [print(f"     {v:5d} {k}") for k,v in sorted(blocks.items())]
        print("  lines:"); [print(f"     {v:7d} {k}") for k,v in sorted(agg.items())]
        print("  truncation:"); [print(f"     {v:5d} {k}") for k,v in sorted(trunc.items())]
if __name__=="__main__": main()
