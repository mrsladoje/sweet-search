#!/usr/bin/env python3
"""gate-extract.py <claude-binary> — read-only extraction of the Edit/Write read-before-edit
gate from a Claude Code binary (Bun-compiled ELF/Mach-O; the JS is embedded as text).

Prints: the error string variable, the Edit gate function (the one that throws the
"File has not been read yet" error with a model check), the model-set predicate and the
Set it is bound to, the Write gate function, and the telemetry names that measure the
hypothetical gate for non-gated models. Nothing is written.
"""
import re
import sys

path = sys.argv[1]
data = open(path, 'rb').read().decode('latin-1')
print(f'binary={path} bytes={len(data)}')

m = re.search(r'([A-Za-z0-9_$]{1,6})="File has not been read yet\. Read it first before writing to it\."', data)
if not m:
    # some builds keep the message in a string table; fall back to any variable assigned that text
    m = re.search(r'([A-Za-z0-9_$]{1,6})="File has not been read yet[^"]*"', data)
errvar = m.group(1) if m else None
print(f'errvar={errvar}')

def show(label, pattern, width=900, maxhits=4):
    hits = 0
    for mm in re.finditer(pattern, data):
        s = max(0, mm.start() - width // 3)
        e = min(len(data), mm.end() + width)
        frag = data[s:e].replace('\n', ' ')
        print(f'--- {label} @{mm.start()}')
        print(frag)
        hits += 1
        if hits >= maxhits:
            break
    if not hits:
        print(f'--- {label}: NO MATCH')

if errvar:
    # every throw of the not-read error, with the enclosing function head
    for mm in re.finditer(r'throw new [A-Za-z0-9_$]+\(' + re.escape(errvar) + r'\)', data):
        s = data.rfind('function ', 0, mm.start())
        s = max(s, mm.start() - 700)
        e = min(len(data), mm.end() + 420)
        print(f'--- throw site @{mm.start()}')
        print(data[s:e].replace('\n', ' '))
    # the model predicate used inside the Edit gate: `if(!X(i)&&!s())return!1`
    for mm in re.finditer(r'if\(!([A-Za-z0-9_$]+)\(i\)&&!s\(\)\)return!1;throw new [A-Za-z0-9_$]+\(' + re.escape(errvar) + r'\)', data):
        pred = mm.group(1)
        print(f'--- edit-gate model predicate = {pred}')
        pm = re.search(r'function ' + re.escape(pred) + r'\(e\)\{return ([A-Za-z0-9_$]+)\.has\(([A-Za-z0-9_$]+)\(e\)\)\}', data)
        if pm:
            setvar, norm = pm.group(1), pm.group(2)
            print(f'    predicate body: {setvar}.has({norm}(e))')
            sm = re.search(re.escape(setvar) + r'=new Set\(\[[^\]]*\]\)', data)
            print(f'    set binding: {sm.group(0) if sm else "NOT FOUND"}')
            nm = re.search(r'function ' + re.escape(norm) + r'\(e\)\{[^}]{0,200}\}', data)
            print(f'    normaliser: {nm.group(0) if nm else "NOT FOUND"}')
        else:
            pm2 = re.search(r'function ' + re.escape(pred) + r'\(e\)\{[^}]{0,300}\}', data)
            print(f'    predicate body (raw): {pm2.group(0) if pm2 else "NOT FOUND"}')

show('write gate feature flag', r'tengu_velvet_mallet', width=260, maxhits=3)
show('hypothetical-gate telemetry (edit)', r'tengu_edit_tool_not_read_hypothetical', width=420, maxhits=2)
show('hypothetical-gate telemetry (write)', r'tengu_write_tool_not_read_hypothetical', width=420, maxhits=2)
show('readNotAutoAllowed binding at the Edit call site', r'readNotAutoAllowed:\(\)=>', width=200, maxhits=2)
show('tab separator gate', r'tengu_tab_read_sep', width=200, maxhits=2)
