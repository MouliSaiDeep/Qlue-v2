// Synthetic cases only. Labels describe test construction, not human grades.
const existing = require('../tests/fixtures/release-quality-cases.json').cases;
const topics = {
  INTRO: [
    ['Introduce yourself and describe relevant work.', 'I study information systems. I built a library reservation app, interviewed two librarians and changed the booking flow after their feedback. I want to work on practical software for public services.', 'I am a student and I like technology.'],
    ['Introduce yourself and describe relevant work.', 'I am changing careers from retail to software testing. I wrote boundary and cancellation tests for a checkout demo and found a duplicate-payment bug. My customer support experience helps me describe failures clearly.', 'I am the best tester and never make mistakes.'],
    ['Introduce yourself and describe relevant work.', 'I am a design graduate. I conducted accessibility interviews, redesigned a registration form and tested keyboard navigation with participants. The work taught me to verify assumptions before adding visual detail.', 'I enjoy design. I am creative and hardworking.'],
    ['Introduce yourself and describe relevant work.', 'I recently completed a data analysis course. In a transport project I checked missing timestamps before comparing routes and documented that the sample could not establish causation. I am looking for a junior analyst role.', 'I analyzed some data and proved everything was caused by traffic.'],
    ['Introduce yourself and describe relevant work.', 'I am an electrical engineering student. Our team built a soil sensor prototype. I handled calibration against reference readings and learned that our outdoor enclosure needed better moisture protection.', 'I study engineering and our team won a competition.'],
  ],
  RESUME: [
    ['What does an idempotency key do when a payment request is retried?', 'The server associates a unique key with the operation and saves its result atomically. A retry with that key returns the saved result rather than charging again. Concurrent requests must not both create the payment.', 'It makes every repeated HTTP request create a new payment so nothing is lost.'],
    ['Explain a database transaction.', 'A transaction groups changes so they commit together or roll back together. Isolation controls how concurrent transactions interact; a transaction alone does not make an external email atomic with a database write.', 'It is a backup file that makes all external services exactly once automatically.'],
    ['What problem does exponential backoff address?', 'After transient failures, progressively longer waits reduce repeated pressure on a struggling service. Jitter spreads clients out, and retries need a limit and idempotent operations.', 'Retrying instantly forever always fixes permanent authentication failures.'],
    ['What is a cache invalidation tradeoff?', 'A cache can reduce repeated reads, but stale data remains until expiry or invalidation. The right policy depends on how much staleness the operation can tolerate.', 'Cached data is always current because memory is faster than a database.'],
    ['How does WebSocket communication differ from a typical HTTP request and response?', 'After an HTTP upgrade, a WebSocket connection lets either side send messages without a new request for each one. The application still needs authentication, reconnect handling and message ownership.', 'A WebSocket is bidirectional communication.'],
  ],
  HR: [
    ['Describe how you handled a disagreement with a teammate.', 'We disagreed about adding a feature before the deadline. I asked each person to describe the user problem, compared the remaining work and proposed testing the smaller version first. We agreed on that scope and documented the deferred feature.', 'I ignored the teammate because I knew my idea was right.'],
    ['Tell me about a mistake and what you learned.', 'I shipped a form without testing empty fields. When a user reported a crash I reproduced it, added validation and explained the fix. I now include boundary cases in my review checklist.', 'I have never made a mistake.'],
    ['How did you respond when a deadline became unrealistic?', 'I listed the remaining tasks, explained the risk early and asked the stakeholder which outcome mattered most. We reduced scope and kept the essential workflow. I learned to revisit estimates as evidence changes.', 'I said everything was fine and hoped someone else would finish it.'],
    ['Describe helping someone learn a task.', 'A colleague was new to our reporting process. I walked through an example, asked them to run the next report and updated the instructions around the step they found confusing. They completed the next report independently.', 'I told them to read the instructions.'],
    ['What would you do if asked to hide a known product defect?', 'I would clarify the impact, document the defect and raise it through the appropriate owner. I would explain the user risk and propose a mitigation rather than claim the feature worked.', 'I would hide it if doing so made our numbers look better.'],
  ],
  JD: [
    ['The role requires API reliability. How does your experience relate?', 'I added request validation and idempotency keys to a booking API, then tested concurrent retries. That work relates directly to the reliability requirement.', 'I like APIs and am reliable.'],
    ['The role requires accessible frontend development. What relevant work have you done?', 'I improved keyboard focus order and form labels in a registration screen, then checked it with a screen reader. That is relevant to the accessibility requirement.', 'I used bright colors, so the interface must be accessible to everyone.'],
    ['The role requires data quality checks. Describe relevant experience.', 'I checked duplicate IDs, missing dates and inconsistent units before producing a dashboard. I documented excluded records so the team could assess the resulting sample.', 'I made a beautiful chart and assumed the input was correct.'],
    ['The role requires testing asynchronous systems. Describe relevant experience.', 'I tested duplicate queue delivery, delayed responses and worker failures. I checked that a retry reused the operation identifier and did not create a second result.', 'Asynchronous means all operations always happen in order, so testing is unnecessary.'],
    ['The role requires technical support. Describe how you would troubleshoot a failed upload.', 'I would ask about the file type and error, reproduce the upload and check permission, size and connection failures. I would give the user a clear next step and avoid requesting sensitive contents unnecessarily.', 'I would ask the user to send me every password so I could investigate.'],
  ],
  WEBSITE: [
    ['Explain why retransmission can increase delay.', 'Lost data must be sent again and received before ordered delivery can continue, so loss recovery can increase delay.', 'Retransmission guarantees that there is no delay.'],
    ['Explain how a TTL affects cached results.', 'A time to live limits how long a cached entry remains usable. A longer TTL can reduce reads but may expose older data.', 'A longer TTL guarantees that the cache is fresher.'],
    ['Explain the purpose of a database unique constraint.', 'The database rejects duplicate values in the constrained key, including competing inserts. This helps enforce uniqueness at the storage boundary.', 'A unique constraint only changes how a field is displayed.'],
    ['Explain why HTTPS does not establish that a claim on a page is true.', 'HTTPS protects the connection and authenticates the server according to its certificate. The page author can still publish an incorrect claim.', 'If a page has HTTPS, every statement on it has been fact checked.'],
    ['Explain how a controlled experiment differs from an observational comparison.', 'A controlled experiment assigns a change under defined conditions. An observational comparison can reveal associations but may be affected by confounding factors.', 'Any correlation from observations proves causation.'],
  ],
};
const sourceTexts = [
  'TCP provides reliable ordered delivery using acknowledgments and retransmission. Recovery from loss can increase delay.',
  'A cached entry expires after its TTL. Longer TTLs reduce refresh frequency but may increase staleness.',
  'A database unique constraint rejects duplicate keys, including concurrent conflicting inserts.',
  'HTTPS protects transport and authenticates the server certificate. It does not verify the truth of page contents.',
  'Randomized controlled experiments help estimate causal effects. Observational associations may have confounders.',
];
const added = Object.entries(topics).flatMap(([module, rows]) => rows.flatMap(([question, ...answers], index) =>
  answers.map((answer, variant) => ({
    id: `${module.toLowerCase()}-launch-${index + 1}-${variant + 1}`, module,
    caseType: variant ? 'contrast-response' : 'supported-response', question, answers: [answer],
    assessmentContext: module === 'JD' ? { kind: 'JOB', text: question.replace(/\. .*/, '.') }
      : module === 'WEBSITE' ? { kind: 'SOURCE', text: sourceTexts[index] } : null,
    expected: { inventedFactsForbidden: true, acousticJudgmentsForbidden: true, humanScoreBand: null },
    humanReview: 'PENDING',
  }))));
module.exports = { syntheticOnly: true, version: 'public-launch-v1', cases: [...existing, ...added] };
