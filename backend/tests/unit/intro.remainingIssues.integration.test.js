const {execFileSync} = require('node:child_process');
const path = require('node:path');
test.each(['task-variant-correct.cjs', 'task-fragment-correct.cjs'])(
  'actual input/stage regression: %s', fixture => {
    expect(() => execFileSync(process.execPath, [path.resolve(__dirname,
      '../../../audit/review-2026-10-08', fixture)], {encoding:'utf8'})).not.toThrow();
  }
);
const {isClarification} = require('../../src/handlers/interview/processUserInput');
test.each([' Can you say that again?! ', 'I did not hear the question.',
  "Sorry, I didn’t catch your question!", 'Could you please repeat that?',
  'Please say that again, please.', 'I   could not hear the question'])('whole replay request: %s', text => {
  expect(isClarification(text)).toBe(true);
});
test.each(['I repeated experiments to validate the results',
  'I built a microphone project in college', 'I asked questions at work to understand requirements',
  'Can you say that again is the phrase I taught students', 'I did not hear the question during our experiment so I revised the protocol'])('genuine answer: %s', text => {
  expect(isClarification(text)).toBe(false);
});
