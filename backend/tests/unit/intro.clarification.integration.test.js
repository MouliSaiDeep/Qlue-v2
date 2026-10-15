const {execFileSync} = require('node:child_process');
const path = require('node:path');
test('real input and stage logic retain clarification attempts, then complete two real introductions', () => {
  const output = execFileSync(process.execPath, [path.resolve(__dirname,
    '../../../audit/production-review-2026-10-07/task-intro-correct.cjs')], {encoding:'utf8'});
  expect(JSON.parse(output.slice(output.lastIndexOf('\n{') + 1)).confirmed).toBe(true);
});
