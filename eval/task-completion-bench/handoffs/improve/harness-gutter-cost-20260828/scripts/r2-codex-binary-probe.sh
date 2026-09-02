#!/bin/bash
# [C] probe the deployed codex 0.146.1 binary for cost-relevant constants
B=$(command -v codex)
echo "== binary: $B  ($(codex --version)) size=$(stat -c%s "$B") =="
echo "--- tool_output / truncation config keys ---"
strings -n 6 "$B" | grep -iE '^tool_output_token_limit$|tool_output_token_limit|model_max_output_tokens|max_output_tokens' | sort -u | head -20
echo "--- truncation messages ---"
strings -n 8 "$B" | grep -iE 'truncated output|tokens truncated|original token count|truncat' | sort -u | head -30
echo "--- exec/yield polling ---"
strings -n 5 "$B" | grep -iE '^yield_time_ms$|yield_time_ms|write_stdin|max_wait_ms|^session_id$' | sort -u | head -20
echo "--- compaction ---"
strings -n 8 "$B" | grep -iE 'compact|auto-compact|context left|summariz' | sort -u | head -40
echo "--- AGENTS.md ---"
strings -n 6 "$B" | grep -iE 'AGENTS\.md|project_doc|instructions file|experimental_instructions' | sort -u | head -20
echo "--- reasoning ---"
strings -n 6 "$B" | grep -iE 'encrypted_content|reasoning\.encrypted|include.*reasoning|store.*false|previous_response_id' | sort -u | head -20
