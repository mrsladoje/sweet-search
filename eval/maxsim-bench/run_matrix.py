# python3 run_matrix.py --tag NAME --set DIR [--set DIR ...] --arm SPEC [--arm SPEC ...]
#                        [--rounds 2] [--reps 5] [--gap-ms 0] [--max-load 0] [bench options]
#
# Runs every arm on the same calls, ONE ARM PER PROCESS, in rounds: round 0 in the
# given order, round 1 reversed, later rounds shuffled (seed 42). Slow drift (thermal
# state, background load) therefore hits every arm about equally; analyze_final.py
# takes each call's median over the rounds. Results: results/<tag>/<arm>.r<round>.json.
#
# Arm specs: "<bench.py arm>[@threads]" (e.g. ours, ours@1, maxsim_cpu_3d@12,
# numpy_packed@1), "ours~VARIANT[@threads]" (our kernel from the C-ABI library
# $SS_CAPI_DIR/VARIANT.{dylib,so}: an experimental build) or "node:<bench-node.mjs
# arm>" (node:production, node:js, ...).
# --max-busy P: before each run, wait until the machine's CPU use (sampled over 1 s,
# % of all CPUs) is below P, so other work does not leak into the timing (the wait
# and the sampled value are logged); 0 = don't wait.
import argparse, json, os, random, subprocess, sys, time

p = argparse.ArgumentParser()
p.add_argument('--tag', required=True)
p.add_argument('--set', action='append', required=True)
p.add_argument('--arm', action='append', required=True)
p.add_argument('--rounds', type=int, default=2)
p.add_argument('--reps', type=int, default=5)
p.add_argument('--gap-ms', type=float, default=0.0)
p.add_argument('--max-busy', type=float, default=0.0)
p.add_argument('--limit', type=int, default=0)
p.add_argument('--stride', type=int, default=1)
p.add_argument('--prewarm-lead-us', type=float, default=0.0)
a = p.parse_args()

HERE = os.path.dirname(os.path.abspath(__file__))
PY = os.path.join(HERE, 'venv', 'bin', 'python')
out_dir = os.path.join(HERE, 'results', a.tag); os.makedirs(out_dir, exist_ok=True)
rng = random.Random(42)
log = open(os.path.join(out_dir, 'matrix.log'), 'a')


def cpu_busy():
    """% of all CPUs in use over the next second."""
    if sys.platform == 'darwin':
        out = subprocess.run(['top', '-l', '2', '-s', '1', '-n', '0'], capture_output=True, text=True).stdout
        idle = [l for l in out.splitlines() if l.startswith('CPU usage')][-1].split(',')[-1]
        return 100.0 - float(idle.strip().split('%')[0])
    def snap():
        v = [int(x) for x in open('/proc/stat').readline().split()[1:]]
        return sum(v), v[3] + v[4]
    t0, i0 = snap(); time.sleep(1); t1, i1 = snap()
    return 100.0 * (1 - (i1 - i0) / max(1, t1 - t0))


def say(msg):
    line = f"{time.strftime('%H:%M:%S')} {msg}"
    print(line, flush=True); log.write(line + '\n'); log.flush()


say(f"start tag={a.tag} arms={a.arm} sets={a.set} rounds={a.rounds} reps={a.reps} gap={a.gap_ms}")
for r in range(a.rounds):
    order = list(a.arm) if r == 0 else list(reversed(a.arm)) if r == 1 else rng.sample(a.arm, len(a.arm))
    for spec in order:
        name = spec.replace(':', '-').replace('@', '@t').replace('~', '~')
        dest = os.path.join(out_dir, f'{name}.r{r}.json')
        if os.path.exists(dest):
            say(f'skip {dest} (exists)'); continue
        if a.max_busy:
            t0 = time.time()
            while (busy := cpu_busy()) > a.max_busy:
                time.sleep(10)
            say(f'cpu busy {busy:.1f}% before {spec}' + (f' (waited {time.time() - t0:.0f}s)' if time.time() - t0 > 2 else ''))
        common = ['--out', dest, '--reps', str(a.reps), '--gap-ms', str(a.gap_ms), '--limit', str(a.limit), '--stride', str(a.stride)]
        sets = [x for s in a.set for x in ('--set', s)]
        env = dict(os.environ)
        if spec.startswith('node:'):
            cmd = ['node', os.path.join(HERE, 'bench-node.mjs'), '--arm', spec[5:]] + common + sets
        else:
            arm, _, threads = spec.partition('@')
            if '~' in arm:
                arm, variant = arm.split('~')
                env['SS_CAPI'] = os.path.join(os.environ['SS_CAPI_DIR'], variant + ('.dylib' if sys.platform == 'darwin' else '.so'))
            cmd = [PY, '-I', os.path.join(HERE, 'bench.py'), '--arm', arm, '--threads', threads or '0', '--prewarm-lead-us', str(a.prewarm_lead_us)] + common + sets
        res = subprocess.run(cmd, capture_output=True, text=True, env=env)
        tail = (res.stdout.strip().splitlines() or [''])[-1]
        say(f'r{r} {spec}: {tail}' if res.returncode == 0 else f'r{r} {spec}: FAILED rc={res.returncode} {res.stderr.strip()[-400:]}')
say('done')
