import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createAudioServer } from '../src/http-server.mjs';
import { runLoadSmoke } from '../scripts/load-smoke.mjs';

test('two gateway replicas enforce shared capacity and finish accepted streams without leaking leases',
  { timeout: 15000 }, async () => {
    const result = await runLoadSmoke({ clients: 12, slots: 8, durationMs: 160 });
    assert.equal(result.admitted, 8);
    assert.equal(result.rejected, 4);
    assert.equal(result.leakedLeases, 0);
  });

test('health is available while disabled; unknown paths are not healthy endpoints', async () => {
  const app = createAudioServer({ enabled: false });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  try {
    const base = `http://127.0.0.1:${app.server.address().port}`;
    assert.equal((await fetch(base + '/healthz')).status, 200);
    assert.equal((await fetch(base + '/unknown')).status, 404);
    const response = await fetch(base + '/internal-idle');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).active, 0);
  } finally { await app.shutdown(); }
});

test('draining one replica interrupts its answers honestly while the other replica completes',
  { timeout: 15000 }, async () => {
    // Eight streams are admitted across the two replicas;
    // extra clients exercise admission rejection before the drain.
    const result = await runLoadSmoke({ clients: 12, slots: 8, durationMs: 160, interruptReplica: 0 });
    assert(result.completed > 0);
    assert(result.interrupted > 0);
    assert.equal(result.completed + result.interrupted, 8);
    assert.equal(result.leakedLeases, 0);
  });
