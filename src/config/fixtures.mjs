const freeze = Object.freeze;

export const FIXTURE_WEBHOOK_SECRET = 'fictional-webhook-secret';

export const FIXTURE_IDENTITIES = freeze({
  'demo-alpha-token': freeze({ id: 'agent-alpha', tenantId: 'alpha' }),
  'demo-beta-token': freeze({ id: 'agent-beta', tenantId: 'beta' })
});

export const FIXTURE_TICKETS = freeze([
  freeze({ id: 101, tenantId: 'alpha', contact: 'Jordan Demo', subject: 'Cannot resume my practice exam' }),
  freeze({ id: 202, tenantId: 'beta', contact: 'Casey Example', subject: 'Course completion is missing' })
]);

export const FIXTURE_DEV_DATA_PASSPHRASE = 'local-exercise-only-not-a-secret';
