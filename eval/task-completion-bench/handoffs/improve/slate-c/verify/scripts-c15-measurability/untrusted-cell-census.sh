cd /root/sweet-search-private/eval/task-completion-bench/results
for r in fp-codex-tab-20260826 fp-codex-none-20260826 fp-codex-pipe-20260826 \
         fp-opencode-tab-20260826 fp-opencode-none-20260826 fp-opencode-pipe-20260826 \
         rp-oc-tab-20260827 rp-oc-none-20260827 rp-oc-pipe-20260827 \
         fp-claudecode-tab-20260826 fp-claudecode-none-20260826 fp-claudecode-pipe-20260826 \
         fixval-codex-20260828 fixval-opencode-20260828 fixval-claude-code-20260828 \
         rb-codex-20260825 rb-opencode-20260824 rb-claudecode-20260824; do
  [ -d "$r/agent-state" ] || { echo "$r NO-AGENT-STATE"; continue; }
  echo "== $r"
  for d in $r/agent-state/*/; do
    cell=$(basename "$d")
    yes=$(grep -rho "trustworthy=yes" "$d" 2>/dev/null | wc -l)
    no=$(grep -rho "trustworthy=no" "$d" 2>/dev/null | wc -l)
    tot=$((yes+no))
    if [ "$tot" -gt 0 ] && [ "$yes" -eq 0 ]; then echo "   ALL-UNTRUSTED $cell (no=$no)"; fi
  done
done
