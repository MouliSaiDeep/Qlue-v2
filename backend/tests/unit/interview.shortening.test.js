const { shortenPreservingQuestion, truncateAtSentenceBoundary } = require('../../src/handlers/interview/asyncWorker');

// I-05: shortening AI speech must never drop the question. The offline probe
// reproduced a 300-char truncation returning only the acknowledgment.
describe('shortenPreservingQuestion (I-05)', () => {
  const ack = 'Your introduction clearly explains your background and connects your experience with the role, including a useful example of teamwork and a concrete result.';
  const question = 'Please describe the specific steps you took when working with colleagues to resolve a difficult technical disagreement and explain which outcome you measured?';

  it('keeps the question when the combined text exceeds the budget', () => {
    const text = `${ack} ${question}`;
    expect(text.length).toBeGreaterThan(300);
    const out = shortenPreservingQuestion(text, 300);
    // The question (or its answerable remainder) must survive; the old code
    // returned exactly the acknowledgment.
    expect(out).not.toBe(ack);
    expect(out).toContain('specific steps you took');
    expect(out.endsWith('?')).toBe(true);
  });

  it('returns short text unchanged', () => {
    expect(shortenPreservingQuestion('Tell me about yourself?', 300)).toBe('Tell me about yourself?');
  });

  it('preserves the complete question even when it exceeds the preferred speech budget', () => {
    const longQ = 'Can you walk me through '.repeat(20) + 'the architecture?';
    const out = shortenPreservingQuestion(`Nice. ${longQ}`, 120);
    expect(out).toBe(longQ);
    expect(out.endsWith('the architecture?')).toBe(true);
  });

  it('prefers the last question sentence even when a statement follows commas', () => {
    const text = 'Great context on your metrics work over the last several years across many teams and projects. What was the single hardest trade-off you had to defend to a skeptical stakeholder, and why?';
    const out = shortenPreservingQuestion(text, 120);
    expect(out).toContain('hardest trade-off');
    expect(out.endsWith('?')).toBe(true);
  });

  it('truncateAtSentenceBoundary still returns short text unchanged (unchanged contract)', () => {
    expect(truncateAtSentenceBoundary('Short.', 300)).toBe('Short.');
  });
});
