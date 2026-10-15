#!/bin/bash
# launch.sh <name> <instance-type> <amd64|arm64> <mode-chain> [DATA=a,b] [BEIR_DATA=1] [IDLE_MIN=60] [SHUTDOWN=terminate]
#
# One on-demand instance: Ubuntu 24.04 (AMI from SSM), 80 GB gp3, shutdown behaviour
# terminate (SHUTDOWN=stop only for the C0 tuning machines: the disk and the builds survive a
# watchdog shutdown, and `aws ec2 start-instances` resumes the work), the instance profile, tags Project / Name=maxsim-<name>, and user data that
# starts with a 72-hour safety stop, then runs bootstrap.sh from the bucket. Account values
# come from env.local (git-ignored). Prints the instance ID. Run only after the owner's go.
set -euo pipefail
H=$(cd "$(dirname "$0")" && pwd); . "$H/env.local"
NAME=$1; TYPE=$2; ARCH=$3; MODE=$4; shift 4
DATA=agent-dev.tar.zst,gcsn-dev.tar.zst; BEIR_DATA=; IDLE_MIN=60; SHUTDOWN=terminate
for kv in "$@"; do eval "$kv"; done
case $SHUTDOWN in terminate|stop) ;; *) echo "SHUTDOWN must be terminate or stop"; exit 1;; esac
BUNDLE=${BUNDLE:-$(aws s3 ls "s3://$BUCKET/code/" | awk '{print $4}' | grep '^ss-HEAD-.*\.tar\.zst$' | sort | tail -1)}
LEGACY_BUNDLE=${LEGACY_BUNDLE:-ss-f1ee878b.tar.zst}
AMI=$(aws ssm get-parameter --name "/aws/service/canonical/ubuntu/server/24.04/stable/current/$ARCH/hvm/ebs-gp3/ami-id" --query Parameter.Value --output text)
UD=$(mktemp)
cat > "$UD" <<UD
#!/bin/bash
shutdown -h +4320
export MACHINE=$NAME MODE=$MODE BUCKET=$BUCKET BUNDLE=$BUNDLE LEGACY_BUNDLE=$LEGACY_BUNDLE DATA=$DATA BEIR_DATA=$BEIR_DATA IDLE_MIN=$IDLE_MIN
for i in 1 2 3 4 5 6; do command -v aws >/dev/null && break; sleep 10; done
if ! command -v aws >/dev/null; then apt-get update -q && apt-get install -y -q unzip curl && curl -sSfo /tmp/a.zip "https://awscli.amazonaws.com/awscli-exe-linux-\$(uname -m).zip" && unzip -q /tmp/a.zip -d /tmp && /tmp/aws/install; fi
aws s3 cp "s3://$BUCKET/code/bootstrap.sh" /opt/bootstrap.sh && bash /opt/bootstrap.sh
UD
ID=$(aws ec2 run-instances --image-id "$AMI" --instance-type "$TYPE" --key-name "$KEY_NAME" --security-group-ids "$SG" \
  --iam-instance-profile "Name=$INSTANCE_PROFILE" --instance-initiated-shutdown-behavior "$SHUTDOWN" \
  --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=80,VolumeType=gp3,DeleteOnTermination=true}' \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Project,Value=$TAG_PROJECT},{Key=Name,Value=maxsim-$NAME}]" \
                       "ResourceType=volume,Tags=[{Key=Project,Value=$TAG_PROJECT},{Key=Name,Value=maxsim-$NAME}]" \
  --user-data "file://$UD" --query 'Instances[0].InstanceId' --output text)
rm -f "$UD"
echo "$ID  $NAME $TYPE $ARCH mode=$MODE shutdown=$SHUTDOWN bundle=$BUNDLE"
