# python3 wait_quiet.py [--minutes 10] [--max-busy 10]
# Blocks until the machine has been quiet for --minutes in a row: CPU use (sampled
# each ~15 s, % of all CPUs) always below --max-busy and, on macOS, running on AC
# power. Logs samples that reset the window (and every 20th busy one), then the time
# it got quiet.
import argparse, subprocess, sys, time

p = argparse.ArgumentParser()
p.add_argument('--minutes', type=float, default=10)
p.add_argument('--max-busy', type=float, default=10)
a = p.parse_args()


def cpu_busy():
    if sys.platform == 'darwin':
        out = subprocess.run(['top', '-l', '2', '-s', '1', '-n', '0'], capture_output=True, text=True).stdout
        idle = [l for l in out.splitlines() if l.startswith('CPU usage')][-1].split(',')[-1]
        return 100.0 - float(idle.strip().split('%')[0])
    def snap():
        v = [int(x) for x in open('/proc/stat').readline().split()[1:]]
        return sum(v), v[3] + v[4]
    t0, i0 = snap(); time.sleep(1); t1, i1 = snap()
    return 100.0 * (1 - (i1 - i0) / max(1, t1 - t0))


def on_ac():
    if sys.platform != 'darwin':
        return True
    return 'AC Power' in subprocess.run(['pmset', '-g', 'batt'], capture_output=True, text=True).stdout


start = None
n = 0
while True:
    n += 1
    busy, ac = cpu_busy(), on_ac()
    now = time.time()
    if busy < a.max_busy and ac:
        start = start or now
        if now - start >= a.minutes * 60:
            print(f"{time.strftime('%H:%M:%S')} quiet for {a.minutes} min (last sample {busy:.1f}% busy)", flush=True)
            break
    else:
        if start is not None or n % 20 == 1:
            print(f"{time.strftime('%H:%M:%S')} not quiet: {busy:.1f}% busy, AC={ac}", flush=True)
        start = None
    time.sleep(14)
