// Local transport/admission test. Real WebSockets, two server instances,
// synthetic silence, in-memory atomic transactions, and NO AWS/provider calls.
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { WebSocket } from 'ws';
import boundary from '../../tests/helpers/documentBoundary.js';
import { Store } from '../src/store.mjs';
import { createAudioServer } from '../src/http-server.mjs';

class DB extends boundary.DocumentBoundary {
  key(table, item) { return table === 'asr' ? JSON.stringify([table, item.pk]) : super.key(table, item); }
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function runLoadSmoke({ clients = 12, slots = 8, durationMs = 800, interruptReplica } = {}) {
  assert(Number.isSafeInteger(clients) && clients >= 2 && clients <= 80);
  assert(Number.isSafeInteger(slots) && slots >= 1 && slots <= 20 && slots < clients);
  assert(Number.isSafeInteger(durationMs) && durationMs >= 80 && durationMs <= 10000);
  assert(interruptReplica === undefined || interruptReplica === 0 || interruptReplica === 1);
  const db = new DB(), apps = [], sockets = [], records = [];
  const latencies = [], measurements = [];
  const started = performance.now();
  db.seed('asr', { pk: 'CONTROL', rolloutEnabled: true, globalStreamSlots: slots, dailyStreamLimit: 160 });
  const transcribe = { send: async command => ({ TranscriptResultStream: (async function* () {
    let frames = 0;
    for await (const _ of command.input.AudioStream) frames++;
    assert(frames > 0);
    yield { TranscriptEvent: { Transcript: { Results: [{ ResultId: 'synthetic', IsPartial: false,
      StartTime: 0, EndTime: frames * .08, Alternatives: [{ Transcript: 'Synthetic local answer.', Items: [] }] }] } } };
  })() }) };
  try {
    for (let i = 0; i < 2; i++) {
      const app = createAudioServer({ enabled: true, ingress: 'alb-tls',
        store: new Store(db, { table: 'asr', sessions: 'sessions', deletions: 'deletions', slots }),
        transcribe, vocabularies: { choose: async () => ({ applied: false }) },
        maxConnections: Math.ceil(clients / 2), onMetric: value => measurements.push(value) });
      app.server.listen(0, '127.0.0.1');
      await once(app.server, 'listening');
      apps.push(app);
    }
    await Promise.all(Array.from({ length: clients }, async (_, i) => {
      const uid = 'synthetic-' + i, ticket = randomBytes(32).toString('base64url');
      const streamId = randomBytes(16).toString('hex'), now = Math.floor(Date.now() / 1000);
      db.seed('sessions', { sessionId: uid, userId: uid, currentState: 'USER_RESPONDING', lastTurnPayload: { turnId: 'q' } });
      db.seed('asr', { pk: 'TICKET#' + createHash('sha256').update(ticket).digest('hex'), userId: uid,
        sessionId: uid, turnId: 'q', captureId: 'capture', epoch: 1, streamId,
        language: 'en-IN', stability: 'off', sampleRate: 16000, offsetSamples: 0,
        expiresAt: now + 30, streamExpiresAt: now + 180 });
      const ws = new WebSocket(`ws://127.0.0.1:${apps[i % 2].server.address().port}/audio`,
        { headers: { 'X-Forwarded-Proto': 'https' }, handshakeTimeout: 5000 });
      sockets.push(ws);
      const record = { ws, replica: i % 2, events: [], admitted: false, failed: false };
      records.push(record);
      ws.on('message', data => record.events.push(JSON.parse(data)));
      await once(ws, 'open');
      const began = performance.now();
      ws.send(JSON.stringify({ type: 'start', protocol: 1, ticket }));
      const until = Date.now() + 5000;
      while (!record.events.some(e => ['ready', 'error'].includes(e.type)) && Date.now() < until) await pause(5);
      record.admitted = record.events.some(e => e.type === 'ready');
      record.failed = record.events.some(e => e.type === 'error');
      assert(record.admitted || record.failed, 'Admission never resolved');
      if (record.admitted) latencies.push(performance.now() - began);
    }));
    const admitted = records.filter(r => r.admitted);
    assert.equal(admitted.length, slots, 'Shared admission must equal the configured global cap');
    assert.equal(records.filter(r => r.failed).length, clients - slots);
    const frames = Math.ceil(durationMs / 80);
    for (let sequence = 0; sequence < frames; sequence++) {
      for (const record of admitted) {
        const frame = Buffer.alloc(2572);
        frame.writeUInt32LE(sequence, 0);
        frame.writeBigUInt64LE(BigInt(sequence * 1280), 4);
        record.ws.send(frame);
      }
      await pause(80);
    }
    if (interruptReplica !== undefined) await apps[interruptReplica].shutdown();
    const completing = admitted.filter(r => r.replica !== interruptReplica);
    const interrupted = admitted.filter(r => r.replica === interruptReplica);
    for (const record of completing) record.ws.send(JSON.stringify({ type: 'end', frames, nextOffsetSamples: frames * 1280 }));
    const until = Date.now() + 5000;
    while (completing.some(r => !r.events.some(e => e.type === 'complete')) && Date.now() < until) await pause(5);
    assert(completing.every(r => r.events.some(e => e.type === 'complete')), 'Every surviving stream must finish');
    assert(interrupted.every(r => r.events.some(e => e.type === 'interrupted') && !r.events.some(e => e.type === 'complete')),
      'Drained streams must be reported interrupted rather than completed');
    // Completion is delivered before lease release; allow the release microtasks to finish.
    await pause(30);
    const leases = [...db.rows.values()].filter(r => r.pk?.startsWith('SLOT#') || r.pk?.startsWith('LEASE#'));
    assert.equal(leases.length, 0, 'Finished streams leaked capacity');
    latencies.sort((a, b) => a - b);
    return { passed: true, syntheticOnly: true, providerCalls: 0, replicas: 2, clients, globalSlots: slots,
      admitted: admitted.length, rejected: clients - admitted.length, completed: completing.length, interrupted: interrupted.length,
      framesPerStream: frames, admissionP50Ms: latencies[Math.ceil(latencies.length * .5) - 1],
      admissionP95Ms: latencies[Math.ceil(latencies.length * .95) - 1],
      elapsedMs: performance.now() - started, leakedLeases: leases.length };
  } finally {
    sockets.forEach(ws => ws.terminate());
    await Promise.all(apps.map(app => app.shutdown()));
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = {};
  for (const arg of process.argv.slice(2)) {
    const match = /^--(clients|slots|duration-ms)=(\d+)$/.exec(arg);
    if (!match) throw Error('Use --clients=N --slots=N --duration-ms=N');
    options[match[1] === 'duration-ms' ? 'durationMs' : match[1]] = Number(match[2]);
  }
  console.log(JSON.stringify(await runLoadSmoke(options), null, 2));
}
