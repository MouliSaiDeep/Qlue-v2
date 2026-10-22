// Trace release artifacts to source and compile configuration without copying
// credentials, environment values or signing material into public artifacts.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const INPUTS = ['.github/workflows', 'frontend/lib', 'frontend/test', 'frontend/assets', 'frontend/android',
  'frontend/ios', 'frontend/packages', 'frontend/pubspec.yaml', 'frontend/pubspec.lock',
  'backend/src', 'backend/tests', 'backend/evaluation', 'backend/audio-gateway', 'backend/layers',
  'backend/package.json', 'backend/package-lock.json', 'backend/template.yaml', 'backend/jest.config.js',
  'audit/release-manifest.cjs', 'audit/verify-release-reachability.cjs', 'audit/verify-release-apk.py'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function releaseVersion(tag) {
  const match = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(tag || '');
  if (!match) throw Error('Release tag must be vMAJOR.MINOR.PATCH without leading zeroes or suffixes');
  const [major, minor, patch] = match.slice(1).map(Number), code = major * 10000 + minor * 100 + patch;
  if (minor > 99 || patch > 99 || !Number.isSafeInteger(code) || code < 1 || code > 2100000000) throw Error('Release version exceeds the Android version-code encoding');
  return { version: `${major}.${minor}.${patch}`, code };
}
function sourceDigest(root, files) {
  const hash = createHash('sha256');
  for (const file of [...new Set(files)].sort()) {
    // Hash the actual bytes, not normalized text; the fingerprint identifies
    // precisely the checkout used to build this artifact.
    hash.update(file.replaceAll('\\', '/') + '\0');
    hash.update(sha256(fs.readFileSync(path.join(root, file))) + '\n');
  }
  return hash.digest('hex');
}
function manifest({ root = ROOT, artifact, config, tag, speechReview, requireClean = false } = {}) {
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  const files = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...INPUTS])
    .split('\0').filter(Boolean).filter(file => fs.existsSync(path.join(root, file)) && fs.statSync(path.join(root, file)).isFile());
  const status = git(['status', '--porcelain', '--untracked-files=all', '--', ...INPUTS]);
  if (requireClean && status.trim()) throw Error('Release inputs contain uncommitted or untracked changes. Commit and review them before publishing.');
  const pubspec = fs.readFileSync(path.join(root, 'frontend/pubspec.yaml'), 'utf8');
  const result = { schemaVersion: 1, generatedAt: new Date().toISOString(), commit: git(['rev-parse', 'HEAD']).trim(),
    tag: tag || null, cleanReleaseInputs: !status.trim(), sourceFiles: files.length,
    sourceSha256: sourceDigest(root, files), declaredAppVersion: /^version:\s*(\S+)/m.exec(pubspec)?.[1] || null,
    nodeVersion: process.version };
  if (tag) {
    const release = releaseVersion(tag);
    if (result.declaredAppVersion !== `${release.version}+${release.code}`) throw Error('Tag and pubspec version/build number must match before release');
    result.releaseVersion = release.version;
    result.releaseVersionCode = release.code;
  }
  if (speechReview !== undefined) {
    if (typeof speechReview !== 'boolean') throw Error('Invalid speech-review override');
    result.compileOverrides = { SPEECH_REVIEW: speechReview };
  }
  if (config) {
    const bytes = fs.readFileSync(path.resolve(root, config));
    // Validate the file before hashing. Never serialize its values.
    JSON.parse(bytes.toString('utf8'));
    result.compileConfigurationSha256 = sha256(bytes);
  }
  if (artifact) {
    const file = path.resolve(root, artifact), bytes = fs.readFileSync(file);
    result.artifact = { fileName: path.basename(file), bytes: bytes.length, sha256: sha256(bytes) };
  }
  return result;
}
if (require.main === module) {
  const args = process.argv.slice(2), options = {};
  let output;
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === '--require-clean') { options.requireClean = true; continue; }
    if (!['--artifact', '--config', '--tag', '--speech-review', '--output'].includes(key) || !args[i + 1] || args[i + 1].startsWith('--')) throw Error('Invalid manifest arguments');
    const value = args[++i];
    if (key === '--output') output = value;
    else if (key === '--speech-review') {
      if (!['true', 'false'].includes(value)) throw Error('Invalid speech-review override');
      options.speechReview = value === 'true';
    } else options[key.slice(2)] = value;
  }
  const text = JSON.stringify(manifest(options), null, 2) + '\n';
  if (output) { const file = path.resolve(ROOT, output); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
  else process.stdout.write(text);
}
module.exports = { manifest, sourceDigest, sha256, releaseVersion };
