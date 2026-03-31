#!/usr/bin/env bash
# Rust-vs-C launcher benchmark — standalone script.
# Compiles the C launcher from git history, runs both in Docker,
# captures high-precision timing via Node.js hrtime.
#
# Usage: bash scripts/benchmark-launcher.sh <staging-dir> <platform> <target>

set -euo pipefail

STAGING="${1:?Usage: $0 <staging-dir> <platform> <target>}"
PLATFORM="${2:?}"
TARGET="${3:?}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Extract C source from git history
C_SRC=$(mktemp)
git -C "$REPO_ROOT" show fda936a^:ss-fast/ss-fast.c > "$C_SRC" 2>/dev/null || {
  echo "SKIP: C launcher source not in git history"
  rm -f "$C_SRC"
  exit 0
}

# Bundle everything into a single tar and pipe into docker run.
# This avoids docker cp which fails silently under Colima VZ after
# multiple container operations (known virtiofs issue).
# Only copy the main tarball and the target-specific native tarball
BUNDLE=$(mktemp -d)
cp "$STAGING"/sweet-search-2.*.tgz "$BUNDLE/"
cp "$STAGING"/sweet-search-native-${TARGET}-*.tgz "$BUNDLE/" 2>/dev/null || true
cp "$C_SRC" "$BUNDLE/ss-fast.c"
rm -f "$C_SRC"

COPYFILE_DISABLE=1 tar -cf - -C "$BUNDLE" . | docker run --rm -i --platform "$PLATFORM" \
  node:20-slim bash -c '
    mkdir /tarballs && cd /tarballs && tar xf -
    apt-get update -qq >/dev/null 2>&1
    apt-get install -y -qq gcc python3 make g++ >/dev/null 2>&1
    mkdir /tmp/b && cd /tmp/b
    echo "{\"name\":\"b\"}" > package.json
    MAIN=$(ls /tarballs/sweet-search-2.*.tgz 2>/dev/null | grep -v "\\._" | head -1)
    NATIVE=$(ls /tarballs/sweet-search-native-*.tgz 2>/dev/null | grep -v "\\._" | head -1)
    npm install "$MAIN" "$NATIVE" --no-audit --no-fund >/dev/null 2>&1
    npm rebuild better-sqlite3 >/dev/null 2>&1
    RUST=$(find /tmp/b/node_modules/@sweet-search -name sweet-search -type f 2>/dev/null | head -1)
    gcc -O3 -o /tmp/ss-c /tarballs/ss-fast.c 2>/dev/null
    if [ -z "$RUST" ] || [ ! -f /tmp/ss-c ]; then echo "BUILD_FAILED"; exit 1; fi
    node -e "
      const{execFileSync}=require(\"child_process\");
      function bench(label,bin,runs){
        const t=[];
        for(let i=0;i<runs;i++){
          const s=process.hrtime.bigint();
          try{execFileSync(bin,[\"--help\"],{stdio:\"pipe\",timeout:5000})}catch{}
          t.push(Number(process.hrtime.bigint()-s)/1000);
        }
        t.sort((a,b)=>a-b);
        const p50=t[Math.floor(t.length/2)];
        console.log(label+\": p50=\"+p50.toFixed(0)+\"us (\"+( p50/1000).toFixed(2)+\"ms)\");
        return p50;
      }
      const r=bench(\"Rust\",\"$RUST\",30);
      const c=bench(\"C\",\"/tmp/ss-c\",30);
      console.log(\"Ratio: \"+(r/c).toFixed(2)+\"x\");
    "
  '
EXIT=$?
rm -rf "$BUNDLE"
exit $EXIT
