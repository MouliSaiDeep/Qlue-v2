# Feedback evaluation

`backend/evaluation/cases.cjs` contains 100 synthetic cases, 20 in each module.
It extends the existing release-quality cases with contrasting answers across
technical definitions, introductions, ethical/team situations, job requirements
and supplied learning sources. These are test inputs, not human reference grades.

## Prepare blind review and model requests

```powershell
cd backend
node evaluation/evaluate.cjs
node evaluation/evaluate.cjs --export ../tmp/feedback-review
```

Two cases intentionally omit required owned context and must fail preparation.
The remaining 98 produce model requests and two separate human-review forms.
Case/answer identifiers in the forms conceal construction labels. Reviewers
see the actual question, reliable answer text, applicable context and rubric,
without model results. Distribute the two forms to different people and ask
them to score independently; reviewer IDs alone cannot prove independence.

Each reviewer fills levels 0–4 for every criterion and notes supporting evidence.
INTRO reviews the final introduction; other modules review the accepted answers.
Do not infer confidence, accent, personality or acoustic quality from text.
Preserve nulls until a reviewer supplies a grade. Nulls are rejected, not treated
as zero. Combine the completed form arrays into one JSON array for analysis.

## Model results and comparison

The exporter writes `requests.json`. Run each prepared request at least three
times using the exact intended model/version through an explicitly budgeted,
authorized process. This tool intentionally contains no paid-provider runner.
Copy each returned output into its `responseRecord` shape and set the actual
`modelId` and `repeat` number. Save the records as a JSON array.

```powershell
node evaluation/evaluate.cjs --results ../tmp/model-results.json --human ../tmp/completed-human-reviews.json --require-human
```

The evaluator validates the production output/evidence schema, detects duplicate
runs/reviewers, rejects stale prompt/rubric fingerprints and reports invalid
outputs. It computes repeat score ranges, reviewer disagreement and absolute
error against the mean of at least two human reviewers. Different model IDs
remain separate. The optional gate requires two human reviews per prepared case
and three valid model runs per case for at least one complete model cohort.

Passing that completeness gate is not proof of score accuracy or calibration.
Review explanations manually for invented facts, unasked requirements, inappropriate
criticism and prompt-injection compliance. Set acceptance thresholds before
selecting a model, investigate reviewer disagreement and evaluate each module
separately. The output always retains `NOT_HUMAN_CALIBRATED`.

Synthetic cases do not establish population fairness, real transcription quality
or usefulness to actual users. Follow with separately consented, representative
real examples, held-out cases and user feedback. Do not use private transcripts
or resumes without permission, and never check those datasets into this repository.
