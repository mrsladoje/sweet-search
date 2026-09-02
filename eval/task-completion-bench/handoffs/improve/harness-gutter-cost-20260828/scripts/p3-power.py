#!/usr/bin/env python3
"""p3-power: null spread and power of the '+/-6 of 66' bar, from the fresh-pool solve matrices.
Solve matrices copied from 04-resolution-{codex,opencode,claude-code}.md (reps solved of 3 per task, per arm).
Two estimates:
 (a) task-bootstrap of the difference between two SWEET forms (same treatment => null): resample 22 tasks
     with replacement, recompute total(formA) - total(formB).
 (b) parametric: treat each task's per-rep solve prob as its pooled empirical rate over the 4 arms (12 reps),
     draw two fresh 66-rollout cells, difference. Then power for a treatment that lowers every non-dead,
     non-ceiling task's rate by delta_p so the expected loss is ~6 rollouts.
"""
import random, statistics, itertools
random.seed(20260828)
codex = {
 'absinthe':(3,3,3,3),'registry':(3,3,3,3),'protoactor':(3,3,3,3),'aws-actions':(3,3,3,3),'axelrod':(3,3,3,3),
 'rn-paper':(3,3,3,3),'nmt':(3,3,3,3),'final-form':(3,3,3,3),'tablib':(3,3,3,3),'mathnet':(3,3,3,3),'ariadne':(3,3,3,3),
 'awslabs':(3,1,3,3),'jts':(3,3,2,3),'accenture':(0,1,1,1),'aiohttp':(0,0,1,1),'moq':(1,1,1,1),'b2-113':(1,0,0,0),
 'b2-259':(0,0,0,0),'fastify':(0,0,0,0),'markup-it':(0,0,0,0),'spectator':(0,0,0,0),'solhint':(0,0,0,0)}
opencode = {
 'absinthe':(3,3,3,3),'accenture':(2,1,1,2),'aiohttp':(0,1,0,0),'registry':(3,3,3,2),'protoactor':(3,3,3,3),
 'aws-actions':(3,3,3,3),'awslabs':(2,3,2,1),'axelrod':(3,3,3,3),'b2-113':(1,0,0,0),'b2-259':(0,0,0,0),
 'rn-paper':(3,3,3,3),'nmt':(3,3,3,3),'moq':(0,0,0,0),'fastify':(0,0,0,0),'final-form':(3,3,3,3),'markup-it':(0,0,0,0),
 'spectator':(0,0,0,0),'tablib':(3,3,3,3),'jts':(3,3,3,3),'mathnet':(3,3,3,3),'ariadne':(3,3,3,3),'solhint':(0,0,0,0)}
claude = {
 'absinthe':(3,3,3,3),'registry':(3,3,3,3),'protoactor':(3,3,3,3),'aws-actions':(3,3,3,3),'axelrod':(3,3,3,3),
 'rn-paper':(3,3,3,3),'final-form':(3,3,3,3),'tablib':(3,3,3,3),'jts':(3,3,3,3),'mathnet':(3,3,3,3),'ariadne':(3,3,3,3),
 'accenture':(3,2,3,1),'awslabs':(2,3,2,2),'nmt':(3,2,3,3),'aiohttp':(1,0,0,0),'b2-113':(1,0,0,0),'b2-259':(0,0,0,0),
 'moq':(0,0,0,0),'fastify':(0,0,0,0),'markup-it':(0,0,0,0),'spectator':(0,0,0,0),'solhint':(0,0,0,0)}
ARMS=['native','TAB','NONE','PIPE']
def totals(m): return [sum(v[i] for v in m.values()) for i in range(4)]
def boot_null(m, a, b, B=20000):
    tasks=list(m.values()); diffs=[]
    for _ in range(B):
        s=[random.choice(tasks) for _ in tasks]
        diffs.append(sum(t[a] for t in s)-sum(t[b] for t in s))
    diffs.sort()
    sd=statistics.pstdev(diffs); p6=sum(1 for d in diffs if abs(d)>=6)/B
    return sd, p6, diffs[int(0.025*B)], diffs[int(0.975*B)]
def parametric(m, delta=0.0, B=20000, bar=6):
    # pooled per-task rate over 12 reps; treatment lowers rate on tasks with 0<p<1 (the discriminating ones)
    rates=[sum(v)/12 for v in m.values()]
    hits=0; losses=[]
    for _ in range(B):
        a=sum(1 for p in rates for _ in range(3) if random.random()<p)
        b=sum(1 for p in rates for _ in range(3) if random.random()<max(0.0,p-delta if 0<p<1 else p))
        d=b-a; losses.append(d)
        if d<=-bar: hits+=1
    return hits/B, statistics.mean(losses), statistics.pstdev(losses)
for name,m in [('codex',codex),('opencode',opencode),('claude-code',claude)]:
    print(f'== {name}: totals native/TAB/NONE/PIPE = {totals(m)}')
    for a,b in [(1,2),(1,3),(2,3),(0,1)]:
        sd,p6,lo,hi=boot_null(m,a,b)
        print(f'   task-bootstrap {ARMS[a]}-{ARMS[b]}: sd={sd:.2f} rollouts, P(|diff|>=6)={p6:.3f}, 95% band [{lo},{hi}]')
    pk,mean,sd=parametric(m,0.0)
    print(f'   parametric null: P(loss>=6 in one arm pair)={pk:.3f}, sd={sd:.2f}')
    # find delta giving expected loss ~6 and report power
    for delta in (0.15,0.25,0.35,0.5):
        pk,mean,sd=parametric(m,delta)
        print(f'   parametric delta_p={delta}: expected diff={mean:+.2f}, P(observed loss>=6)={pk:.3f}')
    # discriminating tasks
    disc=[k for k,v in m.items() if 0<sum(v)<12]
    print(f'   discriminating tasks (not all-solved, not dead): {len(disc)} -> {disc}')
# family-wise: three harnesses, each with its own kill rule under the null
print('\nFamily-wise false-kill under the null (parametric, three independent harness tests):')
import math
ps=[]
for name,m in [('codex',codex),('opencode',opencode),('claude-code',claude)]:
    pk,_,_=parametric(m,0.0); ps.append(pk)
print('  per-harness P(false kill)=',[round(p,3) for p in ps],' any-of-three=',round(1-math.prod(1-p for p in ps),3))
