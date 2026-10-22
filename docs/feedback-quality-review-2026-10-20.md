# Review of the two latest interview reports

The subsequent [21 October repair](feedback-quality-fix-2026-10-21.md) addresses
the defects below and records the regenerated reports and updated APK. This
document preserves the findings from the earlier read-only review.

Read-only review of the same account previously investigated. No application
source, live report, deployment, quota or model configuration was changed.
No additional model request was made. Full owned records are retained only in
the ignored private diagnostic folder.

| Interview start, 20 October 2026 (IST) | Overall | Four criterion marks |
| --- | --- | --- |
| 22:44 | 25/100 | 25, 25, 25, 25 |
| 18:21 | 50/100 | 50, 50, 50, 50 |

Both INTRO reports are complete and their weighted arithmetic is correct.
Completion, arithmetic and substring grounding do not establish assessment
quality. The latest report in particular does not substantiate its low marks.

## Confirmed pairing defect

`backend/src/lib/feedbackTranscript.js` deliberately retains separate USER and
AI rows using speaker plus event ID. Both sides of a turn legitimately share
an event ID. However, `feedbackAssessment.pairs()` constructs a map indexed
only by event ID. When the AI follow-up is also selected as context for the
next answer, its later row overwrites the candidate's first answer in that map.

In both reviewed interviews, the first input supplied to assessment is the AI
coaching reply instead of the original candidate introduction. The original
USER text and ASR metadata remain in storage. This is a backend selection
defect, not evidence that the microphone recorded the AI voice. Both reports
therefore show an invalid zero baseline and invalid practice-improvement marks.

The final revised answer is selected correctly in both interviews and owns the
overall INTRO score. The baseline defect alone does not establish the cause
of every low final mark. That grading-quality issue must be evaluated separately.

A synthetic reproduction with shared USER/AI event IDs confirms the overwrite:
`tmp/feedback-layout-fix-20261020/reproduce-pairing.cjs`. Existing pairing
coverage uses distinct IDs for USER and AI and consequently misses this case.
The initial trigger builds answer pairs using this helper; correcting only the
analysis Lambda would not fix pair payloads already built by the trigger.

## Assessment and coaching quality

The latest final answer includes education, a year of Flutter internship
experience, the mock-interview project's purpose, and a list of relevant
technical skills. The report nevertheless labels it mostly generic/tangential,
claims only general unsupported statements, assigns level 1 to every criterion,
and lists no strengths. It quotes the opening identity/education fragment for
all four dimensions, rather than examining the internship and project content.
These excerpts do not justify the report's broad conclusions.

The earlier final answer additionally mentions a top-five project-event result.
The report does cite that achievement once, but still provides mostly generic
advice and no strengths. There are reasonable improvement opportunities in both
answers: distinguish the candidate's own implementation work, explain an outcome
or learning, and give a clear closing. Those opportunities should be stated
alongside demonstrated strengths, with criterion-specific support.

The code creates most visible feedback from fixed level-to-text templates.
The model supplies levels and references but no substantive explanation of why
each criterion received its level. Thus genuine source excerpts can accompany
a poorly justified judgment. ASR punctuation and apparent word substitutions
also require care; they are not reliable evidence of poor speaking ability.

## Recommended repair order

1. Resolve answer and question rows using their respective USER and AI
   namespaces. Add realistic shared-ID regressions and fail closed on missing
   or ambiguous accepted pairs. Preserve raw records and accepted manifests.
2. Require short, criterion-specific observations and an explanation of the
   relevant gap, grounded in appropriate excerpts from the complete answer.
   Acknowledge demonstrated content and avoid double penalties for one omission.
3. Replace generic visible coaching with validated, answer-specific guidance;
   retain server-owned weights, bounded levels and strict ownership checks.
4. Evaluate against human-reviewed examples including these two interviews,
   brief complete answers, weak answers and ASR artifacts. Do not force marks
   to vary or invent a replacement score without that evaluation.
5. Reprocess the affected reports only after the fixes have been verified.

The earlier repair restored report generation and prevented uncertain audio
from being quoted as evidence. It did not establish human-calibrated accuracy;
the current assessment metadata correctly remains `NOT_HUMAN_CALIBRATED`.
