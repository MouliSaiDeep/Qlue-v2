import http from 'node:http';
import { WebSocketServer } from 'ws';
import { attach } from './gateway.mjs';
import { secureIngress } from './ingress.mjs';

export function connectionLimit(raw = 8) {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > 64) throw Error('INVALID_MAX_CONNECTIONS');
  return value;
}

// Separate transport ownership from AWS construction so two real replicas can
// be exercised locally against the same transactional admission boundary.
export function createAudioServer({ store, transcribe, vocabularies, enabled = false,
  ingress, maxConnections = 8, hosting = 'ecs', onMetric = () => {} }) {
  const limit = connectionLimit(maxConnections);
  let draining = false, lastActivity = Date.now();
  const active = new Set();
  const server = http.createServer((req, res) => {
    const loopback = ['127.0.0.1', '::ffff:127.0.0.1', '::1'].includes(req.socket.remoteAddress);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    if (req.url === '/internal-idle' && loopback) {
      res.end(JSON.stringify({ active: [...active].filter(c => c.authenticated).length,
        idleSeconds: (Date.now() - lastActivity) / 1000 }));
      return;
    }
    res.statusCode = req.url === '/healthz' ? (draining ? 503 : 200) : 404;
    res.end(JSON.stringify({ ready: !draining, sttEnabled: enabled, hosting }));
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    // Never log ticket-bearing frames, headers or request URLs.
    if (draining || !enabled || req.url !== '/audio' || !secureIngress(req.headers, ingress) || active.size >= limit) {
      socket.end('HTTP/1.1 503 Service Unavailable\r\nRetry-After: 3\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, ws => {
      const connection = attach(ws, { store, transcribe, vocabularies, enabled,
        onAuthenticated: () => { lastActivity = Date.now(); }, onMetric });
      active.add(connection);
      ws.once('close', () => { void connection.done.finally(() => {
        active.delete(connection);
        if (connection.authenticated) lastActivity = Date.now();
      }); });
    });
  });
  return {
    server,
    async shutdown() {
      if (draining) return;
      draining = true;
      const closed = new Promise(resolve => server.close(resolve));
      server.closeIdleConnections();
      let timer;
      try {
        await Promise.race([Promise.allSettled([...active].map(c => c.stop())),
          new Promise(resolve => { timer = setTimeout(resolve, 10000); })]);
      } finally {
        clearTimeout(timer);
        wss.clients.forEach(ws => ws.terminate());
        await new Promise(resolve => wss.close(resolve));
        server.closeAllConnections();
        await closed;
      }
    },
  };
}
