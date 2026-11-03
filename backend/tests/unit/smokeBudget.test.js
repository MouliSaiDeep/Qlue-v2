const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { SmokeBudget, acquireBudgetLock } = require('../../../audit/smoke-budget.cjs');
let directory, file;
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qlue-budget-')); file = path.join(directory, 'budget.json'); });
afterEach(() => {
  const resolved = path.resolve(directory);
  if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('qlue-budget-')) throw Error('Unsafe fixture cleanup');
  fs.rmSync(resolved, { recursive: true, force: true });
});
test('unknown usage remains reserved across restarts and rejects duplicate paid work', () => {
  const b = new SmokeBudget(file); b.reserve('model', 'attempt', 0.4);
  const resumed = new SmokeBudget(file);
  expect(resumed.summary().accountedUsd).toBe(0.4);
  expect(() => resumed.reserve('model', 'attempt', 0.4)).toThrow('REQUEST_ALREADY_JOURNALED');
  expect(() => resumed.reserve('audio', 'another', 0.61)).toThrow('BUDGET_LIMIT');
});
test('verified usage releases only the unused reservation and keeps a component ceiling', () => {
  const b = new SmokeBudget(file); b.reserve('model', 'one', 0.4, 0.45); b.settle('one', 0.01);
  b.reserve('model', 'two', 0.4, 0.45);
  expect(() => b.reserve('model', 'three', 0.05, 0.45)).toThrow('BUDGET_LIMIT');
  expect(() => b.settle('two', 0.5)).toThrow('PROVIDER_USAGE_EXCEEDED_ALLOWANCE');
});
test('invalid and above-authorized budgets cannot start paid work', () => {
  expect(() => new SmokeBudget(file, 2)).toThrow();
  const b = new SmokeBudget(file); expect(() => b.reserve('model', 'bad', NaN)).toThrow();
});

test('model and cloud runs cannot simultaneously own the same budget journal', () => {
  const release = acquireBudgetLock(directory);
  expect(() => acquireBudgetLock(directory)).toThrow();
  release();
  const next = acquireBudgetLock(directory); next();
});

test('known text-only model requests keep a conservative bound without spending the remaining budget on an unused context',()=>{
 const {reserveRequest}=require('../../../audit/bounded-model-reservation.cjs'),b=new SmokeBudget(file);
 b.reserve('previous','already-accounted',.86);
 const params={system:'Check source facts.',messages:[{role:'user',content:[{text:'Synthetic answer.'}]}],max_tokens:1700};
 const bound=reserveRequest(b,'small-request',params);
 expect(bound.inputTokenUpperBound).toBeGreaterThan(32768);
 expect(b.summary().accountedUsd).toBeLessThan(.88);
 const resumed=new SmokeBudget(file);expect(resumed.state.entries.at(-1).bound.requestSha256).toMatch(/^[a-f0-9]{64}$/);
 expect(()=>reserveRequest(resumed,'hidden-image',{...params,messages:[{role:'user',content:[{image:{}}]}]})).toThrow('UNBOUNDED_MODEL_REQUEST');
});
