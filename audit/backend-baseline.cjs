// Freeze existing client inputs without copying private configuration values.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { sha256 } = require('./release-manifest.cjs');
const ROOT = path.resolve(__dirname, '..');
const PRIVATE_INPUTS = ['frontend/env.json', 'frontend/android/key.properties',
  'frontend/android/app/google-services.json'];
function snapshot({ root = ROOT, artifact } = {}) {
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  const files = new Set(git(['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'frontend/'])
    .split('\0').filter(Boolean));
  PRIVATE_INPUTS.forEach(file => files.add(file));
  if (artifact) {
    const relative = path.relative(root, path.resolve(root, artifact)).replaceAll('\\', '/');
    if (relative.startsWith('../') || path.isAbsolute(relative)) throw Error('Artifact must be inside the repository');
    files.add(relative);
  }
  const hashes = Object.fromEntries([...files].sort().map(file => [file,
    fs.existsSync(path.join(root, file)) ? sha256(fs.readFileSync(path.join(root, file))) : null]));
  return { schemaVersion: 1, commit: git(['rev-parse', 'HEAD']).trim(),
    generatedAt: new Date().toISOString(), artifact: artifact || null, hashes };
}
function verify(baseline, options = {}) {
  if (baseline.schemaVersion !== 1 || !baseline.hashes || !Object.keys(baseline.hashes).length) throw Error('Invalid baseline');
  const current = snapshot({ ...options, artifact: baseline.artifact });
  const files = new Set([...Object.keys(baseline.hashes), ...Object.keys(current.hashes)]);
  const changed = [...files].filter(file => baseline.hashes[file] !== current.hashes[file]);
  return { unchanged: changed.length === 0, files: files.size, changed };
}
if (require.main === module) {
  const [mode, file, artifact, ...extra] = process.argv.slice(2);
  if (!['snapshot', 'verify'].includes(mode) || !file || extra.length || (mode === 'verify' && artifact)) {
    throw Error('Use: backend-baseline.cjs snapshot FILE [APK] | verify FILE');
  }
  if (mode === 'snapshot') {
    if (fs.existsSync(file)) throw Error('Baseline already exists; preserve it for comparison');
    const value = snapshot({ artifact });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
    console.log(JSON.stringify({ baseline: file, files: Object.keys(value.hashes).length, commit: value.commit }));
  } else {
    const result = verify(JSON.parse(fs.readFileSync(file, 'utf8')));
    console.log(JSON.stringify(result));
    if (!result.unchanged) process.exitCode = 1;
  }
}
module.exports = { snapshot, verify };
