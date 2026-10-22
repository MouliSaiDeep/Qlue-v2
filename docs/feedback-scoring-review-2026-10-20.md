# Feedback scoring review and stable UI restoration

The user requested the stable interview UI and advice on improving feedback
scoring. No backend scoring changes or deployment were requested in this step.

## Restored UI

`interview_session_screen.dart` and its layout regression fixture were restored
from tag `v1.0.9` (commit `447d2fcc0ec39f70e5f84e6d3de52df6c525015e`).
The screen, particle sphere, transcript viewport and recovery controls now
match that tag, after normalizing line endings. Microphone prewarming, local
WebRTC VAD, platform echo/noise controls and AWS Transcribe remain enabled.
The four-second endpoint and absence of a Done button are preserved.

The signed candidate is `output/Qlue-1.0.9-stable-ui-aws-stt.apk`, version
1.0.9+10009, 79,630,245 bytes. SHA-256:
`3bbabb82d1143c1fa0ee7295419f46663ee9937c1e5c4029a6bfbbcd0bd16d23`.
All 27 targeted UI/transcription tests passed. APK signature and 16-KB packaging
alignment verification passed; the signer matches the existing release.
No connected-phone visual or microphone acceptance check was performed.

## Confirmed scoring issues

1. **Input scope mismatch.** `triggerFeedbackGeneration.js` builds the entire
   conversation and supplies accepted answers and assessment context. However,
   `analyzeTranscript.js` only passes the conversation string to
   `buildScoringPrompt`, which explicitly asks to score the LATEST response.
   Questions, accepted-answer IDs and context are not mapped to explicit
   per-answer scoring units. The context and accumulated scores are ignored.
2. **Unreliable input can count against the candidate.** In the earlier verified
   interview, report text penalized the ending “People So. Yes.” even though
   those recognition confidences were only 0.0116, 0.0124 and 0.0235. The
   permanent transcripts also lose `asr` when asyncWorker reconstructs the
   processUserInput request, preventing durable confidence-aware evaluation.
3. **Invented fallback scores.** JSON parse failure falls back to 50 on every
   dimension; missing dimensions also become 50. `dimensionScores[d] || 50`
   additionally changes zero to 50 and is not numeric schema validation.
   The report can still claim COMPLETE / analysisStatus OK.
4. **Sampling configuration bug.** `params.temperature || 0.7` in both Bedrock
   wrappers ignores an explicit zero. Sampling variability should be reduced
   for judging, but temperature zero alone is not a reproducibility guarantee.
5. **Unanchored dimensions and inconsistent narrative.** INTRO dimensions are
   Clarity, Structure and Confidence. There is no dimension-specific anchored
   rubric, evidence requirement or calibrated weighting. Confidence is inferred
   from text, not a validated acoustic measurement. A second independent model
   call writes the report, allowing its praise/criticism to contradict scores.

## Recommended changes, in order

- Persist authoritative ASR metadata through the worker and mark uncertain spans
  for evaluation. Keep the original transcript; do not blindly remove low-score
  words or replace them with model guesses. Unreliable input should produce an
  unavailable/uncertain assessment, not a fluency penalty or made-up grade.
- Supply structured question/accepted-answer pairs, module rubric and available
  role context. Assess only skills actually elicited. For INTRO, grade the final
  revised introduction and show baseline-to-revision improvement separately.
  For longer modules, grade accepted answers and aggregate by assessed criteria.
- Define human-reviewable 0–4 anchors for relevance, evidence/specificity,
  organization and clarity. As a starting proposal for INTRO, use relevance 30%,
  evidence 30%, structure 25% and clarity 15%, then calibrate the weights.
  Do not penalize an unspecified target role, short answers, accent, ordinary
  pauses or unsupported assumptions about the candidate's emotional state.
- Remove text-derived Confidence from the overall grade. Optional speech
  delivery measures such as pace, pause duration and filler rate can be shown
  separately when reliable audio/time alignment exists. These are not direct
  measurements of a person's internal confidence.
- Require validated structured output with per-criterion evidence, deductions,
  scores and matching feedback. Replace false 50-point defaults with explicit
  retry/unavailable status; honor temperature zero with nullish defaults.
  Compute the final weighted score in code. A single bounded judging/report
  call can reduce disagreement and model-call overhead, subject to quality tests.
- Build an initial 30–50-answer, human-rated benchmark covering short strong
  answers, weak long answers, Indian English, technical names and noisy endings.
  Check agreement with raters, repeatability, unchanged scores under ASR-only
  perturbations, and evidence-grounded feedback. Expand the benchmark before
  claiming reliable assessment across modules and populations.

Recognition confidence describes how likely a recognized item matches what was
spoken; it does not measure candidate speaking confidence. See the
[Amazon Transcribe item documentation](https://docs.aws.amazon.com/transcribe/latest/APIReference/API_streaming_Item.html).

These are recommendations, not deployed scoring improvements. Existing stored
reports and the backend remain unchanged in this step.
