import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { DeskService } from '../src/service.mjs';
import {
  ALPHA, ALPHA_TICKET, BETA, BETA_TICKET, approvedReply, fakeProvider, inbound, settle, statusOf, tempDatabase, withService
} from './helpers.mjs';

describe('R1 safe inbound delivery', () => {
  test('a replayed event creates one message', withService(service => {
    service.receiveWebhook(inbound('event-1'));
    const replay = statusOf(() => service.receiveWebhook(inbound('event-1')));
    assert.equal(replay, 200);
    assert.equal(service.getTicket(ALPHA, ALPHA_TICKET).messages.length, 1);
  }));

  test('event identity is scoped per organization', withService(service => {
    service.receiveWebhook(inbound('event-1'));
    service.receiveWebhook(inbound('event-1', { tenantId: 'beta', ticketId: BETA_TICKET }));
    assert.equal(service.getTicket(ALPHA, ALPHA_TICKET).messages.length, 1);
    assert.equal(service.getTicket(BETA, BETA_TICKET).messages.length, 1);
  }));

  test('overlapping deliveries of the same event store it once', withService(async service => {
    await Promise.all(Array.from({ length: 10 }, () => Promise.resolve().then(() => service.receiveWebhook(inbound('burst')))));
    assert.equal(service.getTicket(ALPHA, ALPHA_TICKET).messages.length, 1);
  }));

  test('a replay after restart does not duplicate the message', async () => {
    const db = tempDatabase();
    try {
      const first = new DeskService({ provider: fakeProvider(), databasePath: db.path });
      first.receiveWebhook(inbound('event-restart'));
      first.close();
      const second = new DeskService({ provider: fakeProvider(), databasePath: db.path });
      second.receiveWebhook(inbound('event-restart'));
      assert.equal(second.getTicket(ALPHA, ALPHA_TICKET).messages.length, 1);
      second.close();
    } finally {
      db.cleanup();
    }
  });

  test('an event for another organization ticket is rejected and leaves no trace', withService(service => {
    assert.equal(statusOf(() => service.receiveWebhook(inbound('cross', { tenantId: 'beta' }))), 400);
    assert.equal(service.getTicket(ALPHA, ALPHA_TICKET).messages.length, 0);
  }));
});

describe('R2 customer isolation', () => {
  const crossTenantCalls = service => [
    () => service.getTicket(BETA, ALPHA_TICKET),
    () => service.updateDraft(BETA, ALPHA_TICKET, 'hijack'),
    () => service.approveDraft(BETA, ALPHA_TICKET),
    () => service.handoff(BETA, ALPHA_TICKET)
  ];

  test('another organization cannot read or change a ticket by guessing its id', withService(service => {
    approvedReply(service);
    const statuses = crossTenantCalls(service).map(statusOf);
    statuses.forEach(status => assert.ok([403, 404].includes(status), `status ${status}`));
    const ticket = service.getTicket(ALPHA, ALPHA_TICKET);
    assert.equal(ticket.draft, 'A human will help.');
    assert.equal(ticket.owner, 'automation');
  }));

  test('another organization cannot send or reconcile the ticket', withService(async (service, provider) => {
    approvedReply(service);
    const results = await Promise.all([
      settle(service.sendReply(BETA, ALPHA_TICKET)),
      settle(service.sendReply(BETA, ALPHA_TICKET, { automatic: true })),
      settle(service.reconcile(BETA, ALPHA_TICKET))
    ]);
    results.forEach(r => assert.ok(!r.ok && [403, 404].includes(r.error.status)));
    assert.equal(provider.ledger.length, 0);
  }));

  test('a supplied tenantId never widens access', withService(service => {
    assert.ok([403, 404].includes(statusOf(() => service.getTicket({ ...BETA, tenantId: 'beta' }, ALPHA_TICKET))));
    assert.deepEqual(service.listTickets(BETA).map(t => t.id), [BETA_TICKET]);
  }));
});

