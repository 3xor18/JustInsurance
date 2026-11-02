import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { AppConfig } from '../src/config/config.mjs';
import { DeliveryStateMachine } from '../src/domain/delivery-state-machine.mjs';
import { NextActionAdvisor } from '../src/domain/next-action-advisor.mjs';
import { OutcomeClassifier } from '../src/domain/outcome-classifier.mjs';
import { ReconcileResolver } from '../src/domain/reconcile-resolver.mjs';
import { constantTimeEquals } from '../src/http/auth.mjs';
import { FieldCipher } from '../src/infrastructure/field-cipher.mjs';
import { Database } from '../src/infrastructure/database.mjs';
import { DeskService } from '../src/service.mjs';
import { ALPHA, ALPHA_TICKET, approvedReply, fakeProvider, inbound, tempDatabase } from './helpers.mjs';

describe('security', () => {
  test('customer text and drafts are encrypted at rest', async () => {
    const db = tempDatabase();
    try {
      const service = new DeskService({ provider: fakeProvider(), databasePath: db.path });
      service.receiveWebhook(inbound('secret-event', { body: 'My SSN is fictional-123' }));
      approvedReply(service, ALPHA, ALPHA_TICKET, 'Private reply text');
      await service.sendReply(ALPHA, ALPHA_TICKET);
      service.close();
      const raw = new DatabaseSync(db.path);
      const stored = [
        ...raw.prepare('SELECT body FROM messages').all().map(r => r.body),
        ...raw.prepare('SELECT draft AS body FROM tickets WHERE id = 101').all().map(r => r.body),
        ...raw.prepare('SELECT body FROM attempts').all().map(r => r.body)
      ];
      raw.close();
      stored.forEach(value => assert.ok(value.startsWith('enc1:') && !/fictional-123|Private reply/.test(value)));
    } finally {
      db.cleanup();
    }
  });

  test('legacy plaintext rows remain readable', () => {
    const cipher = new FieldCipher(AppConfig.get().security);
    assert.equal(cipher.decrypt('plain legacy text'), 'plain legacy text');
    assert.equal(cipher.decrypt(cipher.encrypt('round trip')), 'round trip');
  });

  test('a configured data key must be 32 bytes', () => {
    assert.throws(() => new FieldCipher({ dataKey: Buffer.alloc(8).toString('base64') }), RangeError);
    assert.doesNotThrow(() => new FieldCipher({ dataKey: Buffer.alloc(32, 7).toString('base64') }));
  });

  test('secret comparison is length independent', () => {
    assert.equal(constantTimeEquals('fictional-webhook-secret', 'fictional-webhook-secret'), true);
    assert.equal(constantTimeEquals('short', 'a-much-longer-value'), false);
    assert.equal(constantTimeEquals(undefined, 'x'), false);
  });

  test('the inbox never renders customer text as HTML', () => {
    const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
    assert.doesNotMatch(html, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  });
});

describe('domain units', () => {
  test('state machine allows only documented transitions', () => {
    const machine = new DeliveryStateMachine();
    assert.equal(machine.canTransition('PENDING', 'UNKNOWN'), true);
    assert.equal(machine.canTransition('UNKNOWN', 'SENT'), true);
    assert.equal(machine.canTransition('UNKNOWN', 'FAILED'), false);
    assert.equal(machine.canTransition('SENT', 'PENDING'), false);
    assert.throws(() => machine.assertTransition('FAILED', 'SENT'));
    assert.equal(machine.isTerminal('SENT'), true);
  });

  test('outcome classifier treats only an explicit rejection as failure', () => {
    const classifier = new OutcomeClassifier();
    assert.equal(classifier.fromError({ kind: 'not_accepted' }).state, 'FAILED');
    assert.equal(classifier.fromError({ kind: 'unknown' }).state, 'UNKNOWN');
    assert.equal(classifier.fromError(new Error('socket hang up')).state, 'UNKNOWN');
    assert.equal(classifier.fromAccepted({ providerMessageId: 'p' }).state, 'SENT');
    assert.equal(classifier.fromAccepted({}).state, 'UNKNOWN');
  });

  test('reconcile resolver only resolves on delivered evidence with an id', () => {
    const resolver = new ReconcileResolver();
    assert.equal(resolver.fromEvidence({ state: 'delivered', providerMessageId: 'p', count: 1 }).resolved, true);
    assert.equal(resolver.fromEvidence({ state: 'delivered' }).resolved, false);
    assert.equal(resolver.fromEvidence({ state: 'not_found' }).resolved, false);
    assert.equal(resolver.fromEvidence(undefined).resolved, false);
    assert.equal(resolver.fromLookupFailure().resolved, false);
  });

  test('next action advisor covers every state', () => {
    const advisor = new NextActionAdvisor();
    const states = ['DRAFT', 'APPROVED', 'PENDING', 'UNKNOWN', 'FAILED', 'SENT'];
    states.forEach(state => assert.ok(advisor.advise({ send_state: state, draft: 'x' }).length > 0));
    assert.match(advisor.advise({ send_state: 'DRAFT', draft: '' }), /Write/);
  });

  test('database transactions reject async work and roll back on failure', () => {
    const db = new Database(':memory:', { busyTimeoutMs: 100 });
    db.exec('CREATE TABLE t (v INTEGER)');
    assert.throws(() => db.transaction(async () => {}));
    assert.throws(() => db.transaction(() => { db.run('INSERT INTO t VALUES (1)'); throw new Error('boom'); }));
    assert.equal(db.all('SELECT * FROM t').length, 0);
    db.close();
  });

  test('a duplicate event with a different body keeps the first one', () => {
    const service = new DeskService({ provider: fakeProvider() });
    service.receiveWebhook(inbound('dup', { body: 'first' }));
    const result = service.receiveWebhook(inbound('dup', { body: 'second' }));
    assert.equal(result.duplicate, true);
    assert.deepEqual(service.getTicket(ALPHA, ALPHA_TICKET).messages.map(m => m.body), ['first']);
    service.close();
  });
});

describe('migration from the original starter database', () => {
  test('upgrades an existing starter schema and keeps its rows', () => {
    const db = tempDatabase();
    try {
      const legacy = new DatabaseSync(db.path);
      legacy.exec(`CREATE TABLE tickets (id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, contact TEXT NOT NULL,
        subject TEXT NOT NULL, owner TEXT NOT NULL DEFAULT 'automation', draft TEXT NOT NULL DEFAULT '',
        version INTEGER NOT NULL DEFAULT 0, approved_version INTEGER, send_state TEXT NOT NULL DEFAULT 'DRAFT');
        CREATE TABLE messages (id INTEGER PRIMARY KEY, ticket_id INTEGER NOT NULL, event_id TEXT NOT NULL, body TEXT NOT NULL);
        CREATE TABLE audit (id INTEGER PRIMARY KEY, ticket_id INTEGER NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE attempts (id INTEGER PRIMARY KEY, ticket_id INTEGER NOT NULL, version INTEGER NOT NULL, client_ref TEXT NOT NULL UNIQUE, body TEXT NOT NULL, state TEXT NOT NULL, provider_id TEXT, UNIQUE(ticket_id, version));
        INSERT INTO tickets(id, tenant_id, contact, subject) VALUES (101, 'alpha', 'Jordan Demo', 'Cannot resume my practice exam');
        INSERT INTO messages(ticket_id, event_id, body) VALUES (101, 'old-event', 'legacy plaintext');`);
      legacy.close();
      const service = new DeskService({ provider: fakeProvider(), databasePath: db.path });
      service.receiveWebhook(inbound('old-event'));
      assert.deepEqual(service.getTicket(ALPHA, ALPHA_TICKET).messages.map(m => m.body), ['legacy plaintext']);
      service.close();
    } finally {
      db.cleanup();
    }
  });
});
