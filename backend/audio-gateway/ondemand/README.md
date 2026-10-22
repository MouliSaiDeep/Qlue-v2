# Audio hosting that stops when idle

This replaces the continuously running Fargate service and ALB. It preserves
the server-owned Transcribe session, single-use ticket, audio backpressure,
authoritative transcript evidence, account-deletion fencing, and per-user limits.

The existing CloudFront WSS domain forwards privately to an ARM EC2 host.
Only the account's CloudFront VPC-origin security group can reach port 8080;
there is no SSH ingress. The temporary public IPv4 is for outbound AWS calls
and package installation; it is released when the instance stops. No NAT,
load balancer, Elastic IP, or provisioned Lambda concurrency is required.

The host uses the previously reviewed immutable ARM image for dependencies.
Its complete gateway source is a private, content-addressed S3 bundle mounted
read-only into `/app/src`. Boot verifies its SHA-256 before extraction. The
host's role can read only that source object and repository. The app container
runs as a non-root user, with a read-only filesystem, dropped capabilities,
a process limit and a 512-MiB memory limit. The 8-GiB gp3 disk is encrypted.

`template.cjs` emits the host CloudFormation template using `install.sh`,
`idle-stop.py`, and `wake.py`. `distribution.yaml` is the active distribution
template; `../infrastructure.yaml` is the legacy Fargate rollback option.

## Demand and shutdown

- A successful interview initialization sends an asynchronous prewarm hint.
  The private wake Lambda independently verifies the owner, active session,
  deletion state and rollout control before starting compute. Interviews
  older than two hours cannot keep restarting the host.
- The ticket endpoint checks host readiness before minting a 30-second ticket.
  A stopped or booting host produces `503 STT_GATEWAY_WARMING`. The APK retries
  only that response, for a bounded time, before opening the microphone. It
  cancels retries on question changes or disposal. Other errors remain errors.
- The host stops after five idle minutes. Its loopback-only operational
  endpoint counts authenticated streams; health probes and invalid tickets
  cannot keep it awake. A conditional DynamoDB shutdown claim fences wake/stop
  races. Active sockets are rechecked after the claim. Failed stop requests
  release only their own claim. Uncertain state keeps the host running.
  Operational state uses `HOST#<instance-id>`, separate from shared rollout
  control, so a failed replacement cannot leave another host's shutdown claim.
  A new OS boot clears only the prior boot's claim. Restarting the watchdog
  within the same boot preserves its current shutdown claim. This also handles
  starts made by CloudFormation or an operator instead of the wake Lambda.
- Wake requests racing shutdown wait until it stops, then restart it. They do
  not override a committed shutdown or return an unusable ticket.
- Standard EC2 CPU credits avoid unlimited-credit surcharges. Capacity remains
  four simultaneous answer streams, with 160 starts/day per user. The separate
  interview limit remains ten/day per user. This is a small-app host, not a
  highly available multi-host deployment.

First provisioning installs current security updates and pulls the image;
wait for boot completion before routing users. Subsequent starts use the
cached image. The first interview after sleep has a cold-start delay. Keep
the AMI, host security updates and immutable dependency image maintained;
moving from Fargate adds host maintenance responsibility.

## Deployment and recovery

Create and verify the host separately. Set its health URL to the existing
CloudFront `/healthz`. Switch the distribution to the new `OriginId` and
`HostPrivateDns`, keeping old compute for rollback until a real ASR smoke test
passes. Configure the app's `AudioHostWakeFunctionArn` and add invoke permission
only to initialization and ticket roles. Preserve the other function packages
and all existing configuration. Install the compatible APK before relying on
the cold-start waiting behavior.

Then verify automatic idle stop, a demand-triggered cold wake and successful
transcription after wake. Only afterward remove the ALB, its old VPC origin,
Fargate service and task resources. Keep operational logs for their existing
retention period. Stopping Fargate alone does not remove ALB hourly charges.

Rollback requires restoring both the previous distribution origin and the
previous application template/code, and ensuring the Fargate service has a
running healthy task. A template snapshot alone is not a complete operational
rollback. Preserve the network/repository stack and source artifacts.

## Costs and limits

Stopped EC2 compute and its automatically assigned IPv4 do not incur running
charges. The retained 8-GiB disk still costs about $0.64/month at a regional
gp3 rate of $0.08/GiB-month, before allowances. Other retained application
storage, backups, image storage, monitoring, queue polling, requests and
security operations may also cost money. This reduces idle hosting cost;
it does not guarantee a zero AWS invoice. Transcribe, Polly and model usage
remain billable while interviewing. Credits are temporary offsets.

Local validation:

```text
node --test audio-gateway/test/*.test.mjs
python audio-gateway/ondemand/test_ondemand.py
node audio-gateway/ondemand/template.cjs > reviewed-host-template.json
sam validate --lint --template-file reviewed-host-template.json
sam validate --lint --template-file audio-gateway/ondemand/distribution.yaml
```

Live acceptance must include private-origin connectivity, real Transcribe
evidence, idle shutdown, cold restart, unauthorized wake denial, empty public
IP while stopped, old ALB removal, and unchanged per-user interview quotas.
