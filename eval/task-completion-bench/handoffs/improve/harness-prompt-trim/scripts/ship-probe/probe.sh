#!/usr/bin/env bash
# probe.sh <name> <port> [capture_cc_runner args...]  -> captures into ship-probe/<name>
O=${PROBE_OUT:-$PWD/ship-probe-out}
S=$(cd "$(dirname "$0")/.." && pwd)
N=$1; PORT=$2; shift 2
rm -rf "$O/$N"; mkdir -p "$O/$N"
python3 $S/capture_proxy.py $PORT "$O/$N" > "$O/$N.proxy.log" 2>&1 & P=$!
sleep 1
node $S/capture_cc_runner.mjs --out "$O/$N" --port $PORT --oauth "$@" > "$O/$N.run.log" 2>&1
kill $P 2>/dev/null
python3 - "$O/$N" <<'PY'
import json,os,sys
d=sys.argv[1]; f=sorted(x for x in os.listdir(d) if x.startswith('req'))
if not f: print('NO REQUEST'); sys.exit()
b=json.load(open(os.path.join(d,f[0])))
sysb=b.get('system') or []
print('requests',len(f),'| system blocks',len(sysb),'| system chars',sum(len(x.get('text','')) for x in sysb),'| tools',len(b.get('tools',[])),'| body chars',len(json.dumps(b)))
PY
