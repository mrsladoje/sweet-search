#!/usr/bin/env bash
# normalise run-to-run noise: latency, worktree paths in stack traces
sed -E 's/latency=[0-9]+ms/latency=Nms/; s/"latencyMs":[0-9]+/"latencyMs":N/; s#file:///Users/admin/Projects/[a-z-]+/#file:///R/#' "$1"
