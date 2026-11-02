export class TicketQuery {
  constructor({ repositories, access, advisor }) {
    this.repositories = repositories;
    this.access = access;
    this.advisor = advisor;
  }

  list(actor) {
    return this.repositories.tickets.listForTenant(actor.tenantId);
  }

  get(actor, id) {
    const ticket = this.access.require(actor, id);
    const { messages, attempts, audit } = this.repositories;
    const unresolved = attempts.findUnresolved(id);
    const view = { ...ticket, send_state: unresolved?.state ?? ticket.send_state };
    return {
      ...view,
      approved: ticket.approved_version != null && ticket.approved_version === ticket.version,
      nextAction: this.advisor.advise(view),
      messages: messages.listByTicket(id),
      attempts: attempts.listByTicket(id),
      audit: audit.listByTicket(id)
    };
  }
}
