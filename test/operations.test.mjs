import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { AppConfig } from '../src/config/config.mjs';
import { createApp, shutdown } from '../src/server.mjs';
import { DeskService } from '../src/service.mjs';
import { ALPHA, ALPHA_TICKET, BETA, approvedReply, fakeProvider, settle } from './helpers.mjs';

const silentLogger = { info() {}, warn() {}, error() {} };
const configWith = env => AppConfig.from({ DESK_RECONCILE_INTERVAL_MS: '1000', DESK_RECONCILE_MAX_BACKOFF_MS: '8000', DESK_RECONCILE_JITTER_RATIO: '0', ...env });

function harness(env = {}) {
  const clock = { now: 1_000_000 };
  const provider = fakeProvider();
  const service = new DeskService({ provider, config: configWith(env), logger: silentLogger, clock: () => clock.now, random: () => 0 });
  return { clock, provider, service };
}

async function unknownDelivery(service, provider) {
  approvedReply(service);
  provider.setMode('timeout');
  await service.sendReply(ALPHA, ALPHA_TICKET);
  provider.setMode('normal');
}

describe('background reconciliation sweeper', () => {
  test('resolves an UNKNOWN delivery from provider evidence without resending', async () => {
    const { service, provider } = harness();
    try {
      await unknownDelivery(service, provider);
      const run = await service.sweeper.runOnce();
      assert.deepEqual({ checked: run.checked, resolved: run.resolved }, { checked: 1, resolved: 1 });
      const ticket = service.getTicket(ALPHA, ALPHA_TICKET);
      assert.equal(ticket.send_state, 'SENT');
      assert.equal(provider.ledger.length, 1);
      assert.ok(ticket.audit.some(a => a.action === 'delivery_confirmed' && a.actor === 'background-reconciler'));
    } finally {
      service.close();
    }
  });

  test('backs off on inconclusive lookups and does not flood the audit trail', async () => {
    const { service, provider, clock } = harness();
    try {
      await unknownDelivery(service, provider);
      provider.setLookup('not_found');
      assert.equal((await service.sweeper.runOnce()).checked, 1);
      assert.equal((await service.sweeper.runOnce()).checked, 0);
      clock.now += 1999;
      assert.equal((await service.sweeper.runOnce()).checked, 0);
      clock.now += 1;
      assert.equal((await service.sweeper.runOnce()).checked, 1);
      clock.now += 3999;
      assert.equal((await service.sweeper.runOnce()).checked, 0);
      const ticket = service.getTicket(ALPHA, ALPHA_TICKET);
      assert.equal(ticket.send_state, 'UNKNOWN');
      assert.equal(ticket.audit.filter(a => a.action === 'reconcile_inconclusive').length, 0);
      assert.equal(provider.ledger.length, 1);
      assert.equal(service.sweeper.status().tracked, 1);
    } finally {
      service.close();
    }
  });

  test('backoff is capped by the configured maximum', async () => {
    const { service, provider, clock } = harness({ DESK_RECONCILE_MAX_BACKOFF_MS: '3000' });
    try {
      await unknownDelivery(service, provider);
      provider.setLookup('not_found');
      await service.sweeper.runOnce();
      clock.now += 2000;
      await service.sweeper.runOnce();
      clock.now += 3000;
      assert.equal((await service.sweeper.runOnce()).checked, 1);
    } finally {
      service.close();
    }
  });

  test('ignores an attempt that is still in flight', async () => {
    const { service, provider } = harness();
    try {
      approvedReply(service);
      const release = provider.hold();
      const inFlight = settle(service.sendReply(ALPHA, ALPHA_TICKET));
      await new Promise(resolve => setImmediate(resolve));
      assert.equal((await service.sweeper.runOnce()).checked, 0);
      release();
      await inFlight;
    } finally {
      service.close();
    }
  });

  test('is disabled with interval 0 and runs on a real timer otherwise', async () => {
    const disabled = new DeskService({ provider: fakeProvider(), config: configWith({ DESK_RECONCILE_INTERVAL_MS: '0' }), logger: silentLogger });
    disabled.startBackgroundJobs();
    assert.equal(disabled.health().reconciler.enabled, false);
    disabled.close();
    const provider = fakeProvider();
    const service = new DeskService({ provider, config: configWith({ DESK_RECONCILE_INTERVAL_MS: '15' }), logger: silentLogger });
    try {
      await unknownDelivery(service, provider);
      service.startBackgroundJobs();
      service.startBackgroundJobs();
      await new Promise(resolve => setTimeout(resolve, 120));
      assert.equal(service.getTicket(ALPHA, ALPHA_TICKET).send_state, 'SENT');
      assert.equal(service.health().reconciler.running, true);
    } finally {
      service.close();
    }
  });
});

