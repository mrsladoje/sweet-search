#!/bin/bash
# launch.sh [--dry] <name> <instance-type> <amd64|arm64> <mode-chain> [KEY=value ...]
#
# One on-demand instance: Ubuntu 24.04 (AMI from SSM), gp3 disk, shutdown behaviour terminate, the
# instance profile, tags Project=$TAG_PROJECT / Name=hnsw-<name>, and user data that starts with a
# 72-hour safety stop and then runs bootstrap.sh from the bucket. Account values come from env.local
# (git-ignored). Prints the instance ID. Run it only after the owner's go (PAPER_PLAN rule 7).
#   --dry   print the run-instances command and the user data; call no AWS API, create nothing.
# KEY=value (all optional):
#   DISK_GB=100      root volume size in GB (the build machine needs more)
#   DATA=a.tar.zst,b.tar.zst   data archives in s3://$BUCKET/hnsw/data/ (default: gcsn set + CodeRankEmbed gcsn)
#   BUNDLE=name      code bundle in s3://$BUCKET/hnsw/code/ (default: the newest ss-HEAD-*.tar.zst)
#   IDLE_MIN=60      idle minutes before the watchdog shuts the machine down
#   STOP_MIN=4320    hard stop in minutes (the 72-hour stop; a pilot uses less)
#   SMOKE_BUILD=1    smoke mode builds its own small builds
#   SHARD=i/n        build mode: build only the (set, model) groups of shard i of n (several build machines)
#   IOPS=  THROUGHPUT=   gp3 settings above the baseline (3000 IOPS, 125 MB/s)
set -euo pipefail
DRY=0; ARGS=()
for x in "$@"; do [ "$x" = --dry ] && DRY=1 || ARGS+=("$x"); done
set -- "${ARGS[@]}"
[ $# -ge 4 ] || { sed -n '2,16p' "$0"; exit 2; }
H=$(cd "$(dirname "$0")" && pwd); . "$H/env.local"
export AWS_REGION=us-east-1 AWS_DEFAULT_REGION=us-east-1
NAME=$1; TYPE=$2; ARCH=$3; MODE=$4; shift 4
[[ $NAME =~ ^[a-z0-9][a-z0-9-]*$ ]] || { echo "name must be lower-case letters, digits and hyphens"; exit 2; }
case "$ARCH" in amd64|arm64) ;; *) echo "arch must be amd64 or arm64"; exit 2;; esac
# Graviton families carry a 'g' after the generation digit (c8g, c7gd, m7g ...)
if [[ $TYPE =~ ^[a-z]+[0-9]+g[a-z]*\. ]]; then WANT=arm64; else WANT=amd64; fi
[ "$WANT" = "$ARCH" ] || { echo "instance type $TYPE needs arch $WANT, not $ARCH"; exit 2; }
DISK_GB=100; DATA=sets-gcsn.tar.zst,emb-CodeRankEmbed-gcsn.tar.zst; BUNDLE=; IDLE_MIN=60; IOPS=; THROUGHPUT=; STOP_MIN=4320; SMOKE_BUILD=; SHARD=0/1
for kv in "$@"; do
  case "$kv" in
    DISK_GB=*|DATA=*|BUNDLE=*|IDLE_MIN=*|IOPS=*|THROUGHPUT=*|STOP_MIN=*|SMOKE_BUILD=*|SHARD=*) declare "${kv%%=*}=${kv#*=}";;
    *) echo "unknown option $kv"; exit 2;;
  esac
done
[[ $DISK_GB =~ ^[0-9]+$ ]] || { echo "DISK_GB must be a number"; exit 2; }
[[ $SHARD =~ ^[0-9]+/[0-9]+$ ]] || { echo "SHARD must be i/n"; exit 2; }
[[ $STOP_MIN =~ ^[0-9]+$ ]] && [ "$STOP_MIN" -le 4320 ] || { echo "STOP_MIN must be a number <= 4320 (the 72-hour stop)"; exit 2; }

if [ $DRY = 1 ]; then
  AMI="<AMI-from-SSM /aws/service/canonical/ubuntu/server/24.04/stable/current/$ARCH/hvm/ebs-gp3/ami-id>"
  BUNDLE=${BUNDLE:-<newest ss-HEAD-*.tar.zst in the bucket>}
else
  BUNDLE=${BUNDLE:-$(aws s3 ls "s3://$BUCKET/hnsw/code/" | awk '{print $4}' | grep '^ss-HEAD-.*\.tar\.zst$' | sort | tail -1)}
  [ -n "$BUNDLE" ] || { echo "no code bundle in the bucket: upload one first (make_bundles.sh)"; exit 1; }
  AMI=$(aws ssm get-parameter --name "/aws/service/canonical/ubuntu/server/24.04/stable/current/$ARCH/hvm/ebs-gp3/ami-id" --query Parameter.Value --output text)
fi
EBS="VolumeSize=$DISK_GB,VolumeType=gp3,DeleteOnTermination=true"
[ -n "$IOPS" ] && EBS+=",Iops=$IOPS"; [ -n "$THROUGHPUT" ] && EBS+=",Throughput=$THROUGHPUT"
TAGS="{Key=Project,Value=$TAG_PROJECT},{Key=Name,Value=hnsw-$NAME}"

UD=$(mktemp)
cat > "$UD" <<UDATA
#!/bin/bash
shutdown -h +$STOP_MIN
export MACHINE=$NAME MODE=$MODE BUCKET=$BUCKET BUNDLE=$BUNDLE DATA=$DATA IDLE_MIN=$IDLE_MIN SMOKE_BUILD=$SMOKE_BUILD SHARD=$SHARD
for i in 1 2 3 4 5 6; do command -v aws >/dev/null && break; sleep 10; done
if ! command -v aws >/dev/null; then apt-get update -q && apt-get install -y -q unzip curl && curl -sSfo /tmp/a.zip "https://awscli.amazonaws.com/awscli-exe-linux-\$(uname -m).zip" && unzip -q /tmp/a.zip -d /tmp && /tmp/aws/install; fi
aws s3 cp --only-show-errors "s3://$BUCKET/hnsw/code/bootstrap.sh" /opt/hnsw-bootstrap.sh && bash /opt/hnsw-bootstrap.sh
UDATA

CMD=(aws ec2 run-instances --image-id "$AMI" --instance-type "$TYPE" --key-name "$KEY_NAME" --security-group-ids "$SG"
  --iam-instance-profile "Name=$INSTANCE_PROFILE" --instance-initiated-shutdown-behavior terminate
  --block-device-mappings "DeviceName=/dev/sda1,Ebs={$EBS}"
  --tag-specifications "ResourceType=instance,Tags=[$TAGS]" "ResourceType=volume,Tags=[$TAGS]"
  --user-data "file://$UD" --query 'Instances[0].InstanceId' --output text)
if [ $DRY = 1 ]; then
  echo "DRY RUN: nothing is launched. Command:"; printf '  %q' "${CMD[@]}"; echo
  echo "--- user data ---"; cat "$UD"; echo "--- end ---"; rm -f "$UD"; exit 0
fi
ID=$("${CMD[@]}")
rm -f "$UD"
echo "$ID  $NAME $TYPE $ARCH disk=${DISK_GB}GB mode=$MODE bundle=$BUNDLE"
