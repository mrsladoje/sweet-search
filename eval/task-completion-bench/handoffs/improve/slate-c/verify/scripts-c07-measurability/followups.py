# c07-measurability: attribute the 18 truncation-attributable follow-up requests
# to the cut class (ss-read vs ss-search) and the envelope shape (single vs &&).
# Input: forensics/scripts-codex-cap-x-ss/codex-cap-x-ss.json (343 truncated outputs).
import json, collections, sys
p = sys.argv[1] if len(sys.argv) > 1 else 'codex-cap-x-ss.json'
d = json.load(open(p))
sw = [x for x in d['cases'] if x['cell'] == 'sweet']
def cls(x):
    ms = x.get('markers') or []
    return '/'.join(sorted(set(m.get('class') for m in ms if m.get('class')))) or 'unknown'
print('sweet truncations:', len(sw))
print('cut classes:', dict(collections.Counter(cls(x) for x in sw)))
print('single-command cuts:', sum(1 for x in sw if x['subcmds'] == 1),
      dict(collections.Counter(cls(x) for x in sw if x['subcmds'] == 1)))
fa = [x for x in sw if x.get('any_a_req3') or x.get('any_c_req3')]
print('cuts producing a class-(a)/(c) follow-up within 3 requests:', len(fa))
print('  by cut class:', dict(collections.Counter(cls(x) for x in fa)))
print('  single-command:', sum(1 for x in fa if x['subcmds'] == 1))
print('  total request-counts: a=%d c=%d  usd=$%.5f' % (
      sum(x.get('a_req_req3', 0) for x in sw),
      sum(x.get('c_req_req3', 0) for x in sw),
      sum(x.get('a_usd_req3', 0) + x.get('c_usd_req3', 0) for x in sw)))
addr = [x for x in fa if x['subcmds'] == 1 and cls(x) == 'ss-search']
print('ADDRESSABLE (single-command ss-search cuts with follow-ups): n=%d requests=%d usd=$%.5f' % (
      len(addr), sum(x.get('a_req_req3', 0) + x.get('c_req_req3', 0) for x in addr),
      sum(x.get('a_usd_req3', 0) + x.get('c_usd_req3', 0) for x in addr)))
for x in fa:
    print('  %-40s rep%s call%3d %-9s sub=%s a=%s c=%s' % (
          x['task'], x['rep'], x['call_index'], cls(x), x['subcmds'],
          x.get('a_req_req3'), x.get('c_req_req3')))
