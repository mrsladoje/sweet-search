import os,re
GOLD='/root/.ss-eval/golden'
pool=[l.strip() for l in open('/root/fresh-run/pool.txt') if l.strip()]
EXT={'.js','.ts','.jsx','.tsx','.py','.go','.cs','.java','.rb','.R','.r','.ex','.exs','.php','.c','.h','.cpp','.hpp','.rs','.kt','.swift','.scala','.jam','.yml','.yaml','.json','.md'}
tot=0;c1=0;c2=0;p1=0
for t in pool:
    base=t.rsplit('-',1)[0].lower()
    d=[x for x in os.listdir(GOLD) if x.split('@')[0].lower()==base]
    if not d: continue
    for dp,dn,fn in os.walk(os.path.join(GOLD,d[0])):
        dn[:]=[x for x in dn if x not in ('.git','node_modules','vendor','dist','build')]
        for f in fn:
            if os.path.splitext(f)[1] not in EXT: continue
            p=os.path.join(dp,f)
            try: txt=open(p,errors='replace').read()
            except Exception: continue
            if len(txt)>3_000_000: continue
            for ln in txt.split('\n'):
                tot+=1
                if re.match(r'^\d+:',ln): c1+=1
                if re.match(r'^\d+: ',ln): c2+=1
                if re.match(r'^\d+\|',ln): p1+=1
print(f'lines={tot}')
print(f'^\\d+:      {c1} ({c1/tot:.6%})   <- a colon gutter would be non-invertible on these')
print(f'^\\d+:<sp>  {c2} ({c2/tot:.6%})')
print(f'^\\d+|      {p1} ({p1/tot:.6%})')
