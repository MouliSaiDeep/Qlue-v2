# Public-launch readiness

Status: local implementation and verification. Live capacity and routing have
not been changed by this work. Historical hosting records describe a single
host that stops when idle; a public launch needs fresh cloud acceptance.

## Capacity design

`backend/audio-gateway/infrastructure.yaml` supports an opt-in multi-task
Fargate service. With `ProvisionGateway=true`, `PublicLaunchScaling=true` and
`DesiredCount=2`, it maintains at least two tasks and permits scale-out to six.
CPU target 60% and memory target 70% are initial engineering settings to validate
under realistic load. Scale-in is disabled so low utilization does not itself
terminate long-lived answers. Operators must drain before a manual reduction.

These policies use the supported ECS predefined metrics documented by
[AWS](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-applicationautoscaling-scalingpolicy-predefinedmetricspecification.html).
The scalable target follows the documented
[ECS service resource format](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-applicationautoscaling-scalabletarget.html).
CPU/memory scaling is a safety measure, not a precise predictor of demand for
long-lived WebSockets. Low-CPU admission saturation can require manual scale-out.

All provisioning/scaling flags remain off by default. Fargate tasks, an ALB and
their networking incur running charges. Do not apply the single-host idle-cost
estimate to this topology. Obtain a current regional estimate for two baseline
tasks, six peak tasks, ALB/LCUs, IPv4/egress, logs, storage and provider usage.

The per-task transport limit is `MAX_CONNECTIONS_PER_TASK` (default 8, allowed
1–64). It includes sockets waiting for ticket authentication. The server-wide
audio slot setting and shared DynamoDB CONTROL record independently constrain
paid streams. Each replica must have the same reviewed global/daily settings.
The implementation supports at most 20 shared global streams; this work does
not raise that ceiling or any live cap. More replicas do not bypass it.

Start by verifying eight shared streams across two tasks, eight transport
connections per task, and the intended per-user limits. Check the actual AWS
Transcribe account/region concurrency quota first. Eight is a staged test target,
not established production capacity. Verify that one remaining task can serve
the selected target after a replica fails, using realistic audio and polling.

Use subnets spanning at least two availability zones and a healthy task in each.
Keep the existing private TLS routing, overwrite viewer-protocol headers, retain
the short-lived ticket boundary and remove stale wake-host configuration when
switching to always-running tasks. Preserve the current host during verification.

## Local concurrency checks

```powershell
cd backend/audio-gateway
npm test
node scripts/load-smoke.mjs --clients=24 --slots=12 --duration-ms=1600
```

The smoke opens real local WebSockets to two server instances sharing an atomic
in-memory database boundary. It asserts that the shared cap is respected, excess
clients fail visibly, accepted streams finalize and all leases are released.
Synthetic silence and a stub transcription provider ensure zero cloud calls.
The reported local p50/p95 admission times are not AWS latency measurements.

Transactions remain authoritative. Randomized slot starting points reduce
simultaneous callers contending on slot zero. Separate daily-limit and capacity
codes let the app stop futile daily-limit retries while retaining bounded busy
recovery. Existing gateway versions remain understood by the client.

## Cloud acceptance before public routing

- Test with owned synthetic users and an explicit provider-call/audio budget.
- Run realistic concurrent 30–180-second answers, plus a longer soak and bursts
  above the cap. Record admission, first-result/final-result latency and errors.
- Interrupt a replica mid-answer and verify honest draft/recovery behavior,
  lease expiry and successful new admission. No exactly-once audio replay is claimed.
- Exercise account deletion, expired credentials, wrong ownership, replayed
  tickets and disabled CONTROL while streams are active.
- Confirm ten interviews per user per UTC day remains independent of provider
  retry limits and audio-start limits. Check that unrelated users remain usable.
- Verify alarms reach a confirmed operator, rollback works and provider quotas
  cover the target load. Preserve all test evidence with build/config fingerprints.
- Complete the device and scoring reviews linked below, then increase traffic
  gradually while observing failures and cost per completed interview.

See [device acceptance](DEVICE_ACCEPTANCE.md), [operations](OPERATIONS.md) and
[feedback evaluation](FEEDBACK_EVALUATION.md). A passing synthetic smoke alone
does not satisfy these launch gates.
