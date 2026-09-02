#!/usr/bin/env python3
"""e3-tokenise.py — exact o200k_base token cost of the gutter, per delivered block.

For every fenced ss-* code block the agent actually received, tokenise four renderings
of the SAME body inside its real fence context:

  delivered   exactly what went into the context window
  stripped    the same code with no gutter at all      (= the NONE rendering)
  tab         the same code under `N<TAB>`             (= the shipped rendering)
  pipe        the same code under `N| `                (= the A/B rendering)

The gutter's direct token cost is delivered - stripped. The counterfactuals answer
"what would this rollout have paid under another delimiter, with behaviour held fixed".
"""
import gzip, json, os, re, sys
from concurrent.futures import ProcessPoolExecutor

IN = sys.argv[1] if len(sys.argv) > 1 else 'data/blocks.ndjson.gz'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'data/blocks-tok.ndjson'

RE_TAB = re.compile(r'^(\d+)\t')
RE_PIPE = re.compile(r'^(\d+)\| ')

_enc = None
def enc():
    global _enc
    if _enc is None:
        import tiktoken
        _enc = tiktoken.get_encoding('o200k_base')
    return _enc

def strip_body(body, gf):
    if gf == 'none':
        return body, None
    rx = RE_TAB if gf == 'tab' else RE_PIPE
    out, first = [], None
    for ln in body.split('\n'):
        m = rx.match(ln)
        if m:
            if first is None:
                first = int(m.group(1))
            out.append(ln[m.end():])
        else:
            out.append(ln)
    return '\n'.join(out), first

def number(body, start, delim):
    return '\n'.join(f'{start + i}{delim}{ln}' for i, ln in enumerate(body.split('\n')))

# The block always sits between fence lines; tokenising it in that context keeps the
# first-line boundary merge identical to the real request.
def wrap(s):
    return '```\n' + s + '\n```'

def work(chunk):
    e = enc()
    res = []
    for line in chunk:
        b = json.loads(line)
        body, gf = b['body'], b['gf']
        stripped, firstNum = strip_body(body, gf)
        start = b.get('start')
        if start is None:
            start = firstNum if firstNum is not None else 1
        tok_del = len(e.encode(wrap(body)))
        tok_str = len(e.encode(wrap(stripped)))
        tok_tab = tok_del if gf == 'tab' else len(e.encode(wrap(number(stripped, start, '\t'))))
        tok_pip = tok_del if gf == 'pipe' else len(e.encode(wrap(number(stripped, start, '| '))))
        res.append(json.dumps({
            'id': b['id'], 'surf': b['surf'], 'n': b['n'], 'gf': gf,
            'k': b['k'], 'T': b['T'], 'resid': b['resid'], 'weight': b['weight'],
            'tokDel': tok_del, 'tokStrip': tok_str, 'tokTab': tok_tab, 'tokPipe': tok_pip,
        }))
    return res

def main():
    with gzip.open(IN, 'rt', encoding='utf8') as f:
        lines = [l for l in f if l.strip()]
    print(f'{len(lines)} blocks', flush=True)
    CH = 200
    chunks = [lines[i:i + CH] for i in range(0, len(lines), CH)]
    out = []
    with ProcessPoolExecutor(max_workers=os.cpu_count()) as ex:
        for i, r in enumerate(ex.map(work, chunks)):
            out.extend(r)
            if i % 10 == 0:
                print(f'  chunk {i}/{len(chunks)}', flush=True)
    with open(OUT, 'w', encoding='utf8') as f:
        f.write('\n'.join(out) + '\n')
    print('wrote', OUT, len(out))

if __name__ == '__main__':
    main()
