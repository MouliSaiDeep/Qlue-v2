# Qlue cost analysis — 20 October 2026

Deployment update: the later [backend release](backend-release-2026-10-20.md)
activated the feedback/per-user quota changes and replaced the shared audio
daily limit. The limitations section below describes the earlier assessment
snapshot. The same gateway task size and count remain, so the hosting estimate
does not change merely because the code and admission scope changed.

Read-only assessment of the deployed us-east-1 gateway, current source and AWS
published standard/on-demand rates. No backend configuration, resource, budget,
quota or application file was changed during this analysis.

## Observed billing versus ongoing cost

Cost Explorer returned estimated account-wide costs for October 1–20, queried
with an exclusive end date of October 21:

| Reported usage | USD before credits |
| --- | ---: |
| Polly | 0.56326 |
| DynamoDB | 0.2173513 |
| KMS | 0.122529 |
| Bedrock | 0.0503437 |
| Other reported services | 0.0348127 |
| Total usage | **0.9882967** |
| Credits | **-0.9882968** |
| Net, rounded | **0.00** |

This is the entire AWS account, not project-attributed billing. It is not an
invoice or a forecast. Billing is delayed and the newly running gateway's full
Fargate/ALB/IPv4 cost is not represented in this returned usage. Credits and
free-tier allowances are excluded from all forward estimates below. This
snapshot also does not establish remaining credits or their expiration date.

Evidence: `tmp/cost-analysis-20261020/account-month-to-date.json`.

## Fixed audio hosting

Live ECS configuration: one running ARM64 task, 0.25 vCPU, 0.5 GiB, public task
IPv4 enabled. The ALB is internal behind CloudFront. There is no NAT gateway in
this deployed audio architecture.

Using 730 hours/month:

| Component | Calculation | USD/month |
| --- | --- | ---: |
| ARM Fargate task | 730 × 3600 × (0.25 × 0.0000089944 + 0.5 × 0.0000009889) | 7.21 |
| Internal ALB hourly charge | 730 × 0.0225 | 16.43 |
| One task public IPv4 | 730 × 0.005 | 3.65 |
| Audio-hosting subtotal | Unrounded sum | **27.28** |

Add ALB capacity usage, CloudFront traffic/requests, ECR storage, logs, database
storage/backups and monitoring. Eleven Qlue standard-resolution alarm metrics
were found; their list-price cost is approximately $1.10/month before allowances.
For small retained datasets, use **$30–$40/month** as a planning baseline, not
a guaranteed maximum. Retained data and custom monitoring can increase it.
No Qlue regional WAF ACL was found; do not attribute the account's tiny WAF
billing line to this project without further evidence.

