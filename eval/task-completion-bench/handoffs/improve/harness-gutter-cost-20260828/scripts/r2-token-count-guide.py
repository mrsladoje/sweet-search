import tiktoken, json, subprocess, sys
enc = tiktoken.get_encoding("o200k_base")
def tk(s): return len(enc.encode(s))
p = "core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md"
raw = open(p, encoding="utf8").read()
# strip YAML frontmatter
body = raw.split("---", 2)[2] if raw.startswith("---") else raw
print(f"M+- guide  file bytes={len(raw.encode())}  body bytes={len(body.encode())}  body tokens={tk(body)}  (frontmatter claims 1307)")
