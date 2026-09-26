import os, pty, select, subprocess, sys, tempfile, time, json
W=os.path.abspath(os.path.join(os.path.dirname(__file__), *['..']*7))  # repo root
port=sys.argv[1]
work=tempfile.mkdtemp(prefix='lean-tty-'); repo=os.path.join(work,'repo'); home=os.path.join(work,'home')
os.makedirs(repo); os.makedirs(home)
open(os.path.join(repo,'main.py'),'w').write('def add(a, b):\n    return a + b\n')
subprocess.run(['git','init','-q'],cwd=repo,check=True)
subprocess.run(['node','--input-type=module','-e',f"const {{installClaudeLeanHarness}}=await import('{W}/scripts/install-claude-lean-harness.js');const {{writeClaudeRules}}=await import('{W}/scripts/write-claude-rules.js');writeClaudeRules({{projectRoot:'{repo}'}});console.log(installClaudeLeanHarness({{projectRoot:'{repo}'}}).status)"],check=True)
# pre-accept the trust dialog / onboarding in the throwaway config
os.makedirs(os.path.join(home,'.claude'),exist_ok=True)
json.dump({"hasCompletedOnboarding":True,"projects":{os.path.realpath(repo):{"hasTrustDialogAccepted":True},repo:{"hasTrustDialogAccepted":True}}},open(os.path.join(home,'.claude','.claude.json'),'w'))
env=dict(HOME=home,PATH='/usr/bin:/bin',CLAUDE_CONFIG_DIR=os.path.join(home,'.claude'),ANTHROPIC_BASE_URL=f'http://127.0.0.1:{port}',
         CLAUDE_CODE_OAUTH_TOKEN='sk-ant-oat01-capture-dummy',ENABLE_TOOL_SEARCH='true',DISABLE_AUTOUPDATER='1',
         CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC='1',TERM='xterm-256color')
pid,fd=pty.fork()
if pid==0:
    os.chdir(repo); os.execve('/Users/admin/.local/share/claude/versions/2.1.281',['claude','Make add accept an optional third argument c.'],env)
end=time.time()+40; buf=b''
while time.time()<end:
    r,_,_=select.select([fd],[],[],0.5)
    if r:
        try: buf+=os.read(fd,65536)
        except OSError: break
os.kill(pid,9)
print('tty bytes',len(buf)); import re; print(re.sub(rb'\x1b\[[0-9;?]*[A-Za-z]',b'',buf).decode('utf8','replace')[-1500:])
