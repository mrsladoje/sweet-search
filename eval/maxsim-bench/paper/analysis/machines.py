# venv/bin/python -I paper/analysis/machines.py
#
# Post-freeze analysis code (not frozen). Hardware and software facts per platform for the
# paper's machine table, from machine.txt (cloud shards), machine-heldout.txt (local) and
# the env block of the result records (load.py caches). Writes NO host identifiers: the
# fields kept are listed in KEEP; instance IDs, host IDs, host names and addresses are
# dropped. Hosts per type are counted, not named.
import glob, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import PLATFORMS, OUT, dump, available, cache  # noqa: E402

CLOUD = os.path.expanduser('~/.ss-eval/maxsim-cloud/s8')
LOCAL = os.path.expanduser('~/.ss-eval/maxsim-local')
KEEP = ('instance-type', 'Model name', 'Thread(s) per core', 'Core(s) per socket', 'Socket(s)', 'CPU(s)', 'L1d cache', 'L2 cache',
        'L3 cache', 'NUMA node(s)', 'Hypervisor vendor', 'governor')
FLAGS = ('avx2', 'fma', 'avx512f', 'avx512bw', 'avx512vl', 'avx512_bf16', 'amx_tile', 'amx_bf16', 'asimd', 'sve', 'sve2', 'bf16', 'i8mm')


def parse(path):
    kv, flags, tools = {}, [], {}
    for line in open(path, errors='replace'):
        line = line.rstrip('\n')
        m = re.match(r'^([A-Za-z0-9()/ _-]+?):\s+(.*)$', line)
        if m and m.group(1).strip() in KEEP:
            kv[m.group(1).strip()] = m.group(2).strip()
        elif line.startswith('Flags:'):
            have = set(line.split(':', 1)[1].split())
            flags = [f for f in FLAGS if f in have]
        elif '=' in line and line.split('=', 1)[0] in KEEP:
            kv[line.split('=', 1)[0]] = line.split('=', 1)[1]
        elif line.startswith('rust='):
            for part in re.findall(r'(\w+)=(.*?)(?=\s\w+=|$)', line):
                tools[part[0]] = part[1].strip()
    return kv, flags, tools


def main():
    res = {}
    for p in PLATFORMS:
        files = (sorted(glob.glob(os.path.join(CLOUD, f'{p}-[0-9]*', 'machine.txt'))) + glob.glob(os.path.join(CLOUD, f'{p}-replica', 'machine.txt'))
                 if p in ('intel', 'amd', 'arm') else glob.glob(os.path.join(LOCAL, p, 'machine*.txt')))
        if not files:
            continue
        kv, flags, tools = parse(files[0])
        hosts = set()
        for f in files:
            for line in open(f, errors='replace'):
                if line.startswith('placement/host-id='):
                    hosts.add(line.strip())
        d = dict(facts=kv, flags=flags, tools=tools, machine_files=len(files), distinct_hosts=len(hosts) or None)
        if available(p):
            env = cache(p)['agent-ho']['arms']['ours']['env']
            d['platform'] = env.get('platform'); d['python'] = env.get('python'); d['numpy'] = env.get('numpy')
            d['cpu'] = env.get('cpu'); d['cpu_count'] = env.get('cpu_count')
            blas = {}
            for s in ('agent-ho',):
                for arm, a in cache(p)[s]['arms'].items():
                    for tp in a['env'].get('threadpools') or []:
                        blas[f"{arm}:{tp.get('user_api')}"] = f"{tp.get('internal_api')} {tp.get('version')} ({tp.get('num_threads')} threads)"
            d['threadpools_agent_ho'] = blas
        res[p] = d
    dump('machines.json', res)
    for p, d in res.items():
        print(p, d['facts'], d['flags'], d['tools'], 'files', d['machine_files'], 'hosts', d['distinct_hosts'], d.get('platform'))


if __name__ == '__main__':
    main()
