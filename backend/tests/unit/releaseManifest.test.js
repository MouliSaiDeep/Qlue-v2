const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { manifest, sourceDigest, sha256, releaseVersion } = require('../../../audit/release-manifest.cjs');
let root;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'qlue-manifest-'));
  fs.mkdirSync(path.join(root, 'frontend/lib'), { recursive: true });
  fs.writeFileSync(path.join(root, 'frontend/pubspec.yaml'), 'version: 1.0.9+10009\n');
  fs.writeFileSync(path.join(root, 'frontend/lib/main.dart'), 'source');
  execFileSync('git', ['init', '--quiet', root], { windowsHide: true });
  execFileSync('git', ['-C', root, 'add', 'frontend'], { windowsHide: true });
  execFileSync('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture'], { windowsHide: true });
});
afterEach(() => {
  const resolved = path.resolve(root), parent = path.resolve(os.tmpdir()) + path.sep;
  if (!resolved.startsWith(parent) || !path.basename(resolved).startsWith('qlue-manifest-')) throw Error('Unsafe fixture cleanup path');
  fs.rmSync(resolved, { recursive: true, force: true });
});

test('source fingerprint is stable across ordering and changes when build input bytes change', () => {
  const files = ['frontend/lib/main.dart', 'frontend/pubspec.yaml'];
  const first = sourceDigest(root, files);
  expect(sourceDigest(root, [...files].reverse())).toBe(first);
  fs.writeFileSync(path.join(root, files[0]), 'changed');
  expect(sourceDigest(root, files)).not.toBe(first);
  expect(() => manifest({ root, requireClean: true })).toThrow('uncommitted');
});

test('release manifest records exact artifact and config hashes without publishing config contents', () => {
  fs.writeFileSync(path.join(root, 'settings.json'), '{"PRIVATE_KEY":"fixture-secret"}');
  fs.writeFileSync(path.join(root, 'Qlue.apk'), Buffer.from([1, 2, 3]));
  const result = manifest({ root, config: 'settings.json', artifact: 'Qlue.apk', speechReview: false, requireClean: true });
  expect(result.cleanReleaseInputs).toBe(true);
  expect(result.compileOverrides).toEqual({SPEECH_REVIEW:false});
  expect(result.artifact.sha256).toBe(sha256(Buffer.from([1, 2, 3])));
  expect(result.artifact.bytes).toBe(3);
  expect(result.compileConfigurationSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(result)).not.toMatch(/PRIVATE_KEY|fixture-secret/);
  fs.writeFileSync(path.join(root, 'frontend/lib/new.dart'), 'new');
  expect(() => manifest({ root, requireClean: true })).toThrow('untracked');
});

test('release tags cannot collide through oversized components, leading zeroes or a mismatched source version', () => {
  expect(releaseVersion('v1.0.10')).toEqual({ version: '1.0.10', code: 10010 });
  for (const tag of ['v1.0.100', 'v1.100.0', 'v1.08.0', 'v1.0.9-rc1', 'v0.0.0']) expect(() => releaseVersion(tag)).toThrow();
  expect(() => manifest({ root, tag: 'v1.0.10' })).toThrow('Tag and pubspec');
  expect(manifest({ root, tag: 'v1.0.9' }).releaseVersionCode).toBe(10009);
});
