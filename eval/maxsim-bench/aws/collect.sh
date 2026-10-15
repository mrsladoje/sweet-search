#!/bin/bash
# collect.sh: s3://$BUCKET/results/ -> ~/.ss-eval/maxsim-cloud/results/ (summaries, raw results, logs)
set -euo pipefail
H=$(cd "$(dirname "$0")" && pwd); . "$H/env.local"
D=$HOME/.ss-eval/maxsim-cloud/results; mkdir -p "$D"
aws s3 sync --only-show-errors "s3://$BUCKET/results/" "$D/"
ls "$D"
