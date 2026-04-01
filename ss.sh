#!/bin/bash
# ss.sh - Sweet Search: Blazing fast (~5-10ms total)
# Usage: ss.sh "query" [top_k]
# Uses server-side text formatting (no python3 overhead)
# Optimized: 1 process spawn (nc only), no sed/tail, fast cold-start

SOCKET="/tmp/sweet-search.sock"
[[ ! -S "$SOCKET" ]] && SOCKET="/tmp/search.sock"
Q="${1:-}" K="${2:-10}"

# Colors & art
D1="\e[48;5;17m" D2="\e[48;5;24m" FA="\e[1;38;5;104m" FW="\e[1;38;5;231m" R="\e[0m"
L1="█▀▀ █ █ █ █▀▀ █▀▀ ▀█▀  █▀▀ █▀▀ ▄▀▄ █▀▄ █▀▀ █▄█"
L2="▄▄█ ▀▄█▄▀ ██▄ ██▄  █   ▄▄█ ██▄ █▀█ ██▄ █▄▄ █▀█"

[[ -z "$Q" ]] && { echo -e "${FA}${L1}\n${L2}${R}\nUsage: ss.sh \"query\" [k]"; exit 0; }

# Auto-start server with fast polling (100ms intervals, max 5s)
if [[ ! -S "$SOCKET" ]]; then
    nohup node "$(dirname "$0")/core/search/sweet-search.js" --serve &>/dev/null &
    for _ in {1..50}; do
        [[ -S "$SOCKET" ]] && break
        sleep 0.1
    done
fi

# Header
echo ""
printf "${D1}  ${FA}%s${R}${D1}%32s${R}\n" "$L1" ""
printf "${D1}  ${FA}%s${R}${D2}%$((32-${#Q}))s${FW}\"%s\"${R}${D1}  ${R}\n" "$L2" "" "$Q"

# URL encode using bash parameter expansion (no sed process)
Q_ENC="${Q// /%20}"

# Request with netcat (-N closes on EOF) + skip headers in bash (no tail)
printf "GET /search?q=%s&k=%s&format=text HTTP/1.0\r\nHost: l\r\n\r\n" "$Q_ENC" "$K" \
  | nc -N -U "$SOCKET" 2>/dev/null \
  | { while IFS= read -r line; do [[ "${line%$'\r'}" == "" ]] && break; done; cat; }