describe('health and metrics', () => {
  test('metrics are scoped to the signed-in organization', async () => {
    const { service, provider } = harness();
    try {
      await unknownDelivery(service, provider);
      service.handoff(ALPHA, ALPHA_TICKET);
      const alpha = service.metrics(ALPHA);
      assert.equal(alpha.attemptsByState.UNKNOWN, 1);
      assert.equal(typeof alpha.oldestUnresolvedSeconds, 'number');
      const beta = service.metrics(BETA);
      assert.equal(beta.attemptsByState.UNKNOWN, 0);
      assert.equal(beta.oldestUnresolvedSeconds, null);
      assert.equal(beta.auditEvents.dispatch_refused, 0);
    } finally {
      service.close();
    }
  });

  test('health reports the database and the reconciler', () => {
    const { service } = harness();
    try {
      const health = service.health();
      assert.equal(health.status, 'ok');
      assert.equal(health.database, true);
      assert.equal(health.reconciler.enabled, true);
    } finally {
      service.close();
    }
  });
});

describe('graceful shutdown', () => {
  test('drain waits for an in-flight send to settle', async () => {
    const { service, provider } = harness();
    try {
      approvedReply(service);
      const release = provider.hold();
      const send = service.sendReply(ALPHA, ALPHA_TICKET);
      setTimeout(release, 30);
      assert.equal(await service.drain(2000), 0);
      assert.equal((await send).send_state, 'SENT');
    } finally {
      service.close();
    }
  });

  test('drain gives up after the grace period and reports the unfinished dispatch', async () => {
    const { service, provider } = harness();
    approvedReply(service);
    const release = provider.hold();
    const send = settle(service.sendReply(ALPHA, ALPHA_TICKET));
    assert.equal(await service.drain(40), 1);
    release();
    await send;
    service.close();
  });

  test('shutdown closes the server, drains and closes the service', async () => {
    const service = new DeskService({ provider: fakeProvider(), logger: silentLogger });
    const server = createApp({ service, logger: silentLogger });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    await shutdown({ server, service, config: configWith({ DESK_SHUTDOWN_GRACE_MS: '50' }), logger: silentLogger });
    assert.equal(server.listening, false);
    assert.equal(service.health().database, false);
    assert.throws(() => service.listTickets(ALPHA));
  });
});

describe('HTTP operations endpoints', () => {
  test('health is public, metrics need an identity, the inbox page is cached by ETag', async () => {
    const service = new DeskService({ provider: fakeProvider(), logger: silentLogger });
    const server = createApp({ service, logger: silentLogger });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      assert.equal((await fetch(base + '/health')).status, 200);
      assert.equal((await fetch(base + '/api/metrics')).status, 401);
      const metrics = await fetch(base + '/api/metrics', { headers: { Authorization: 'Bearer demo-beta-token' } });
      assert.equal(metrics.status, 200);
      assert.equal((await metrics.json()).tenantId, 'beta');
      const page = await fetch(base + '/');
      const etag = page.headers.get('etag');
      assert.ok(etag);
      assert.equal((await fetch(base + '/', { headers: { 'If-None-Match': etag } })).status, 304);
      assert.equal((await fetch(base + '/', { headers: { 'If-None-Match': '"stale"' } })).status, 200);
    } finally {
      await new Promise(resolve => server.close(resolve));
      service.close();
    }
  });
});
