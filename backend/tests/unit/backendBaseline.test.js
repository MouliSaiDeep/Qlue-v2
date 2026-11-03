const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { snapshot, verify } = require('../../../audit/backend-baseline.cjs');
let root;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'qlue-client-freeze-'));
  fs.mkdirSync(path.join(root, 'frontend'), { recursive: true });
  fs.writeFileSync(path.join(root, 'frontend/main.dart'), 'original');
  fs.writeFileSync(path.join(root, '.gitignore'), 'frontend/env.json\n');
  fs.writeFileSync(path.join(root, 'frontend/env.json'), '{"key":"private"}');
  execFileSync('git', ['init', '--quiet', root], { windowsHide: true });
  execFileSync('git', ['-C', root, 'add', '.'], { windowsHide: true });
  execFileSync('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    'commit', '--quiet', '-m', 'fixture'], { windowsHide: true });
});
afterEach(() => {
  const resolved = path.resolve(root);
  if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('qlue-client-freeze-')) throw Error('Unsafe fixture cleanup');
  fs.rmSync(resolved, { recursive: true, force: true });
});
test('backend edits preserve the freeze; a new or changed frontend file breaks it', () => {
  const baseline = snapshot({ root });
  fs.mkdirSync(path.join(root, 'backend')); fs.writeFileSync(path.join(root, 'backend/handler.js'), 'improvement');
  expect(verify(baseline, { root }).unchanged).toBe(true);
  fs.writeFileSync(path.join(root, 'frontend/new.dart'), 'new');
  expect(verify(baseline, { root }).changed).toContain('frontend/new.dart');
  fs.writeFileSync(path.join(root, 'frontend/main.dart'), 'changed');
  expect(verify(baseline, { root }).changed).toContain('frontend/main.dart');
});
test('deleted frontend files and private config changes are detected without exposing values', () => {
  const baseline = snapshot({ root });
  expect(JSON.stringify(baseline)).not.toContain('private');
  fs.unlinkSync(path.join(root, 'frontend/main.dart'));
  fs.writeFileSync(path.join(root, 'frontend/env.json'), '{"key":"changed-private"}');
  expect(verify(baseline, { root }).changed).toEqual(expect.arrayContaining(['frontend/main.dart', 'frontend/env.json']));
});
test('the frozen APK is also verified and cannot reference outside the repository', () => {
  fs.writeFileSync(path.join(root, 'review.apk'), 'signed-apk-bytes');
  const baseline = snapshot({ root, artifact: 'review.apk' });
  fs.writeFileSync(path.join(root, 'review.apk'), 'different');
  expect(verify(baseline, { root }).changed).toContain('review.apk');
  expect(() => snapshot({ root, artifact: '../other.apk' })).toThrow('inside the repository');
});
