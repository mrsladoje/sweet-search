#!/bin/zsh
cd /Users/admin/Projects/sweet-search-private
V=core/prompt-optimization/data/frozen/p7-vault-probes-v60.json
run_shard(){ local ids=$1 s=$2;
  PROBES=$V PROVIDER=openrouter IDS=$ids HARNESS=codex MODEL=gpt-5.5 REASON=high MODE=mpp REPS=3 RUN=vault-cdx-mpp-$s node scripts/inharness-sniff.mjs;
  PROBES=$V PROVIDER=openrouter IDS=$ids HARNESS=codex MODEL=gpt-5.5 REASON=high MODE=native REPS=3 RUN=vault-cdx-native-$s node scripts/inharness-sniff.mjs; }
run_shard "go-002,go-010,go-007,go-v60-01,go-v60-02,rust-008,rust-002,rust-006,rust-v60-01,c-v60-01,c-v60-02,c-v60-03,dart-v60-01,dart-v60-02,swift-v60-01,swift-v60-02" s1 &
run_shard "python-004,python-006,python-002,python-v60-01,python-v60-02,ts-010,ts-007,ts-006,typescript-v60-01,lua-v60-01,lua-v60-02,lua-v60-03,elixir-v60-01,elixir-v60-02,zig-v60-01,zig-v60-02" s2 &
run_shard "cpp-006,cpp-001,cpp-v60-01,cpp-v60-02,js-002,js-003,js-001,javascript-v60-01,csharp-002,csharp-009,csharp-v60-01,php-v60-01,php-v60-02,php-v60-03" s3 &
run_shard "java-008,java-007,java-v60-01,java-v60-02,kotlin-001,kotlin-004,kotlin-v60-01,kotlin-v60-02,ruby-003,ruby-006,ruby-v60-01,scala-v60-01,scala-v60-02,scala-v60-03" s4 &
wait
echo VAULT_ALL_SHARDS_DONE
