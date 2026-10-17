# venv/bin/python -I paper/analysis/local_complete.py <results/MACHINE> [...]
#
# Post-freeze analysis code (not frozen; HANDOFF section 3 step 3). Completeness of a local
# machine (Mac, EPYC box): check_complete.py sees only groups that wrote a jobs.json, so a
# group dropped by the owner is invisible to it. Here every line of groups-heldout.jsonl is
# matched to run-state.jsonl by run.sh's group ID (first 16 hex digits of the SHA-256 of the
# line). Each group must be "ok"; a dropped group carries a "note". Prints counts only.
import collections, hashlib, json, os, sys


def main(root):
    lines = [l.rstrip('\n') for l in open(os.path.join(root, 'groups-heldout.jsonl')) if l.strip()]
    state = {}
    for l in open(os.path.join(root, 'run-state.jsonl')):
        r = json.loads(l)
        for k, v in r.items():
            if k not in ('name', 'note'):
                state[k] = (v, r.get('note'))  # the last line for an ID wins (a rerun after a failure)
    by = collections.Counter()
    notes, missing = [], []
    for l in lines:
        gid = hashlib.sha256(l.encode()).hexdigest()[:16]
        g = json.loads(l)
        tag = next((g['args'][i + 1] for i, a in enumerate(g.get('args', [])) if a == '--tag'), g['name'])
        sets = [os.path.basename(g['args'][i + 1]) for i, a in enumerate(g.get('args', [])) if a == '--set']
        st, note = state.get(gid, (None, None))
        if st != 'ok':
            missing.append(f'{gid} {tag} {",".join(sets)} state={st}')
        elif note:
            notes.append(f'{gid} {tag} {",".join(sets)}: {note[:90]}')
        by[(tag, 'dropped' if note else st or 'missing')] += 1
    print(f'{root}: {len(lines)} planned groups')
    for (tag, st), n in sorted(by.items()):
        print(f'  {tag:22s} {st:8s} {n}')
    print(f'dropped by note: {len(notes)}')
    for n in notes:
        print('  ' + n)
    print(f'not ok: {len(missing)}')
    for m in missing:
        print('  ' + m)
    return 1 if missing else 0


if __name__ == '__main__':
    sys.exit(max(main(r) for r in sys.argv[1:]))
