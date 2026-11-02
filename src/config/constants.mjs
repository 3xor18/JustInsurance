const freeze = Object.freeze;

export const DeliveryState = freeze({
  DRAFT: 'DRAFT',
  APPROVED: 'APPROVED',
  PENDING: 'PENDING',
  SENT: 'SENT',
  UNKNOWN: 'UNKNOWN',
  FAILED: 'FAILED'
});

export const UNRESOLVED_STATES = freeze([DeliveryState.PENDING, DeliveryState.UNKNOWN]);

export const Owner = freeze({ AUTOMATION: 'automation', HUMAN: 'human' });

export const DispatchOrigin = freeze({ MANUAL: 'manual', AUTOMATION: 'automation' });

export const SystemActor = freeze({ WEBHOOK: 'webhook', AUTOMATION: 'automation', RECOVERY: 'startup-recovery' });

export const AuditAction = freeze({
  INBOUND: 'inbound',
  INBOUND_DUPLICATE: 'inbound_duplicate_ignored',
  DRAFT_UPDATED: 'draft_updated',
  APPROVAL_INVALIDATED: 'approval_invalidated',
  APPROVED: 'approved',
  HUMAN_HANDOFF: 'human_handoff',
  DISPATCH_RESERVED: 'dispatch_reserved',
  DISPATCH_REFUSED: 'dispatch_refused',
  SENT: 'sent',
  DELIVERY_UNKNOWN: 'delivery_unknown',
  DELIVERY_FAILED: 'delivery_failed',
  DELIVERY_CONFIRMED: 'delivery_confirmed',
  RECONCILE_INCONCLUSIVE: 'reconcile_inconclusive',
  DUPLICATE_DELIVERY_DETECTED: 'duplicate_delivery_detected',
  RECOVERED_AFTER_RESTART: 'recovered_after_restart',
  SETTLEMENT_SKIPPED: 'settlement_skipped',
  MARKED_UNDELIVERED: 'marked_undelivered'
});

export const ProviderErrorKind = freeze({ NOT_ACCEPTED: 'not_accepted', UNKNOWN: 'unknown' });

export const LookupState = freeze({ DELIVERED: 'delivered', NOT_FOUND: 'not_found' });

export const HttpStatus = freeze({
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  INTERNAL_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504
});

export const HttpMethod = freeze({ GET: 'GET', POST: 'POST' });

export const HttpHeader = freeze({
  AUTHORIZATION: 'authorization',
  WEBHOOK_SECRET: 'x-demo-webhook-secret',
  CONTENT_TYPE: 'Content-Type',
  REQUEST_ID: 'X-Request-Id',
  NO_SNIFF: 'X-Content-Type-Options',
  FRAME_OPTIONS: 'X-Frame-Options',
  REFERRER_POLICY: 'Referrer-Policy',
  CACHE_CONTROL: 'Cache-Control'
});

export const HeaderValue = freeze({
  JSON: 'application/json',
  HTML: 'text/html; charset=utf-8',
  NO_SNIFF: 'nosniff',
  DENY: 'DENY',
  NO_REFERRER: 'no-referrer',
  NO_STORE: 'no-store',
  BEARER_PREFIX: 'Bearer '
});

export const RoutePath = freeze({
  HOME: '/',
  WEBHOOK: '/webhooks/ghl',
  TICKETS: '/api/tickets',
  TICKET: /^\/api\/tickets\/(\d+)$/,
  TICKET_ACTION: /^\/api\/tickets\/(\d+)\/(draft|approve|send|automation|handoff|reconcile|mark-undelivered)$/
});

export const TicketAction = freeze({
  DRAFT: 'draft',
  APPROVE: 'approve',
  SEND: 'send',
  AUTOMATION: 'automation',
  HANDOFF: 'handoff',
  RECONCILE: 'reconcile',
  MARK_UNDELIVERED: 'mark-undelivered'
});

