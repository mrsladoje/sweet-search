#!/usr/bin/env python3
"""p2 — independent re-derivation of the gutter tokeniser numbers (o200k_base).
Written from scratch; does not import or copy r1-gutter-tokens.py."""
import sys, os, re, json
import tiktoken

ENC = tiktoken.get_encoding('o200k_base')

def render(lines, form, start=1):
    out=[]
    for i,l in enumerate(lines):
        n=start+i
        if form=='none': out.append(l)
        elif form=='tab': out.append(f'{n}\t{l}')
        elif form=='pipe_sp': out.append(f'{n}| {l}')
        elif form=='pipe': out.append(f'{n}|{l}')
        elif form=='sp_pipe': out.append(f'{n} |{l}')
        elif form=='colon': out.append(f'{n}:{l}')
        elif form=='colon_sp': out.append(f'{n}: {l}')
        elif form=='space': out.append(f'{n} {l}')
        elif form=='pad5tab': out.append(f'{n:5d}\t{l}')
        elif form=='pad5sp2': out.append(f'{n:5d}  {l}')
        elif form=='pad05pipe': out.append(f'{n:05d} |{l}')
        elif form=='sparse5': out.append(f'{n}\t{l}' if (i==0 or n%5==0) else l)
        elif form=='sparse10': out.append(f'{n}\t{l}' if (i==0 or n%10==0) else l)
        else: raise SystemExit('form? '+form)
    return '\n'.join(out)

SYM = re.compile(r'^\s*(?:(?:export|public|private|protected|static|async|final|open|internal|override|@\w+)\s+)*'
                 r'(?:func|function|def|class|struct|type|interface|impl|fn|var|const|let|module|package|sub|method)\b'
                 r'|^\s*[A-Za-z_$][\w$.]*\s*(?:=|:)\s*function\b'
                 r'|^\s*[A-Za-z_$.][\w$.]*\s*<-\s*function\b')

def render_landmark(lines, start=1):
    out=[]
    for i,l in enumerate(lines):
        n=start+i
        out.append(f'{n}\t{l}' if (i==0 or SYM.match(l)) else l)
    return '\n'.join(out), sum(1 for i,l in enumerate(lines) if i==0 or SYM.match(l))

def indent_of(s):
    return re.match(r'^[ \t]*', s).group(0)

def main(paths, window=None):
    forms=['none','tab','space','colon','pipe','sp_pipe','pipe_sp','colon_sp','pad05pipe','pad5tab','pad5sp2','sparse5','sparse10']
    tot_lines=0
    tok={f:0 for f in forms}; tok['landmark']=0
    landmarks=0
    per_file={}
    space_lines=0; tab_lines=0
    for p in paths:
        txt=open(p,'r',errors='replace').read()
        lines=txt.split('\n')
        if lines and lines[-1]=='': lines=lines[:-1]
        n=len(lines); tot_lines+=n
        for l in lines:
            ind=indent_of(l)
            if ind.startswith(' '): space_lines+=1
            elif ind.startswith('\t'): tab_lines+=1
        ft={}
        chunks = [(0,n)] if not window else [(i,min(i+window,n)) for i in range(0,n,window)]
        for f in forms:
            s=0
            for a,b in chunks:
                s+=len(ENC.encode(render(lines[a:b], f, start=a+1)))
            tok[f]+=s; ft[f]=s
        s=0
        for a,b in chunks:
            r,c=render_landmark(lines[a:b], start=a+1); s+=len(ENC.encode(r)); landmarks+=c
        tok['landmark']+=s; ft['landmark']=s
        per_file[os.path.basename(p)]={'lines':n, **{f: round(ft[f]/n,4) for f in ft}}
    base=tok['none']/tot_lines
    print(f'corpus lines={tot_lines}  space-indented={space_lines} ({space_lines/tot_lines:.1%})  tab-indented={tab_lines} ({tab_lines/tot_lines:.1%})')
    print(f'window={window or "whole file"}')
    print(f'{"form":<12}{"tok/line":>10}{"overhead":>10}{"ratio":>8}')
    order=['none','tab','space','colon','pipe','sp_pipe','pipe_sp','colon_sp','pad05pipe','pad5tab','pad5sp2','sparse5','sparse10','landmark']
    for f in order:
        v=tok[f]/tot_lines
        print(f'{f:<12}{v:>10.4f}{v-base:>10.4f}{v/base:>8.3f}')
    print(f'landmark lines numbered: {landmarks} of {tot_lines} = {landmarks/tot_lines:.1%}')
    print()
    print('PIPE_SP - TAB per line =', round(tok['pipe_sp']/tot_lines - tok['tab']/tot_lines, 4))
    print('COLON   - TAB per line =', round(tok['colon']/tot_lines - tok['tab']/tot_lines, 4))
    print('PIPE    - TAB per line =', round(tok['pipe']/tot_lines - tok['tab']/tot_lines, 4))
    print()
    print('per file tok/line:')
    for k,v in per_file.items():
        print(' ',k, 'n=%d'%v['lines'], 'none=%.3f'%v['none'], 'tab=%.3f'%v['tab'], 'tab_ovh=%.3f'%(v['tab']-v['none']), 'pipe_sp_ovh=%.3f'%(v['pipe_sp']-v['none']))

if __name__=='__main__':
    d=sys.argv[1]
    win=int(sys.argv[2]) if len(sys.argv)>2 else None
    paths=[os.path.join(d,f) for f in sorted(os.listdir(d)) if not f.startswith('.')]
    main(paths, win)
