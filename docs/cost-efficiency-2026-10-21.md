# Cost efficiency — 21 October 2026

The supplied AWS Billing dashboard screenshot shows **$1.69 month to date**.
This is a dashboard, not an itemized invoice. A single account-wide Cost Explorer
check for 1–21 October returned $1.6893392198 usage before credits, with matching
credits and a net total rounding to $0. Billing data is delayed, credits are
temporary, and the dashboard forecast does not reliably represent the newly
deployed audio infrastructure's full-month cost.

Largest gross lines at that check:

| Service | USD |
|---|---:|
| Polly | 0.61648 |
| Load balancing | 0.36009 |
| DynamoDB | 0.22139 |
| ECS/Fargate | 0.15613 |
| KMS | 0.12600 |
| Public IPv4/VPC | 0.07934 |
| Bedrock | 0.06244 |

Polly's generative speech accounted for $0.58152 of its line; neural speech
accounted for $0.03496. The current voice selection and model quality are
preserved by this hosting change. These providers are charged for actual use.
KMS charges in this snapshot are requests, not a customer-managed-key monthly
fee. Do not delete encryption keys or disable encryption to address that line.

## Main saving

The prior audio gateway ran one ARM Fargate task continuously: 0.25 vCPU,
0.5 GiB, one public IPv4, and an internal ALB. At the previously verified
us-east-1 rates and 730 hours/month, those running charges total about
**$27.28/month** before ALB LCUs, traffic, storage and monitoring. Stopping
the task alone would leave the ALB's hourly charge.

The replacement uses a small ARM host that wakes for owned interview demand
and stops after five idle minutes. CloudFront accesses it privately, with
no load balancer, NAT gateway, Elastic IP or provisioned Lambda concurrency.
Its automatically assigned public IPv4 is released while stopped.
The existing audio URL, Transcribe, one-use ticket security, vocabulary,
authoritative recognition evidence, noise handling and hands-free submission
are preserved. A compatible APK waits through the cold start without opening
the microphone early. Interview screen layout is unchanged.

The retained encrypted 8-GiB gp3 disk is about **$0.64/month** at $0.08/GiB-month,
even while compute is stopped. Other retained data, backups, container images,
logs, queue polling and monitoring can also cost money. Plan for a small
non-zero baseline; this is not a promise of a zero invoice. Active interview
audio, speech output and model calls remain variable charges.

All 14 application tables already use pay-per-request billing. There were
no NAT gateways, Elastic IP allocations, other EC2 instances or interface
endpoints in the inspected region. The deployed application template contains
no EventBridge scheduled rules. Existing recovery is driven by streams and
bounded queued work. Existing backups, encryption and operational alarms are
preserved. No user data is deleted for cost savings.

## Validation and rollback

The first attempted new stack hit the account's low Lambda concurrency limit
because a wake-function reservation would leave too little unreserved capacity.
The corrected design uses ordinary on-demand Lambda concurrency. The failed
test stack is separate from the working deployment and is cleaned up separately.
Live idle testing also exposed that overlapping replacement hosts needed
independent wake/shutdown records. These now use `HOST#<instance-id>` instead
of shared rollout control. The failed test instance was terminated, the wake
Lambda code was updated through a reviewed change set, and the persistent idle
watchdog file was updated through SSM without restarting the audio container.
The versioned generator includes this corrected bootstrap code for future hosts.

The current scope changes initialization and ticket code plus their scoped
invoke permission. Other function packages and configuration remain unchanged.
In particular the daily cap remains **10 interviews per user**, with the
separate 500 provider-attempt and 160 audio-start per-user safeguards intact.

Local checks: 74 backend suites / 556 tests, then 48 focused tests after two
additional prewarm checks; 24 gateway checks; 11 wake/idle race, admission and
OS-boot fencing checks; 24 Flutter transcription checks,
including cancelled cold starts; targeted Flutter analysis; SAM and
CloudFormation lint. The APK keeps package `com.qlue.sloths1`, version
`1.0.9+10009`, release certificate and 16-KiB alignment.

The first live synthetic audio test through the new private origin passed:
8.56 seconds of audio, finalized authoritative evidence, technical vocabulary,
ownership rejection and synthetic-data cleanup. This is an operational smoke
test, not a broad transcription-quality or load benchmark.

The cold-start test subsequently passed too: the owned ticket request woke
the stopped host in **16.824 seconds**, then completed transcription and cleanup.
After five idle minutes the host again stopped itself and released its public
IPv4. This directly verifies the idle behavior rather than inferring it from
a scale-to-zero configuration. Prewarming at interview initialization overlaps
some startup with interview preparation; it does not guarantee a fixed delay
on every phone or every AWS start.

The old ALB and Fargate cluster were removed. Final inventory checks verified
all 61 application functions and unchanged packages for the other 59 functions,
with the ten-interviews-per-user limit intact. The failed test stack was removed.
The host's bootstrap is synchronized with the tested host-specific watchdog so
future replacements receive the same operational-state isolation.
The watchdog also distinguishes OS boot IDs: an administrative or CloudFormation
start clears the previous boot's shutdown claim, while a watchdog restart in
the same boot preserves its current claim. The final bootstrap synchronization
was limited to user data on the existing EBS-backed host; its instance ID and
private origin remain unchanged.

At the verified regional EC2 rate of $0.0084/hour plus $0.005/hour for its
temporary public IPv4, active hosting is about **$0.0134/hour**, plus the retained
disk. At one active hour per day over 30 days, that component is about
**$1.04/month including the disk**, before other application storage/monitoring
and actual Transcribe, Polly and model usage. A fully idle host retains only
the roughly $0.64/month disk component of these three charges. These figures
do not describe the complete AWS account bill.

Final APK: `output/Qlue-1.0.9-low-idle-cost.apk`, 79,941,633 bytes.
SHA-256: `38f8abc203c4f0530ff9fe0e05bd8bdef208df0b1d08cd37fc18c867737c3238`.
The cancellation fix prevents a completed readiness request from opening the
microphone after capture was stopped, including during a long cold start.

Final verification completed at 16:54 IST on 21 October 2026. All three stacks
were `UPDATE_COMPLETE`; the existing audio domain and private origin were
verified; the old ALB and ECS cluster were absent; and the same host stopped
automatically after its final maintenance restart, with no public IPv4.
The final signed APK hash, all 61 application functions, and the per-user
limits passed verification. Evidence: `tmp/cost-efficiency-20261021/verification.json`.

Infrastructure snapshots, reviewed change sets and test evidence are retained
under ignored `tmp/cost-efficiency-20261021/private/`. The old hosting was
retired only after real idle stop and demand-triggered cold-wake tests passed.
Rollback needs the previous routing, application template/code, and a healthy
running Fargate task. No Git commit or push is part of this work.

## Pricing references

- [ALB pricing](https://aws.amazon.com/elasticloadbalancing/pricing/)
- [Fargate pricing](https://aws.amazon.com/fargate/pricing/)
- [Public IPv4 pricing](https://aws.amazon.com/vpc/pricing/)
- [EBS pricing](https://aws.amazon.com/ebs/pricing/)
- [CloudFront VPC origins](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-vpc-origins.html)
- [Polly pricing](https://aws.amazon.com/polly/pricing/)

Check actual costs after billing has caught up. Do not continuously poll Cost
Explorer: its API requests can themselves be charged. All estimates exclude
tax, exchange rates, discounts, free tiers and promotional credits.