Sources: [Fargate ARM example](https://aws.amazon.com/fargate/pricing/),
[ALB pricing](https://aws.amazon.com/elasticloadbalancing/pricing/),
[public IPv4](https://aws.amazon.com/vpc/pricing/),
[CloudWatch](https://aws.amazon.com/cloudwatch/pricing/).

## Variable cost per interview

Illustrative typical workload, not a measured production average:

- Eight minutes of billable user-audio streaming, including any silence sent.
- 2,000 characters of AI speech using the current generative voice setting.
- 20,000 total input tokens and 2,000 total output tokens across conversation
  and feedback calls; repeated history contributes to these totals.
- Ordinary API, Lambda, transactional database, queue, storage, logging and
  network activity, without unusually heavy retries or repeated uploads.

| Component | Verified rate / assumed usage | USD/interview |
| --- | --- | ---: |
| Transcribe standard streaming | Approximately $0.01/minute × 8 | 0.0800 |
| Polly generative speech | $30/million characters × 2,000 | 0.0600 |
| Nemotron 3 Super 120B | $0.15/million input, $0.65/million output | 0.0043 |
| Other variable services | Planning allowance, not measured unit cost | 0.0057 |
| Typical modeled total | Rounded | **0.15** |

The AWS Pricing API independently returned standard `StreamingAudio` in
us-east-1 at $0.0001667/second, approximately $0.010002/minute. Current published
streaming pricing is billed in one-second increments without a minimum. Do not
reuse older $0.024/minute or 15-second-minimum figures for this estimate.
Custom technical vocabulary is included in standard pricing; this deployment
does not enable the separately charged custom language model or redaction.

The new feedback evaluator uses the existing model and resources. It removes a
separate narrative-generation model call. Its larger rubric/input/output can
change token usage, so this does not prove a fixed percentage saving or halve
the application's overall bill. Both existing and proposed feedback paths are
small compared with audio in this example.

Sources: [Transcribe](https://aws.amazon.com/transcribe/pricing/),
[Polly](https://aws.amazon.com/polly/pricing/),
[Bedrock NVIDIA us-east pricing](https://aws.amazon.com/bedrock/pricing/).
Captured catalog results: `tmp/cost-analysis-20261020/transcribe-api-prices.json`.

## Monthly workload scenarios

Planning formula: **monthly cost ≈ $30–$40 + $0.15 × completed interviews**,
subject to the example workload, retained storage and capacity changes.

INR illustrations use a rounded planning exchange rate of ₹95/USD, consistent
with the current [Wise USD/INR reference](https://wise.com/us/currency-converter/usd-to-inr-rate/history/20-10-2026).
These are before tax, credits, discounts and payment/billing conversion fees.

| Interviews/month | Estimated USD/month | Approximate INR/month |
| ---: | ---: | ---: |
| 100 | 45–55 | 4,275–5,225 |
| 300 | 75–85 | 7,125–8,075 |
| 1,000 | 180–190 | 17,100–18,050 |
| 3,000 | 480–490 | 45,600–46,550 |

The ten-interviews-per-user-per-day policy permits **300 interviews per user
in a 30-day month**, or approximately **$45 / ₹4,275 variable cost per fully
active user per month**, before their share of hosting. Ten such users imply
3,000 interviews and roughly $480–$490/month including the small-deployment
baseline. One hundred such users imply $4,500/month in interview usage alone,
plus hosting and any required capacity increase. These are usage ceilings under
the example assumptions, not expected average engagement or hard spend caps.

For sensitivity: each extra streamed minute adds about $0.01; each extra 1,000
generative-speech characters adds $0.03. An interview with 24 streamed minutes
would therefore cost approximately $0.31 with the other assumptions unchanged.
Retries can add cost even if an interview does not complete.

## Scope and remaining limitations

- Current deployment still has the shared 50-provider-attempt guard. The
  per-user quota/provider isolation and rubric changes are local and undeployed.
  Fifty attempts is a call counter, **not $50**.
- An additional shared gateway test guard remains: **20 stream starts/day**,
  four concurrent audio streams and a 180-second limit per stream. One stream
  start is generally an answer capture, not an interview. The daily guard has
  not yet been made per-user. This must be corrected before promising ten full
  interviews per user daily. No limit was changed by this read-only analysis.
- At high volumes the monthly scenarios require admission and capacity changes.
  Four simultaneous streams provide at most 172,800 stream-minutes per 30-day
  month even at continuous use; 30,000 eight-minute interviews need 240,000.
  Peak traffic and availability requirements matter well before that maximum.
- Firebase authentication and Cognito-managed email verification are part of
  this application. They are not a flat per-interview SES expense. Their own
  allowances and active-user pricing should be checked as enrollment grows:
  [Firebase](https://firebase.google.com/pricing),
  [Cognito](https://aws.amazon.com/cognito/pricing/).
- Resume/JD processing, scanned-document Textract OCR, optional scrape.do
  subscription/credits, substantial retained storage, developer tooling and
  non-AWS invoices are outside the example interview cost. Local PDF text
  extraction does not require OCR for every resume. Reusing a parsed resume
  avoids paying its parsing/OCR cost again for every interview.

## Practical cost priorities

1. Keep ten-session admission per account; finish gateway admission isolation
   before broader rollout. Preserve anti-abuse checks and bounded retries.
2. Cache safe reusable Polly openings/closing lines. Polly permits cached audio
   replay without another synthesis charge; dynamic/personalized prompts still
   require their own audio.
3. Close streams promptly after answer completion and during playback. Local
   VAD/zero-filled noise suppression improves input but does not remove billed
   audio duration by itself.
4. Keep natural generative speech if it is a product requirement. An optional
   neural voice would reduce this example's Polly component from $0.060 to
   $0.032, saving about 19% of variable interview cost, with different voices.
5. At low usage, the ALB is the largest fixed cost. Scaling the task to zero
   alone does not remove its $16.43/month base charge. A cheaper hosting design
   needs a separate reliability/security review; no infrastructure was removed.

Read-only evidence and scripts are in `tmp/cost-analysis-20261020/`. Production
code, frontend, limits, deployed services and Git history were not modified by
this cost analysis.