describe('R3 exact approval', () => {
  test('a draft cannot be sent before approval', withService(async (service, provider) => {
    service.updateDraft(ALPHA, ALPHA_TICKET, 'Not approved yet');
    const result = await settle(service.sendReply(ALPHA, ALPHA_TICKET));
    assert.equal(result.error?.status, 409);
    assert.equal(provider.ledger.length, 0);
  }));

  test('editing an approved draft invalidates the approval', withService(async (service, provider) => {
    approvedReply(service, ALPHA, ALPHA_TICKET, 'Approved text');
    service.updateDraft(ALPHA, ALPHA_TICKET, 'Edited text');
    const result = await settle(service.sendReply(ALPHA, ALPHA_TICKET));
    assert.equal(result.error?.status, 409);
    assert.equal(provider.ledger.length, 0);
  }));

  test('the exact approved text is what reaches the provider', withService(async (service, provider) => {
    approvedReply(service, ALPHA, ALPHA_TICKET, 'Exact approved words');
    await service.sendReply(ALPHA, ALPHA_TICKET);
    assert.deepEqual(provider.ledger.map(m => m.body), ['Exact approved words']);
  }));

  test('overlapping send requests deliver the approved version once', withService(async (service, provider) => {
    approvedReply(service);
    const results = await Promise.all(Array.from({ length: 5 }, () => settle(service.sendReply(ALPHA, ALPHA_TICKET))));
    assert.equal(provider.ledger.length, 1);
    assert.equal(results.filter(r => r.ok).length, 1);
    results.filter(r => !r.ok).forEach(r => assert.equal(r.error.status, 409));
  }));

  test('a repeated click after success does not resend', withService(async (service, provider) => {
    approvedReply(service);
    await service.sendReply(ALPHA, ALPHA_TICKET);
    const again = await settle(service.sendReply(ALPHA, ALPHA_TICKET));
    assert.equal(again.error?.status, 409);
    assert.equal(provider.ledger.length, 1);
  }));

  test('automation also requires approval', withService(async (service, provider) => {
    service.updateDraft(ALPHA, ALPHA_TICKET, 'Suggested by automation');
    const result = await settle(service.sendReply(ALPHA, ALPHA_TICKET, { automatic: true }));
    assert.equal(result.error?.status, 409);
    assert.equal(provider.ledger.length, 0);
  }));
});

describe('R4 honest delivery and recovery', () => {
  test('a timeout is recorded as UNKNOWN and never retried automatically', withService(async (service, provider) => {
    approvedReply(service);
    provider.setMode('timeout');
    const ticket = await service.sendReply(ALPHA, ALPHA_TICKET);
    assert.equal(provider.ledger.length, 1);
    assert.equal(ticket.send_state, 'UNKNOWN');
    assert.equal(ticket.attempts.length, 1);
    assert.equal(ticket.attempts[0].state, 'UNKNOWN');
    assert.ok(ticket.attempts[0].client_ref);
  }));

  test('an unknown delivery blocks new sends until reconciled', withService(async (service, provider) => {
    approvedReply(service);
    provider.setMode('timeout');
    await service.sendReply(ALPHA, ALPHA_TICKET);
    provider.setMode('normal');
    approvedReply(service, ALPHA, ALPHA_TICKET, 'Edited to sneak a resend');
    const resend = await settle(service.sendReply(ALPHA, ALPHA_TICKET));
    assert.equal(resend.error?.status, 409);
    assert.equal(provider.ledger.length, 1);
  }));

  test('reconcile confirms the same attempt without resending', withService(async (service, provider) => {
    approvedReply(service);
    provider.setMode('timeout');
    const unknown = await service.sendReply(ALPHA, ALPHA_TICKET);
    const ticket = await service.reconcile(ALPHA, ALPHA_TICKET);
    assert.equal(provider.ledger.length, 1);
    assert.deepEqual(provider.lookups, [unknown.attempts[0].client_ref]);
    assert.equal(ticket.send_state, 'SENT');
    assert.equal(ticket.attempts[0].state, 'SENT');
  }));

  test('not_found is inconclusive and keeps the delivery UNKNOWN', withService(async (service, provider) => {
    approvedReply(service);
    provider.setMode('timeout');
    await service.sendReply(ALPHA, ALPHA_TICKET);
    provider.setLookup('not_found');
    const ticket = await service.reconcile(ALPHA, ALPHA_TICKET);
    assert.equal(ticket.send_state, 'UNKNOWN');
    assert.equal(provider.ledger.length, 1);
  }));

  test('a failed lookup is inconclusive', withService(async (service, provider) => {
    approvedReply(service);
    provider.setMode('timeout');
    await service.sendReply(ALPHA, ALPHA_TICKET);
    provider.setLookup('fail');
    const ticket = await service.reconcile(ALPHA, ALPHA_TICKET);
    assert.equal(ticket.send_state, 'UNKNOWN');
  }));

  test('an explicit rejection before acceptance is a safe failure that can be retried', withService(async (service, provider) => {
    approvedReply(service);
    provider.setMode('reject');
    const failed = await service.sendReply(ALPHA, ALPHA_TICKET);
    assert.equal(failed.send_state, 'FAILED');
    provider.setMode('normal');
    const sent = await service.sendReply(ALPHA, ALPHA_TICKET);
    assert.equal(sent.send_state, 'SENT');
    assert.equal(provider.ledger.length, 1);
  }));

  test('a restart after an unknown attempt does not send again', async () => {
    const db = tempDatabase();
    const provider = fakeProvider();
    try {
      const first = new DeskService({ provider, databasePath: db.path });
      approvedReply(first);
      provider.setMode('timeout');
      await first.sendReply(ALPHA, ALPHA_TICKET);
      first.close();
      provider.setMode('normal');
      const second = new DeskService({ provider, databasePath: db.path });
      const resend = await settle(second.sendReply(ALPHA, ALPHA_TICKET));
      assert.equal(resend.error?.status, 409);
      assert.equal(second.getTicket(ALPHA, ALPHA_TICKET).send_state, 'UNKNOWN');
      assert.equal(provider.ledger.length, 1);
      second.close();
    } finally {
      db.cleanup();
    }
  });

  test('a crash while the provider call is in flight is recovered as UNKNOWN', async () => {
    const db = tempDatabase();
    const provider = fakeProvider();
    try {
      const first = new DeskService({ provider, databasePath: db.path });
      approvedReply(first);
      const release = provider.hold();
      const inFlight = settle(first.sendReply(ALPHA, ALPHA_TICKET));
      await new Promise(resolve => setImmediate(resolve));
      const second = new DeskService({ provider, databasePath: db.path });
      const recovered = second.getTicket(ALPHA, ALPHA_TICKET);
      assert.equal(recovered.send_state, 'UNKNOWN');
      assert.ok(recovered.audit.some(a => a.action === 'recovered_after_restart'));
      const resend = await settle(second.sendReply(ALPHA, ALPHA_TICKET));
      assert.equal(resend.error?.status, 409);
      release();
      await inFlight;
      const confirmed = await second.reconcile(ALPHA, ALPHA_TICKET);
      assert.equal(confirmed.send_state, 'SENT');
      assert.equal(provider.ledger.length, 1);
      first.close();
      second.close();
    } finally {
      db.cleanup();
    }
  });
});

