#!/usr/bin/env python3
"""p2 — independent transparency / ambiguity / merge test (o200k_base).

transparent : the token id sequence covering the file's OWN text is byte-identical
              to the no-gutter tokenisation of that line in the same block context.
ambiguous   : the token that follows the line number is a PURE run of spaces
              (no tab, no other char) -> the strip boundary is unmarked.
"""
import sys, os, re
import tiktoken
ENC = tiktoken.get_encoding('o200k_base')

FORMS = {
 'none':      lambda n,l: l,
 'tab':       lambda n,l: f'{n}\t{l}',
 'space':     lambda n,l: f'{n} {l}',
 'colon':     lambda n,l: f'{n}:{l}',
 'pipe':      lambda n,l: f'{n}|{l}',
 'sp_pipe':   lambda n,l: f'{n} |{l}',
 'pipe_sp':   lambda n,l: f'{n}| {l}',
 'colon_sp':  lambda n,l: f'{n}: {l}',
 'pad05pipe': lambda n,l: f'{n:05d} |{l}',
 'pad5tab':   lambda n,l: f'{n:5d}\t{l}',
 'pad5sp2':   lambda n,l: f'{n:5d}  {l}',
}

def line_tokens(prefixed, plain):
    """Tokenise the prefixed line alone; return (all token strings, tokens covering the
    plain content, first token after the digits)."""
    ids = ENC.encode(prefixed)
    toks = [ENC.decode([i]) for i in ids]
    # find the split point: consume tokens until the decoded text covers the prefix
    plen = len(prefixed) - len(plain)
    acc = ''
    for k,t in enumerate(toks):
        acc += t
        if len(acc) >= plen:
            # token k straddles or ends the prefix
            return toks, k, acc
    return toks, len(toks)-1, acc

def main(paths):
    lines=[]
    for p in paths:
        t=open(p,'r',errors='replace').read().split('\n')
        if t and t[-1]=='': t=t[:-1]
        lines += t
    print(f'{len(lines)} lines')
    print(f'{"form":<11}{"transparent":>12}{"ambiguous(pure-space merge)":>30}{"delim own token":>18}')
    plainmap = {}
    for i,l in enumerate(lines):
        plainmap[i]=ENC.encode(l)
    for name,fn in FORMS.items():
        transp=0; amb=0; own=0
        for i,l in enumerate(lines):
            n=i+1
            s=fn(n,l)
            ids=ENC.encode(s)
            toks=[ENC.decode([x]) for x in ids]
            # tokens of the plain line
            pids=plainmap[i]
            # transparent iff the tail of ids equals pids
            if len(pids)<=len(ids) and ids[len(ids)-len(pids):]==pids: transp+=1
            # the token right after the digits: find first token index where the
            # accumulated text length exceeds len(str(n)) for unpadded forms
            pre = s[:len(s)-len(l)]
            acc=''; k=0
            while k<len(toks) and len(acc)<len(pre):
                acc+=toks[k]; k+=1
            boundary_tok = toks[k-1] if k>0 else ''
            # ambiguity: the token that contains the delimiter also contains file
            # indentation, and is made ONLY of spaces
            if len(acc)>len(pre) and boundary_tok and set(boundary_tok)=={' '}: amb+=1
            if len(acc)==len(pre): own+=1
        N=len(lines)
        print(f'{name:<11}{transp/N:>11.1%}{amb/N:>30.1%}{own/N:>18.1%}')

    print()
    print('MERGE PROBES — token after the number, per indent style')
    probes=[('0sp','res <- f('),('2sp','  res <- f('),('4sp','    res <- f('),
            ('6sp','      res <- f('),('8sp','        res <- f('),
            ('tab','\tif err != nil {'),('2tab','\t\treturn nil, err')]
    for name,fn in FORMS.items():
        row=[]
        for pn,pl in probes:
            s=fn(35,pl); toks=[ENC.decode([x]) for x in ENC.encode(s)]
            pre=s[:len(s)-len(pl)]
            acc=''; k=0
            while k<len(toks) and len(acc)<len(pre):
                acc+=toks[k]; k+=1
            bt = toks[k-1] if k>0 else ''
            row.append(f'{pn}:{bt!r}'.replace('\t','\\t'))
        print(f'  {name:<10}', ' '.join(row))

if __name__=='__main__':
    d=sys.argv[1]
    main([os.path.join(d,f) for f in sorted(os.listdir(d)) if not f.startswith('.')])
