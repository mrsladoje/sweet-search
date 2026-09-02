#!/usr/bin/env python3
"""p2 — SYMMETRIC ambiguity test. 05 defines ambiguity only as 'the delimiter's
trailing SPACE fused into a pure-space token'. That definition cannot see the
tab-into-tab hazard, which is the one 01 measured on claude-code. Here a form is
ambiguous on a line when the token containing the delimiter is homogeneous in the
delimiter's own last character AND the file's own indentation starts with that
same character -- i.e. the strip boundary is unmarked in either direction."""
import sys, os, re
import tiktoken
ENC = tiktoken.get_encoding('o200k_base')
FORMS = {
 'tab':      (lambda n,l: f'{n}\t{l}', '\t'),
 'pipe_sp':  (lambda n,l: f'{n}| {l}', ' '),
 'colon_sp': (lambda n,l: f'{n}: {l}', ' '),
 'space':    (lambda n,l: f'{n} {l}',  ' '),
 'colon':    (lambda n,l: f'{n}:{l}',  ':'),
 'pipe':     (lambda n,l: f'{n}|{l}',  '|'),
}
def main(paths):
    lines=[]
    for p in paths:
        t=open(p,'r',errors='replace').read().split('\n')
        if t and t[-1]=='': t=t[:-1]
        lines+=t
    N=len(lines)
    ind=[re.match(r'^[ \t]*',l).group(0) for l in lines]
    sp=sum(1 for i in ind if i.startswith(' ')); tb=sum(1 for i in ind if i.startswith('\t'))
    print(f'{N} lines: space-indent {sp} ({sp/N:.1%}), tab-indent {tb} ({tb/N:.1%}), none {N-sp-tb} ({(N-sp-tb)/N:.1%})')
    print(f'{"form":<10}{"05-metric amb":>15}{"SYMMETRIC amb":>16}{"amb on tab-indent":>20}{"amb on space-indent":>22}')
    for name,(fn,dl) in FORMS.items():
        a05=0; asym=0; atab=0; asp=0
        for i,l in enumerate(lines):
            s=fn(i+1,l); toks=[ENC.decode([x]) for x in ENC.encode(s)]
            pre=s[:len(s)-len(l)]
            acc=''; k=0
            while k<len(toks) and len(acc)<len(pre):
                acc+=toks[k]; k+=1
            bt=toks[k-1] if k>0 else ''
            fused = len(acc)>len(pre)
            if fused and set(bt)=={' '}: a05+=1
            # symmetric: the delimiter's last char equals the file's first indent char,
            # and the fused token is homogeneous in that char
            own = ind[i][:1]
            if fused and own and own==dl and set(bt)=={dl}: 
                asym+=1
                if own=='\t': atab+=1
                else: asp+=1
        print(f'{name:<10}{a05/N:>14.1%}{asym/N:>16.1%}{atab/N:>20.1%}{asp/N:>22.1%}')
if __name__=='__main__':
    d=sys.argv[1]
    main([os.path.join(d,f) for f in sorted(os.listdir(d)) if not f.startswith('.')])
