const { detectExitIntent } = require('../../src/handlers/interview/processUserInput');

// I-09: exit recognition must not end valid answers. The offline probe
// reproduced "Please don't end the interview." being treated as USER_EXIT.
describe('detectExitIntent (I-09)', () => {
  it('does NOT treat a negated exit request as exit', () => {
    expect(detectExitIntent("Please don't end the interview.")).toBe(false);
    expect(detectExitIntent('I do not want to end the interview')).toBe(false);
    expect(detectExitIntent("Let's not stop the interview yet")).toBe(false);
    expect(detectExitIntent('I never said end the interview')).toBe(false);
  });

  it('still recognises a genuine explicit exit request', () => {
    expect(detectExitIntent('End the interview')).toBe(true);
    expect(detectExitIntent('please stop the interview')).toBe(true);
    expect(detectExitIntent('finish the interview now')).toBe(true);
  });

  it('treats short answer endings as answer endings; explicit End remains available', () => {
    expect(detectExitIntent("I'm done")).toBe(false);
    expect(detectExitIntent("that's all")).toBe(false);
    expect(detectExitIntent('no more questions')).toBe(false);
  });

  it('does not infer exit from a long answer that merely mentions ending', () => {
    const answer = 'When we finish the interview process at my company we always send a follow up email to every single candidate within two days to keep them informed.';
    expect(detectExitIntent(answer)).toBe(false); // exceeds the deliberate-exit word budget
  });

  it('does not treat an answer clause like "that\'s all the traffic we handled" as exit', () => {
    expect(detectExitIntent("that's all the traffic we handled that quarter")).toBe(false);
  });
});
