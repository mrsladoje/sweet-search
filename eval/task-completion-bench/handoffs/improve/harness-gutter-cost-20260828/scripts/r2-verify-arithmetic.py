P_IN, P_CACHE, P_OUT = 0.10, 0.01, 0.60
rows = {
 'codex sweet':   dict(T=19.6, ing=34541, res=548952, out=5524, cost=0.012258, G=1457),
 'codex native':  dict(T=18.8, ing=35942, res=515269, out=5786, cost=0.012218, G=0),
 'opencode sweet':dict(T=19.0, ing=27912, res=421837, out=3645, cost=0.009197, G=1457),
 'opencode native':dict(T=16.3,ing=30359, res=376466, out=3606, cost=0.008964, G=0),
 'claude sweet':  dict(T=23.4, ing=38735, res=786165, out=7669, cost=0.016337, G=1577),
 'claude native': dict(T=24.3, ing=36534, res=782770, out=7395, cost=0.015918, G=0),
}
print("== recompute cost + shares ==")
for k,v in rows.items():
    c = (v['ing']*P_IN + v['res']*P_CACHE + v['out']*P_OUT)/1e6
    tot=c
    print(f"{k:16s} recomputed ${c:.6f} (reported ${v['cost']:.6f})  shares ing {100*v['ing']*P_IN/1e6/tot:.1f}% res {100*v['res']*P_CACHE/1e6/tot:.1f}% out {100*v['out']*P_OUT/1e6/tot:.1f}%")
print("\n== re-send multiplier + effective price ==")
for k,v in rows.items():
    R=v['res']/v['ing']
    print(f"{k:16s} R={R:.1f}  eff=${P_IN+P_CACHE*R:.3f}/M   out/eff={P_OUT/(P_IN+P_CACHE*R):.1f}x")
print("\n== guide cost and ex-guide deltas ==")
for h,(s,n) in {'codex':('codex sweet','codex native'),'opencode':('opencode sweet','opencode native'),'claude':('claude sweet','claude native')}.items():
    S,N=rows[s],rows[n]
    g = S['G']*(P_IN + P_CACHE*(S['T']-1))/1e6
    print(f"{h:9s} guide ${g:.6f} = {100*g/S['cost']:.1f}% of rollout;  observed delta {100*(S['cost']/N['cost']-1):+.2f}%; ex-guide ${S['cost']-g:.6f} = {100*((S['cost']-g)/N['cost']-1):+.1f}%")
print("\n== output token share of all tokens (codex sweet) ==")
v=rows['codex sweet']; tot_in=v['ing']+v['res']
print(f"  out {v['out']} / (in {tot_in} + out) = {100*v['out']/(tot_in+v['out']):.2f}% of tokens, {100*v['out']*P_OUT/1e6/v['cost']:.1f}% of cost")
print("\n== 6k tool output table (20 requests) ==")
for k in (15,10,5,1):
    rem=20-k; ing=6000*P_IN/1e6; res=6000*rem*P_CACHE/1e6
    print(f"  lands after req {k:2d} ({rem:2d} re-sends): ingest ${ing:.6f} residency ${res:.6f} total ${ing+res:.6f} ratio {(ing+res)/ing:.1f}x")
print("\n== gutter (codex, 394 numbered lines/rollout, eff $0.259/M) ==")
eff=P_IN+P_CACHE*(548952/34541)
for name,d in (('tab vs none',1.45),('pipe vs none',2.38),('pipe vs tab',0.93)):
    tk=394*d; c=tk*eff/1e6
    print(f"  {name:14s} {tk:6.0f} tok  ${c:.6f}  {100*c/0.012258:.2f}% of a rollout")
print("\n== claude sidechain reconciliation (ideal) ==")
sw_main, na_main = 1.171902/66, 1.066464/66
sw_side, na_side = 0.197745/66, 0.298656/66
print(f"  sweet main ${sw_main:.6f} + side ${sw_side:.6f} = ${sw_main+sw_side:.6f}")
print(f"  native main ${na_main:.6f} + side ${na_side:.6f} = ${na_main+na_side:.6f}")
print(f"  delta {100*((sw_main+sw_side)/(na_main+na_side)-1):+.1f}%   delegation saving ${na_side-sw_side:.6f}   main penalty ${sw_main-na_main:+.6f}")
print("\n== per-turn mean cost ==")
for k in ('codex sweet','opencode sweet','claude sweet'):
    v=rows[k]; print(f"  {k:15s} ${v['cost']/v['T']:.5f} per turn")
print("\n== rewrite penalty at in=40000 ==")
print(f"  0.09 * 40000 / 1e6 = ${0.09*40000/1e6:.4f} = {100*(0.09*40000/1e6)/0.012258:.0f}% of a codex rollout")
