import os,re,glob,json
GOLD='/root/.ss-eval/golden'
pool=[l.strip() for l in open('/root/fresh-run/pool.txt') if l.strip()]
EXT={'.js','.ts','.jsx','.tsx','.py','.go','.cs','.java','.rb','.R','.r','.ex','.exs','.php','.c','.h','.cpp','.hpp','.rs','.kt','.swift','.scala','.jam','.md','.json','.yml','.yaml','.txt','.csv','.tsv'}
tot=0; hit_tab=0; hit_pipe=0; hit_colon=0; files=0
examples=[]
for t in pool:
    base=t.rsplit('-',1)[0].lower()
    dirs=[d for d in os.listdir(GOLD) if d.split('@')[0].lower()==base]
    if not dirs: continue
    root=os.path.join(GOLD,dirs[0])
    for dp,dn,fn in os.walk(root):
        dn[:] = [d for d in dn if d not in ('.git','node_modules','vendor','dist','build')]
        for f in fn:
            e=os.path.splitext(f)[1]
            if e not in EXT: continue
            p=os.path.join(dp,f)
            try: txt=open(p,'r',errors='replace').read()
            except Exception: continue
            if len(txt)>3_000_000: continue
            files+=1
            for ln in txt.split('\n'):
                tot+=1
                if re.match(r'^\d+\t',ln):
                    hit_tab+=1
                    if len(examples)<12: examples.append((p.replace(GOLD+'/',''),ln[:90]))
                if re.match(r'^\d+\| ',ln): hit_pipe+=1
                if re.match(r'^\d+: ',ln): hit_colon+=1
print(f'files={files} lines={tot}')
print(f'lines matching ^\\d+<TAB>   : {hit_tab} ({hit_tab/tot:.6%})  <- sparse numbering makes stripCodeLineNumbers mangle these')
print(f'lines matching ^\\d+|<space>: {hit_pipe} ({hit_pipe/tot:.6%})')
print(f'lines matching ^\\d+:<space>: {hit_colon} ({hit_colon/tot:.6%})')
for p,l in examples: print('  ex', p, repr(l))