describe('R5 human takeover', () => {
  test('automation is refused after takeover', withService(async (service, provider) => {
    approvedReply(service);
    service.handoff(ALPHA, ALPHA_TICKET);
    const result = await settle(service.sendReply(ALPHA, ALPHA_TICKET, { automatic: true }));
    assert.equal(result.error?.status, 409);
    assert.equal(provider.ledger.length, 0);
  }));

  test('the human can still send an approved reply after takeover', withService(async (service, provider) => {
    approvedReply(service);
    service.handoff(ALPHA, ALPHA_TICKET);
    const ticket = await service.sendReply(ALPHA, ALPHA_TICKET);
    assert.equal(ticket.send_state, 'SENT');
    assert.equal(provider.ledger.length, 1);
  }));
});

describe('R6 usable handoff', () => {
  test('the ticket view explains owner, approval, delivery, audit and next safe action', withService(async (service, provider) => {
    service.receiveWebhook(inbound('event-ui'));
    approvedReply(service);
    provider.setMode('timeout');
    const ticket = await service.sendReply(ALPHA, ALPHA_TICKET);
    assert.equal(ticket.owner, 'automation');
    assert.equal(ticket.approved, true);
    assert.match(ticket.nextAction, /Check delivery/);
    const actions = ticket.audit.map(a => a.action);
    ['inbound', 'draft_updated', 'approved', 'dispatch_reserved', 'delivery_unknown'].forEach(a => assert.ok(actions.includes(a), a));
  }));

  test('refused automation is visible in the audit trail', withService(async service => {
    approvedReply(service);
    service.handoff(ALPHA, ALPHA_TICKET);
    await settle(service.sendReply(ALPHA, ALPHA_TICKET, { automatic: true }));
    const refusal = service.getTicket(ALPHA, ALPHA_TICKET).audit.find(a => a.action === 'dispatch_refused');
    assert.match(refusal.detail, /A human owns this conversation/);
  }));
});
