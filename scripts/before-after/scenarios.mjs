import { sleep } from './process-control.mjs';

const ALPHA = 'Bearer demo-alpha-token';
const BETA = 'Bearer demo-beta-token';
const SECRET = 'fictional-webhook-secret';
const PARALLEL = 5;
const DELAY_KILL_AFTER_MS = 800;
const DELAY_PROVIDER_MS = 10500;

const repeat = (count, fn) => Promise.all(Array.from({ length: count }, fn));
const statuses = responses => responses.map(r => r.status).sort().join(',');

async function prepareReply(ctx, body) {
  await ctx.api(ALPHA, 'POST', '/api/tickets/101/draft', { body });
  await ctx.api(ALPHA, 'POST', '/api/tickets/101/approve', {});
}

async function measured(ctx, work) {
  const before = await ctx.deliveries();
  const result = await work();
  return { result, delivered: (await ctx.deliveries()) - before };
}

export const SCENARIOS = Object.freeze([
  {
    id: 'S01', requirement: 'R1', title: 'Same inbound event delivered twice, then five times in parallel',
    async run(ctx) {
      const event = { tenantId: 'alpha', ticketId: 101, eventId: 'ba-event-1', body: 'Please help' };
      const first = await ctx.webhook(event, SECRET);
      const second = await ctx.webhook(event, SECRET);
      const burst = await repeat(PARALLEL, () => ctx.webhook(event, SECRET));
      const ticket = await ctx.api(ALPHA, 'GET', '/api/tickets/101');
      return { statuses: statuses([first, second, ...burst]), storedMessages: ticket.body.messages.filter(m => m.event_id === event.eventId).length };
    },
    expect: o => o.storedMessages === 1
  },
  {
    id: 'S02', requirement: 'R1', title: 'Same event id for Alpha and Beta is accepted for both',
    async run(ctx) {
      await ctx.webhook({ tenantId: 'alpha', ticketId: 101, eventId: 'shared-id', body: 'Alpha asks' }, SECRET);
      await ctx.webhook({ tenantId: 'beta', ticketId: 202, eventId: 'shared-id', body: 'Beta asks' }, SECRET);
      const alpha = await ctx.api(ALPHA, 'GET', '/api/tickets/101');
      const beta = await ctx.api(BETA, 'GET', '/api/tickets/202');
      return {
        alphaMessages: alpha.body.messages.filter(m => m.event_id === 'shared-id').length,
        betaMessages: beta.body.messages.filter(m => m.event_id === 'shared-id').length
      };
    },
    expect: o => o.alphaMessages === 1 && o.betaMessages === 1
  },
  {
    id: 'S03', requirement: 'R1', title: 'Webhook with a wrong secret',
    async run(ctx) {
      const response = await ctx.webhook({ tenantId: 'alpha', ticketId: 101, eventId: 'forged', body: 'x' }, 'wrong');
      return { status: response.status };
    },
    expect: o => o.status === 401
  },
  {
    id: 'S04', requirement: 'R2', title: 'Beta guesses Alpha ticket 101 and adds tenantId=alpha',
    async run(ctx) {
      await ctx.api(ALPHA, 'POST', '/api/tickets/101/draft', { body: 'Alpha private draft' });
      const read = await ctx.api(BETA, 'GET', '/api/tickets/101');
      const write = await ctx.api(BETA, 'POST', '/api/tickets/101/draft', { body: 'Beta hijack', tenantId: 'alpha' });
      const handoff = await ctx.api(BETA, 'POST', '/api/tickets/101/handoff', { tenantId: 'alpha' });
      const alpha = await ctx.api(ALPHA, 'GET', '/api/tickets/101');
      return { readStatus: read.status, writeStatus: write.status, handoffStatus: handoff.status, alphaDraft: alpha.body.draft, alphaOwner: alpha.body.owner };
    },
    expect: o => [403, 404].includes(o.readStatus) && [403, 404].includes(o.writeStatus) && o.alphaDraft === 'Alpha private draft' && o.alphaOwner === 'automation'
  },
  {
    id: 'S05', requirement: 'R3', title: 'Approve, edit, then send without re-approval',
    async run(ctx) {
      await prepareReply(ctx, 'Approved wording');
      await ctx.api(ALPHA, 'POST', '/api/tickets/101/draft', { body: 'Edited after approval' });
      const { result, delivered } = await measured(ctx, () => ctx.api(ALPHA, 'POST', '/api/tickets/101/send', {}));
      return { sendStatus: result.status, providerDeliveries: delivered };
    },
    expect: o => o.sendStatus === 409 && o.providerDeliveries === 0
  },
  {
    id: 'S06', requirement: 'R3', title: 'Five overlapping clicks on Send for one approved version',
    async run(ctx) {
      await prepareReply(ctx, 'Send once please');
      const { result, delivered } = await measured(ctx, () => repeat(PARALLEL, () => ctx.api(ALPHA, 'POST', '/api/tickets/101/send', {})));
      return { statuses: statuses(result), providerDeliveries: delivered };
    },
    expect: o => o.providerDeliveries === 1
  },
  {
    id: 'S07', requirement: 'R4', title: 'Provider accepts then times out (504)',
    async run(ctx) {
      await prepareReply(ctx, 'Timeout case');
      await ctx.mode('accept_then_timeout');
      const { result, delivered } = await measured(ctx, () => ctx.api(ALPHA, 'POST', '/api/tickets/101/send', {}));
      await ctx.mode('normal');
      const ticket = await ctx.api(ALPHA, 'GET', '/api/tickets/101');
      return { sendStatus: result.status, providerDeliveries: delivered, state: ticket.body.send_state, attemptsRecorded: ticket.body.attempts.length };
    },
    expect: o => o.providerDeliveries === 1 && o.state === 'UNKNOWN' && o.attemptsRecorded >= 1
  },
  {
    id: 'S08', requirement: 'R4', title: 'Restart the app after the unknown attempt, then click Send again',
    async run(ctx) {
      await ctx.restartApp();
      const { result, delivered } = await measured(ctx, () => ctx.api(ALPHA, 'POST', '/api/tickets/101/send', {}));
      const ticket = await ctx.api(ALPHA, 'GET', '/api/tickets/101');
      return { sendStatus: result.status, providerDeliveries: delivered, state: ticket.body.send_state };
    },
    expect: o => o.providerDeliveries === 0 && o.state === 'UNKNOWN'
  },
  {
    id: 'S09', requirement: 'R4', title: 'Operator checks delivery (reconcile)',
    async run(ctx) {
      const { result, delivered } = await measured(ctx, () => ctx.api(ALPHA, 'POST', '/api/tickets/101/reconcile', {}));
      return { status: result.status, providerDeliveries: delivered, state: result.body?.send_state ?? null };
    },
    expect: o => o.status === 200 && o.providerDeliveries === 0 && o.state === 'SENT'
  },
  {
    id: 'S10', requirement: 'R4', title: 'Provider rejects before accepting (503), then a retry',
    async run(ctx) {
      await prepareReply(ctx, 'Rejected first');
      await ctx.mode('reject_before_accept');
      const failed = await measured(ctx, () => ctx.api(ALPHA, 'POST', '/api/tickets/101/send', {}));
      await ctx.mode('normal');
      const state = (await ctx.api(ALPHA, 'GET', '/api/tickets/101')).body.send_state;
      const retry = await measured(ctx, () => ctx.api(ALPHA, 'POST', '/api/tickets/101/send', {}));
      return { firstStatus: failed.result.status, stateAfterReject: state, retryStatus: retry.result.status, retryDeliveries: retry.delivered };
    },
    expect: o => o.stateAfterReject === 'FAILED' && o.retryStatus === 200 && o.retryDeliveries === 1
  },
  {
    id: 'S11', requirement: 'R4', title: 'App killed while the provider call is in flight, restarted, Send clicked again',
    async run(ctx) {
      await prepareReply(ctx, 'Crash in flight');
      await ctx.mode('accept_then_delay');
      const before = await ctx.deliveries();
      ctx.api(ALPHA, 'POST', '/api/tickets/101/send', {}).catch(() => null);
      await sleep(DELAY_KILL_AFTER_MS);
      await ctx.restartApp();
      const afterRestart = (await ctx.api(ALPHA, 'GET', '/api/tickets/101')).body.send_state;
      await ctx.mode('normal');
      const resend = await ctx.api(ALPHA, 'POST', '/api/tickets/101/send', {});
      await sleep(DELAY_PROVIDER_MS - DELAY_KILL_AFTER_MS);
      const reconcile = await ctx.api(ALPHA, 'POST', '/api/tickets/101/reconcile', {});
      return {
        stateAfterRestart: afterRestart, resendStatus: resend.status,
        stateAfterReconcile: reconcile.body?.send_state ?? null, providerDeliveries: (await ctx.deliveries()) - before
      };
    },
    expect: o => o.stateAfterRestart === 'UNKNOWN' && o.resendStatus === 409 && o.providerDeliveries === 1 && o.stateAfterReconcile === 'SENT'
  },
  {
    id: 'S12', requirement: 'R5', title: 'Human takes over, automation tries to send, human sends',
    async run(ctx) {
      await prepareReply(ctx, 'After takeover');
      await ctx.api(ALPHA, 'POST', '/api/tickets/101/handoff', {});
      const automation = await measured(ctx, () => ctx.api(ALPHA, 'POST', '/api/tickets/101/automation', {}));
      const human = await measured(ctx, () => ctx.api(ALPHA, 'POST', '/api/tickets/101/send', {}));
      return { automationStatus: automation.result.status, automationDeliveries: automation.delivered, humanStatus: human.result.status, humanDeliveries: human.delivered };
    },
    expect: o => o.automationStatus === 409 && o.automationDeliveries === 0 && o.humanStatus === 200 && o.humanDeliveries === 1
  },
  {
    id: 'S13', requirement: 'R6', title: 'Ticket view tells the operator the next safe action',
    async run(ctx) {
      const ticket = await ctx.api(ALPHA, 'GET', '/api/tickets/101');
      return { hasNextAction: typeof ticket.body.nextAction === 'string', auditEntries: ticket.body.audit.length, auditHasActor: ticket.body.audit.every(a => 'actor' in a) };
    },
    expect: o => o.hasNextAction && o.auditHasActor
  }
]);
