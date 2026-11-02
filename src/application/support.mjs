import { AuditDetail, ErrorMessage, MIN_TICKET_ID } from '../config/constants.mjs';
import { DeskError } from '../domain/errors.mjs';

export const describe = (...parts) => parts.filter(part => part !== null && part !== undefined).join(AuditDetail.SEPARATOR);

export const isNonEmptyText = (value, maxLength) =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;

export const isTicketId = value => Number.isSafeInteger(value) && value >= MIN_TICKET_ID;

export class TicketAccess {
  constructor(tickets) {
    this.tickets = tickets;
  }

  require(actor, id) {
    const ticket = isTicketId(id) ? this.tickets.findForTenant(actor.tenantId, id) : undefined;
    if (!ticket) throw DeskError.notFound(ErrorMessage.TICKET_NOT_FOUND);
    return ticket;
  }
}
