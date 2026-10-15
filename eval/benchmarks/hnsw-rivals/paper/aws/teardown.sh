#!/bin/bash
# teardown.sh          terminate every instance tagged Project=$TAG_PROJECT (this project's only).
# teardown.sh --all    the same, after the owner says the runs are done: also copy s3://$BUCKET/hnsw/ to
#                      ~/.ss-eval/hnsw-cloud/bucket/ and verify the copy. It deletes NOTHING else: the
#                      bucket, security group, key pair and role are shared with the MaxSim work.
#                      Then apply RESTORE.md by hand (when the MaxSim work is also done).
set -euo pipefail
H=$(cd "$(dirname "$0")" && pwd); . "$H/env.local"
export AWS_REGION=us-east-1 AWS_DEFAULT_REGION=us-east-1
IDS=$(aws ec2 describe-instances --filters "Name=tag:Project,Values=$TAG_PROJECT" Name=instance-state-name,Values=pending,running,stopping,stopped \
  --query 'Reservations[].Instances[].InstanceId' --output text)
if [ -n "$IDS" ]; then aws ec2 terminate-instances --instance-ids $IDS --query 'TerminatingInstances[].[InstanceId,CurrentState.Name]' --output text; fi
[ "${1:-}" = --all ] || { echo "instances terminated: ${IDS:-none}"; exit 0; }
[ -n "$IDS" ] && aws ec2 wait instance-terminated --instance-ids $IDS
D=$HOME/.ss-eval/hnsw-cloud/bucket; mkdir -p "$D"
aws s3 sync --only-show-errors "s3://$BUCKET/hnsw/" "$D/hnsw/"
echo "copied s3://…/hnsw/ to $D/hnsw/; the bucket, security group, key and role stay (shared with MaxSim)."
echo "REMINDER: apply every item of RESTORE.md ($RESTORE_MD) when no AWS work is left, then run its final check."
