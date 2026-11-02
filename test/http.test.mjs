import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.mjs';
import { DeskService } from '../src/service.mjs';
import { fakeProvider } from './helpers.mjs';

const ALPHA_AUTH = { Authorization: 'Bearer demo-alpha-token' };
const BETA_AUTH = { Authorization: 'Bearer demo-beta-token' };
const WEBHOOK_AUTH = { 'X-Demo-Webhook-Secret': 'fictional-webhook-secret' };
const silentLogger = { info() {}, warn() {}, error() {} };

describe('HTTP contract', () => {
  let server;
  let service;
  let provider;
  let base;

  const call = async (method, path, headers = {}, body) => {
    const response = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
    });
    return { status: response.status, body: await response.json().catch(() => null), headers: response.headers };
  };

  before(async () => {
    provider = fakeProvider();
    service = new DeskService({ provider });
    server = createApp({ service, logger: silentLogger });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise(resolve => server.close(resolve));
    service.close();
  });

  test('rejects a webhook with an invalid secret', async () => {
    const response = await call('POST', '/webhooks/ghl', { 'X-Demo-Webhook-Secret': 'wrong' }, { tenantId: 'alpha', ticketId: 101, eventId: 'x', body: 'hi' });
    assert.equal(response.status, 401);
  });

  test('overlapping webhook replays over HTTP store the event once', async () => {
    const event = { tenantId: 'alpha', ticketId: 101, eventId: 'http-burst', body: 'Please help' };
    const responses = await Promise.all(Array.from({ length: 8 }, () => call('POST', '/webhooks/ghl', WEBHOOK_AUTH, event)));
    responses.forEach(r => assert.equal(r.status, 200));
    const ticket = await call('GET', '/api/tickets/101', ALPHA_AUTH);
    assert.equal(ticket.body.messages.filter(m => m.event_id === 'http-burst').length, 1);
  });

  test('requires a known identity', async () => {
    assert.equal((await call('GET', '/api/tickets')).status, 401);
    assert.equal((await call('GET', '/api/tickets', { Authorization: 'Bearer __proto__' })).status, 401);
  });

  test('cross-organization access returns 404 and a body tenantId is ignored', async () => {
    assert.equal((await call('GET', '/api/tickets/101', BETA_AUTH)).status, 404);
    assert.equal((await call('POST', '/api/tickets/101/draft', BETA_AUTH, { body: 'x', tenantId: 'alpha' })).status, 404);
  });

  test('overlapping send requests over HTTP reach the provider once', async () => {
    await call('POST', '/api/tickets/101/draft', ALPHA_AUTH, { body: 'Concurrent send' });
    await call('POST', '/api/tickets/101/approve', ALPHA_AUTH, {});
    const before = provider.ledger.length;
    const responses = await Promise.all(Array.from({ length: 6 }, () => call('POST', '/api/tickets/101/send', ALPHA_AUTH, {})));
    assert.equal(provider.ledger.length - before, 1);
    assert.equal(responses.filter(r => r.status === 200).length, 1);
    assert.ok(responses.filter(r => r.status !== 200).every(r => r.status === 409));
  });

  test('rejected actions return 4xx with a consistent error shape', async () => {
    const response = await call('POST', '/api/tickets/101/reconcile', ALPHA_AUTH, {});
    assert.equal(response.status, 409);
    assert.equal(typeof response.body.error, 'string');
    assert.equal((await call('POST', '/api/tickets/101/draft', ALPHA_AUTH, '{not json')).status, 400);
    assert.equal((await call('GET', '/api/tickets/101/send', ALPHA_AUTH)).status, 405);
    assert.equal((await call('GET', '/api/nothing', ALPHA_AUTH)).status, 404);
  });

  test('non-object JSON bodies are refused with 400', async () => {
    assert.equal((await call('POST', '/api/tickets/101/draft', ALPHA_AUTH, 'null')).status, 400);
    assert.equal((await call('POST', '/api/tickets/101/approve', ALPHA_AUTH, '[1]')).status, 400);
  });

  test('approve accepts the reviewed version and rejects a stale one', async () => {
    const draft = await call('POST', '/api/tickets/101/draft', ALPHA_AUTH, { body: 'Reviewed over HTTP' });
    assert.equal((await call('POST', '/api/tickets/101/approve', ALPHA_AUTH, { version: draft.body.version - 1 })).status, 409);
    assert.equal((await call('POST', '/api/tickets/101/approve', ALPHA_AUTH, { version: draft.body.version })).status, 200);
  });

  test('oversized bodies are refused', async () => {
    const response = await call('POST', '/api/tickets/101/draft', ALPHA_AUTH, { body: 'x'.repeat(200000) });
    assert.equal(response.status, 413);
  });

  test('serves the inbox with defensive headers', async () => {
    const response = await fetch(base + '/');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(response.headers.get('x-request-id'));
  });
});
