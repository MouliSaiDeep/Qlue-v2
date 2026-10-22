import test from 'node:test';
import assert from 'node:assert/strict';
import { streamMetric } from '../src/telemetry.mjs';
import { connectionLimit } from '../src/http-server.mjs';

test('metrics distinguish completion, rejection and persistence failure without identity or text', () => {
  const completed = streamMetric({ status: 'FINISHED', authenticated: true, receivedBytes: 32000,
    totalMs: 1200, firstPartialMs: 300, userId: 'private', transcript: 'private', ticket: 'private' }, 123);
  assert.equal(completed.StreamCompleted, 1);
  assert.equal(completed.AudioSeconds, 1);
  assert.equal(completed._aws.Timestamp, 123);
  assert.equal(JSON.stringify(completed).includes('private'), false);
  const failed = streamMetric({ status: 'PERSISTENCE_FAILED', authenticated: true, firstPartialMs: null });
  assert.equal(failed.EvidencePersistenceFailed, 1);
  assert.equal(failed.StreamInterrupted, 1);
  assert.equal('FirstPartialMs' in failed, false);
  assert.equal('AudioSeconds' in failed, false);
  assert.equal(streamMetric({ status: 'INTERRUPTED', authenticated: false }).StreamRejected, 1);
});

test('per-task connection limits reject invalid configuration before accepting traffic', () => {
  for (const value of [0, -1, 65, 'NaN', 1.5, '']) assert.throws(() => connectionLimit(value));
  assert.equal(connectionLimit(), 8);
  assert.equal(connectionLimit('16'), 16);
});
