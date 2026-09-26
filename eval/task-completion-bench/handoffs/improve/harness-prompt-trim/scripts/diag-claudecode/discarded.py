"""Cost of discarded (non-kept) attempts. Opus: token-priced from transcript usage (in $4, cache read $0.2,
cache write 1h $8, out $20 per M -- the turns-file price + 2x write). Luna: OpenRouter generation bill."""
import glob, json, os, sys
sys.path.insert(0, '..')
R = '/Users/admin/Projects/sweet-search-private/eval/task-completion-bench/results'
from parse import RUNS
import importlib.util
spec = importlib.util.spec_from_file_location('kb', '../kept_billed.py')
src = open('../kept_billed.py').read().split('for run in sys.argv[1:]:')[0]
ns = {}; exec(src, ns)
def usage_cost(f):
    seen = {}; 
    for l in open(f):
        r = json.loads(l); m = r.get('message') or {}
        if m.get('role') == 'assistant' and m.get('usage') and m.get('id'): seen[m['id']] = m['usage']
    c = 0
    for u in seen.values():
        c += (u.get('input_tokens', 0) * 4 + u.get('cache_read_input_tokens', 0) * 0.2 + u.get('cache_creation_input_tokens', 0) * 8 + u.get('output_tokens', 0) * 20) / 1e6
    return c, len(seen)
for run, bb, leg, cont in RUNS:
    for cell in sorted(glob.glob(f'{R}/{run}/agent-state/*-sweet')):
        mains = sorted(glob.glob(f'{cell}/claude-home/projects/*/*.jsonl'), key=os.path.getmtime)
        for f in mains[:-1]:
            if bb == 'opus':
                c, n = usage_cost(f); src = 'tokens'
            else:
                gids = ns['ids'](f); c = sum((ns['gen_cost'](g) or 0) for g in gids); n = len(gids); src = 'billed'
                sid = os.path.basename(f)[:-6]
                for s in glob.glob(f'{os.path.dirname(f)}/{sid}/subagents/*.jsonl'):
                    g2 = ns['ids'](s); c += sum((ns['gen_cost'](g) or 0) for g in g2); n += len(g2)
            print(json.dumps({'leg': leg, 'task': os.path.basename(cell)[:-6], 'discardedUsd': round(c, 4), 'requests': n, 'src': src}))
