import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeskService } from '../src/service.mjs';

export const ALPHA = Object.freeze({ id: 'agent-alpha', tenantId: 'alpha' });
export const BETA = Object.freeze({ id: 'agent-beta', tenantId: 'beta' });
export const ALPHA_TICKET = 101;
export const BETA_TICKET = 202;

export const inbound = (eventId, overrides = {}) =>
  ({ tenantId: 'alpha', ticketId: ALPHA_TICKET, eventId, body: 'Please help', ...overrides });

export const providerError = kind => Object.assign(new Error(kind), { kind });

export function fakeProvider() {
  const state = { mode: 'normal', gate: null, lookupMode: 'ledger' };
  const ledger = [];
  return {
    ledger,
    lookups: [],
    setMode(mode) { state.mode = mode; },
    setLookup(mode) { state.lookupMode = mode; },
    hold() {
      let release;
      state.gate = new Promise(resolve => { release = resolve; });
      return () => { state.gate = null; release(); };
    },
    async send(payload) {
      if (state.mode === 'reject') throw providerError('not_accepted');
      ledger.push(payload);
      if (state.gate) await state.gate;
      if (state.mode === 'timeout') throw providerError('unknown');
      return { providerMessageId: `prov-${ledger.length}` };
    },
    async lookup(clientRef) {
      this.lookups.push(clientRef);
      if (state.lookupMode === 'fail') throw new Error('lookup unavailable');
      if (state.lookupMode === 'not_found') return { state: 'not_found' };
      const matches = ledger.filter(m => m.clientRef === clientRef);
      return matches.length ? { state: 'delivered', providerMessageId: `prov-${clientRef}`, count: matches.length } : { state: 'not_found' };
    }
  };
}

export function tempDatabase() {
  const dir = mkdtempSync(join(tmpdir(), 'desk-test-'));
  return { path: join(dir, 'desk.sqlite'), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export function withService(fn, options = {}) {
  return async () => {
    const provider = options.provider ?? fakeProvider();
    const service = new DeskService({ provider, databasePath: options.databasePath });
    try {
      await fn(service, provider);
    } finally {
      service.close();
    }
  };
}

export const approvedReply = (service, actor = ALPHA, id = ALPHA_TICKET, body = 'A human will help.') => {
  service.updateDraft(actor, id, body);
  return service.approveDraft(actor, id);
};

export const settle = promise => promise.then(value => ({ ok: true, value }), error => ({ ok: false, error }));

export const statusOf = fn => {
  try {
    fn();
    return 200;
  } catch (error) {
    return error.status ?? 500;
  }
};
