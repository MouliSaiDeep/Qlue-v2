#!/bin/bash
set -euo pipefail
dnf install -y docker
dnf upgrade -y --security
systemctl enable --now docker
mkdir -p /opt/qlue-audio
aws s3 cp '{{SOURCE_URI}}' /opt/qlue-audio/source.zip --region us-east-1
echo '{{SOURCE_SHA}}  /opt/qlue-audio/source.zip' | sha256sum --check
python3 -m zipfile -e /opt/qlue-audio/source.zip /opt/qlue-audio
TOKEN=$(curl -fsS -X PUT -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' http://169.254.169.254/latest/api/token)
INSTANCE_ID=$(curl -fsS -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id)
cat >/opt/qlue-audio/environment <<'ENV'
AWS_REGION=us-east-1
AWS_STT_ENABLED=true
GATEWAY_INGRESS=cloudfront-ec2
AUDIO_HOSTING=ondemand
STT_SESSIONS_TABLE={{STT_TABLE}}
SESSIONS_TABLE={{SESSIONS_TABLE}}
DELETION_JOBS_TABLE={{DELETIONS_TABLE}}
VOCABULARY_MANIFEST={{VOCABULARY}}
GLOBAL_STREAM_SLOTS=4
DAILY_STREAM_LIMIT=160
ENV
echo "INSTANCE_ID=$INSTANCE_ID" >>/opt/qlue-audio/environment
chmod 600 /opt/qlue-audio/environment
cat >/opt/qlue-audio/start <<'START'
#!/bin/bash
set -euo pipefail
IMAGE='{{IMAGE}}'
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin '{{REGISTRY}}'
  docker pull "$IMAGE"
  docker logout '{{REGISTRY}}'
fi
docker rm -f qlue-audio 2>/dev/null || true
exec docker run --name qlue-audio --network host --read-only --cap-drop ALL \
 --security-opt no-new-privileges --pids-limit 128 --memory 512m \
 --mount type=bind,source=/opt/qlue-audio/src,target=/app/src,readonly \
 --env-file /opt/qlue-audio/environment \
 --log-driver awslogs --log-opt awslogs-region=us-east-1 \
 --log-opt awslogs-group='{{LOGS}}' --log-opt awslogs-stream=audio \
 "$IMAGE"
START
chmod 700 /opt/qlue-audio/start
cat >/opt/qlue-audio/idle-stop.py <<'PY'
{{IDLE_CODE}}
PY
cat >/etc/systemd/system/qlue-audio.service <<'UNIT'
[Unit]
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service
[Service]
ExecStart=/opt/qlue-audio/start
ExecStop=/usr/bin/docker stop --time 15 qlue-audio
Restart=always
RestartSec=5
TimeoutStopSec=30
[Install]
WantedBy=multi-user.target
UNIT
cat >/etc/systemd/system/qlue-audio-idle.service <<'UNIT'
[Unit]
After=qlue-audio.service network-online.target
[Service]
EnvironmentFile=/opt/qlue-audio/environment
ExecStart=/usr/bin/python3 /opt/qlue-audio/idle-stop.py
Restart=on-failure
RestartSec=30
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now qlue-audio.service qlue-audio-idle.service
