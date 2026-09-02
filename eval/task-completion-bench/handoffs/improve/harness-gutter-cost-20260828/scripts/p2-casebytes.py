#!/usr/bin/env python3
"""p2 — independent re-read of individual edit-failure cases, raw bytes.

Reads a claude-code / opencode / codex transcript directly (no shared helper),
pulls the named tool call, its result, and every earlier tool output that shows
the anchor's first line, and diffs against the golden file on disk.
"""
import json, sys, os, re, argparse

RES = '/root/sweet-search-private/eval/task-completion-bench/results'
GOLD = '/root/.ss-eval/golden'

def esc(s):
    return s.replace('\\', '\\\\').replace('\t', '\\t').replace('\n', '\\n')

def load_jsonl(p):
    out = []
    with open(p, 'r', errors='replace') as f:
        for ln in f:
            ln = ln.strip()
            if not ln: continue
            try: out.append(json.loads(ln))
            except Exception: pass
    return out

# ---------- claude-code ----------
def cc_blocks(recs):
    """Yield (kind, block, rec_index). Dedup by tool_use.id / tool_result.tool_use_id."""
    seen_use, seen_res = set(), set()
    for i, r in enumerate(recs):
        msg = r.get('message') or {}
        content = msg.get('content')
        if not isinstance(content, list): continue
        for b in content:
            if not isinstance(b, dict): continue
            t = b.get('type')
            if t == 'tool_use':
                if b.get('id') in seen_use: continue
                seen_use.add(b.get('id')); yield ('use', b, i)
            elif t == 'tool_result':
                if b.get('tool_use_id') in seen_res: continue
                seen_res.add(b.get('tool_use_id')); yield ('res', b, i)
            elif t == 'text':
                yield ('text', b, i)

def res_text(b):
    c = b.get('content')
    if isinstance(c, str): return c
    if isinstance(c, list):
        return '\n'.join(x.get('text','') for x in c if isinstance(x, dict))
    return ''

def cc_case(transcript, call_id, anchor_first=None, ctx=6):
    recs = load_jsonl(os.path.join(RES, transcript))
    blocks = list(cc_blocks(recs))
    idx = None
    for n, (k, b, i) in enumerate(blocks):
        if k == 'use' and b.get('id') == call_id:
            idx = n; break
    if idx is None:
        print(f'!! call_id {call_id} not found in {transcript}'); return
    k, use, _ = blocks[idx]
    inp = use.get('input') or {}
    print('=' * 100)
    print('TRANSCRIPT', transcript)
    print('CALL      ', call_id, 'tool =', use.get('name'))
    print('FILE      ', inp.get('file_path'))
    old = inp.get('old_string')
    if old is None:
        print('INPUT KEYS', list(inp.keys()))
    else:
        print('--- old_string, raw bytes, line by line ---')
        for j, ln in enumerate(old.split('\n')[:ctx]):
            print(f'  a{j:<2} {esc(ln)!r}')
        if len(old.split('\n')) > ctx: print(f'  ... {len(old.split(chr(10)))} lines total')
    # result
    for n in range(idx+1, len(blocks)):
        k2, b2, _ = blocks[n]
        if k2 == 'res' and b2.get('tool_use_id') == call_id:
            print('--- tool_result ---')
            print(' ', res_text(b2)[:400].replace('\n', '\\n'))
            break
    # provenance: earlier outputs containing the anchor's first line (stripped)
    probe = anchor_first if anchor_first is not None else (old.split('\n')[0] if old else None)
    if probe is not None:
        pstr = probe.strip()
        if len(pstr) >= 8:
            print('--- earlier tool outputs containing', repr(pstr[:60]), '---')
            hits = 0
            for n in range(idx-1, -1, -1):
                k2, b2, _ = blocks[n]
                if k2 != 'res': continue
                txt = res_text(b2)
                if pstr in txt:
                    for ln in txt.split('\n'):
                        if pstr in ln:
                            print(f'  [block {n}] {esc(ln)!r}')
                            hits += 1
                            break
                    if hits >= 3: break
            if hits == 0: print('  (never shown in any earlier tool_result)')
    return inp

def gold_lines(task, path, around=None, n=3):
    """path is the jail path /root/.ss-eval/runs/rN-M/<rel>; map to golden."""
    rel = re.sub(r'^/root/\.ss-eval/runs/[^/]+/', '', path)
    # find golden dir for task
    import glob
    owner_repo = task.rsplit('-', 1)[0]
    cands = glob.glob(os.path.join(GOLD, owner_repo + '@*'))
    if not cands:
        print('  !! no golden for', task); return None
    gp = os.path.join(cands[0], rel)
    if not os.path.exists(gp):
        print('  !! golden file missing', gp); return None
    with open(gp, 'r', errors='replace') as f:
        lines = f.read().split('\n')
    print('--- golden', gp)
    if around:
        for i in range(max(0, around-1-n), min(len(lines), around-1+n+1)):
            print(f'  disk {i+1:<5} {esc(lines[i])!r}')
    return lines

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--cases', required=True, help='json file of cases')
    a = ap.parse_args()
    cases = json.load(open(a.cases))
    for c in cases:
        inp = cc_case(c['transcript'], c['call_id'], c.get('anchor_first'))
        if inp and c.get('base_line'):
            gold_lines(c['task'], inp.get('file_path',''), c['base_line'])
        print()
