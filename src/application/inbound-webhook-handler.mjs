import { AuditAction, AuditDetail, ErrorMessage, SystemActor } from '../config/constants.mjs';
import { DeskError } from '../domain/errors.mjs';
import { describe, isNonEmptyText, isTicketId } from './support.mjs';

const NUMERIC = /^\d+$/;
const toTicketId = value => (typeof value === 'string' && NUMERIC.test(value) ? Number(value) : value);

export class InboundWebhookHandler {
  constructor({ db, repositories, limits }) {
    this.db = db;
    this.repositories = repositories;
    this.limits = limits;
  }

  handle(event) {
    const normalized = { ...event, ticketId: toTicketId(event?.ticketId) };
    this.#assertShape(normalized);
    return this.db.transaction(() => this.#store(normalized));
  }

  #assertShape(event) {
    const valid = isNonEmptyText(event?.tenantId, this.limits.maxEventIdLength)
      && isTicketId(event?.ticketId)
      && isNonEmptyText(event?.eventId, this.limits.maxEventIdLength)
      && isNonEmptyText(event?.body, this.limits.maxMessageLength);
    if (!valid) throw DeskError.badRequest(ErrorMessage.INVALID_EVENT);
  }

  #store({ tenantId, ticketId, eventId, body }) {
    const { tickets, inboundEvents, messages, audit } = this.repositories;
    if (!tickets.findForTenant(tenantId, ticketId)) throw DeskError.badRequest(ErrorMessage.INVALID_EVENT);
    if (!inboundEvents.tryRecord(tenantId, eventId, ticketId)) return { accepted: true, duplicate: true };
    messages.add(ticketId, eventId, body);
    audit.record(ticketId, AuditAction.INBOUND, SystemActor.WEBHOOK, describe(AuditDetail.EVENT + eventId));
    return { accepted: true, duplicate: false };
  }
}
