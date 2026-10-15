#!/bin/bash
# collect.sh: s3://$BUCKET/hnsw/{results,builds-meta}/ -> ~/.ss-eval/hnsw-cloud/  (read-only on S3)
# Serialised indexes (s3 .../hnsw/builds/) stay in S3; pass --with-builds to copy them too (large).
set -euo pipefail
H=$(cd "$(dirname "$0")" && pwd); . "$H/env.local"
export AWS_REGION=us-east-1 AWS_DEFAULT_REGION=us-east-1
D=$HOME/.ss-eval/hnsw-cloud; mkdir -p "$D/results"
aws s3 sync --only-show-errors "s3://$BUCKET/hnsw/results/" "$D/results/"
if [ "${1:-}" = --with-builds ]; then mkdir -p "$D/builds"; aws s3 sync --only-show-errors "s3://$BUCKET/hnsw/builds/" "$D/builds/"; fi
ls "$D/results"
