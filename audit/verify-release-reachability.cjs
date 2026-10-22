// Fail closed if experimental offline recognition becomes reachable from the app.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../frontend/lib');
const seen = new Set();
function visit(file) {
  if (seen.has(file)) return;
  seen.add(file);
  const source = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert(!/package:sherpa_onnx\//.test(source), `Offline native dependency reachable: ${file}`);
  assert(!/assets\/speech\//.test(source), `Offline model reachable: ${file}`);
  // Follow both branches of conditional imports, as well as exports and parts.
  for (const directive of source.matchAll(/^\s*(?:import|export|part)\s+([^;]+);/gm)) {
    for (const quoted of directive[1].matchAll(/['"]([^'"]+\.dart)['"]/g)) {
      const uri = quoted[1];
      if (uri.startsWith('dart:') || (uri.startsWith('package:') && !uri.startsWith('package:frontend/'))) continue;
      // Package-relative Dart resolution stays inside the package's lib root.
      // Conservatively follow the root-level target for above-root relatives;
      // Flutter analysis and compilation separately validate URI resolution.
      let target = uri.startsWith('package:frontend/') ? path.join(root, uri.slice(17)) : path.resolve(path.dirname(file), uri);
      if (!target.startsWith(root + path.sep)) target = path.join(root, uri.replace(/^(?:\.\.\/)+/, ''));
      visit(target);
    }
  }
}
visit(path.join(root, 'main.dart'));
for (const file of ['vad_stt_service.dart', 'speech_engine.dart', 'speech_worker.dart']) {
  assert(![...seen].some(p => path.basename(p) === file), `Offline engine reachable: ${file}`);
}
const provider = fs.readFileSync(path.join(root, 'features/interview/providers/interview_provider.dart'), 'utf8');
assert(/sttService\s*\?\?\s*defaultSttService\(\)/.test(provider));
assert(/Env\.awsSttEnabled[\s\S]+:\s*SystemSpeechSttService\(\)/.test(provider));
assert(/bool\.fromEnvironment\(\s*'AWS_STT_ENABLED',\s*defaultValue:\s*false/.test(fs.readFileSync(path.join(root,'core/env.dart'),'utf8')));
console.log(JSON.stringify({reachableFiles:seen.size, systemRecognizerDefault:true, offlineEngineReachable:false}));
