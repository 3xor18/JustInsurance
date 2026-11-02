import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { DeskService } from '../src/service.mjs';
import { ALPHA, ALPHA_TICKET, approvedReply, fakeProvider, inbound, settle, statusOf, tempDatabase, withService } from './helpers.mjs';

describe('adversarial review fixes', () => {
  test('approval is refused when the reviewed version is stale', withService(service => {
    const reviewed = service.updateDraft(ALPHA, ALPHA_TICKET, 'Version the agent read');
    service.updateDraft(ALPHA, ALPHA_TICKET, 'Changed in another tab');
    assert.equal(statusOf(() => service.approveDraft(ALPHA, ALPHA_TICKET, reviewed.version)), 409);
    assert.equal(service.getTicket(ALPHA, ALPHA_TICKET).approved, false);
  }));

  test('an already dispatched version cannot be approved again', withService(async service => {
    approvedReply(service);
    await service.sendReply(ALPHA, ALPHA_TICKET);
    assert.equal(statusOf(() => service.approveDraft(ALPHA, ALPHA_TICKET)), 409);
    assert.equal(service.getTicket(ALPHA, ALPHA_TICKET).send_state, 'SENT');
  }));

  test('the inbox list shows an unresolved delivery even after a new draft', withService(async (service, provider) => {
    approvedReply(service);
    provider.setMode('timeout');
    await service.sendReply(ALPHA, ALPHA_TICKET);
    service.updateDraft(ALPHA, ALPHA_TICKET, 'New draft while unknown');
    const row = service.listTickets(ALPHA).find(t => t.id === ALPHA_TICKET);
    assert.equal(row.send_state, 'UNKNOWN');
    assert.equal(row.draft, 'New draft while unknown');
  }));

  test('an operator can close an inconclusive delivery with a reason and then resend', withService(async (service, provider) => {
    approvedReply(service);
    provider.setMode('timeout');
    await service.sendReply(ALPHA, ALPHA_TICKET);
    provider.setLookup('not_found');
    await service.reconcile(ALPHA, ALPHA_TICKET);
    assert.equal(statusOf(() => service.markUndelivered(ALPHA, ALPHA_TICKET, '')), 400);
    const closed = service.markUndelivered(ALPHA, ALPHA_TICKET, 'Customer confirmed nothing arrived');
    assert.equal(closed.send_state, 'FAILED');
    assert.ok(closed.audit.some(a => a.action === 'marked_undelivered' && a.detail.includes('Customer confirmed')));
    provider.setMode('normal');
    const resent = await service.sendReply(ALPHA, ALPHA_TICKET);
    assert.equal(resent.send_state, 'SENT');
    assert.equal(provider.ledger.length, 2);
  }));

  test('an in-flight or missing attempt cannot be marked as not delivered', withService(async (service, provider) => {
    assert.equal(statusOf(() => service.markUndelivered(ALPHA, ALPHA_TICKET, 'nothing to close')), 409);
    approvedReply(service);
    const release = provider.hold();
    const inFlight = settle(service.sendReply(ALPHA, ALPHA_TICKET));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(statusOf(() => service.markUndelivered(ALPHA, ALPHA_TICKET, 'too early')), 409);
    release();
    await inFlight;
  }));

  test('a numeric string ticketId from the webhook is accepted', withService(service => {
    service.receiveWebhook(inbound('string-id', { ticketId: '101' }));
    assert.equal(service.getTicket(ALPHA, ALPHA_TICKET).messages.length, 1);
  }));

  test('a legacy plaintext row that looks like an envelope stays readable', async () => {
    const db = tempDatabase();
    try {
      new DeskService({ provider: fakeProvider(), databasePath: db.path }).close();
      const raw = new DatabaseSync(db.path);
      raw.prepare("INSERT INTO messages(ticket_id, event_id, body) VALUES (101, 'legacy', 'enc1: looks encrypted but is not')").run();
      raw.close();
      const service = new DeskService({ provider: fakeProvider(), databasePath: db.path });
      assert.deepEqual(service.getTicket(ALPHA, ALPHA_TICKET).messages.map(m => m.body), ['enc1: looks encrypted but is not']);
      service.close();
    } finally {
      db.cleanup();
    }
  });
});
