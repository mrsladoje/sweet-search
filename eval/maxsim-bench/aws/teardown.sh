#!/bin/bash
# teardown.sh            terminate every running instance with the project tag
# teardown.sh --all      after the owner says the runs are done: also copy the bucket to
#                        ~/.ss-eval/maxsim-cloud/bucket/, then delete the security group, key
#                        pair, IAM role and instance profile, and the bucket. Then apply every
#                        item of RESTORE.md (billing alarm) and run its final check.
set -euo pipefail
H=$(cd "$(dirname "$0")" && pwd); . "$H/env.local"
IDS=$(aws ec2 describe-instances --filters "Name=tag:Project,Values=$TAG_PROJECT" Name=instance-state-name,Values=pending,running,stopping,stopped \
  --query 'Reservations[].Instances[].InstanceId' --output text)
if [ -n "$IDS" ]; then aws ec2 terminate-instances --instance-ids $IDS --query 'TerminatingInstances[].[InstanceId,CurrentState.Name]' --output text; fi
[ "${1:-}" = --all ] || { echo "instances terminated: ${IDS:-none}"; exit 0; }
[ -n "$IDS" ] && aws ec2 wait instance-terminated --instance-ids $IDS
mkdir -p "$HOME/.ss-eval/maxsim-cloud/bucket"
aws s3 sync --only-show-errors "s3://$BUCKET/" "$HOME/.ss-eval/maxsim-cloud/bucket/"
aws ec2 delete-security-group --group-id "$SG"
aws ec2 delete-key-pair --key-name "$KEY_NAME"
aws iam remove-role-from-instance-profile --instance-profile-name "$INSTANCE_PROFILE" --role-name "$INSTANCE_PROFILE" || true
aws iam delete-instance-profile --instance-profile-name "$INSTANCE_PROFILE" || true
aws iam delete-role-policy --role-name "$INSTANCE_PROFILE" --policy-name s3-bucket || true
aws iam delete-role --role-name "$INSTANCE_PROFILE" || true
aws s3 rb "s3://$BUCKET" --force
echo "created resources deleted. Now apply RESTORE.md: $RESTORE_MD"