export const ErrorMessage = freeze({
  TICKET_NOT_FOUND: 'Ticket not found',
  INVALID_EVENT: 'Invalid event',
  INVALID_WEBHOOK_SECRET: 'Invalid webhook secret',
  SIGN_IN_REQUIRED: 'Sign in using a demo identity',
  REPLY_REQUIRED: 'A reply is required',
  REPLY_TOO_LONG: 'The reply is too long',
  NO_DRAFT: 'No draft',
  APPROVAL_REQUIRED: 'Approve the reply first',
  APPROVAL_STALE: 'The draft changed after approval; approve the current version',
  ALREADY_DISPATCHED: 'This approved version was already dispatched',
  UNRESOLVED_DELIVERY: 'A previous delivery is unresolved; check delivery before sending again',
  TAKEOVER_BLOCKS_AUTOMATION: 'A human owns this conversation; automation may not send',
  NOTHING_TO_RECONCILE: 'There is no pending or uncertain delivery to check',
  APPROVAL_VERSION_MISMATCH: 'The draft changed since you reviewed it; reload and review the current version before approving',
  REASON_REQUIRED: 'A reason is required',
  ONLY_UNKNOWN_CAN_BE_MARKED: 'Only an UNKNOWN delivery can be marked as not delivered',
  INVALID_BODY: 'The request body must be a JSON object',
  NOT_FOUND: 'Not found',
  METHOD_NOT_ALLOWED: 'Method not allowed',
  BODY_TOO_LARGE: 'Body too large',
  INVALID_JSON: 'Invalid JSON',
  UNEXPECTED: 'Unexpected server error',
  PROVIDER_UNCONFIRMED: 'Provider did not confirm delivery',
  PROVIDER_LOOKUP_UNAVAILABLE: 'Lookup unavailable',
  ASYNC_TRANSACTION: 'Transactions must be synchronous',
  ILLEGAL_TRANSITION: 'Illegal delivery state transition'
});

export const NextAction = freeze({
  WRITE_DRAFT: 'Write and save a reply draft.',
  APPROVE: 'Review the saved draft and approve it.',
  SEND: 'Send the approved reply.',
  WAIT_FOR_DISPATCH: 'A dispatch is in progress. Wait, then check delivery. Do not send again.',
  CHECK_DELIVERY: 'Delivery is uncertain. Use "Check delivery". Do not send again or edit to resend. If checks stay inconclusive, verify with the provider and the customer, then use "Mark not delivered" with a reason.',
  RETRY_SEND: 'The last attempt is recorded as not delivered (explicit provider rejection or verified by an operator). It is safe to send the approved reply again.',
  NEW_REPLY: 'The reply was accepted by the provider. Write a new draft to reply again.'
});

export const AuditDetail = freeze({
  SEPARATOR: ' · ',
  ORIGIN: 'origin=',
  VERSION: 'version=',
  CLIENT_REF: 'clientRef=',
  PROVIDER_ID: 'providerMessageId=',
  COUNT: 'deliveries=',
  REASON: 'reason=',
  EVENT: 'event=',
  FROM_STATE: 'from=',
  LOOKUP_ERROR: 'lookup_failed',
  LOOKUP_NOT_FOUND: 'not_found_is_inconclusive',
  ATTEMPT_STILL_PENDING: 'attempt_still_in_flight'
});

export const LogEvent = freeze({
  LISTENING: 'server.listening',
  REQUEST_FAILED: 'request.failed',
  RECOVERY: 'startup.recovery',
  SHUTDOWN: 'server.shutdown'
});

export const LogLevel = freeze({ INFO: 'info', WARN: 'warn', ERROR: 'error' });

export const Cipher = freeze({
  ALGORITHM: 'aes-256-gcm',
  KEY_BYTES: 32,
  IV_BYTES: 12,
  ENVELOPE_VERSION: 'enc1',
  ENVELOPE_SEPARATOR: ':',
  ENCODING: 'base64',
  TEXT: 'utf8',
  KDF_SALT: 'support-desk-field-cipher'
});

export const Database = freeze({ MEMORY: ':memory:', CONSTRAINT_CODE: 'ERR_SQLITE_ERROR', UNIQUE_MARKER: 'UNIQUE constraint failed' });

export const Encoding = freeze({ UTF8: 'utf8' });

export const MIN_TICKET_ID = 1;
