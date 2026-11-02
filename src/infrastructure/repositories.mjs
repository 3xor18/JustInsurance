import { DeliveryState } from '../config/constants.mjs';
import { AttemptSql, AuditSql, InboundEventSql, MessageSql, TicketSql } from './sql.mjs';

export class TicketRepository {
  constructor(db, cipher) {
    this.db = db;
    this.cipher = cipher;
  }

  listForTenant(tenantId) {
    return this.db.all(TicketSql.listForTenant, tenantId);
  }

  findForTenant(tenantId, id) {
    const row = this.db.get(TicketSql.findForTenant, id, tenantId);
    return row && { ...row, draft: this.cipher.decrypt(row.draft) };
  }

  saveDraft(tenantId, id, body) {
    return this.db.run(TicketSql.saveDraft, this.cipher.encrypt(body), DeliveryState.DRAFT, id, tenantId).changes;
  }

  approve(tenantId, id, version, actorId) {
    return this.db.run(TicketSql.approve, actorId, DeliveryState.APPROVED, id, tenantId, version).changes;
  }

  assignOwner(tenantId, id, owner) {
    return this.db.run(TicketSql.assignOwner, owner, id, tenantId).changes;
  }

  setSendState(id, state) {
    return this.db.run(TicketSql.setSendState, state, id).changes;
  }

  setSendStateIfVersion(id, version, state) {
    return this.db.run(TicketSql.setSendStateIfVersion, state, id, version).changes;
  }
}

export class MessageRepository {
  constructor(db, cipher) {
    this.db = db;
    this.cipher = cipher;
  }

  add(ticketId, eventId, body) {
    return this.db.run(MessageSql.insert, ticketId, eventId, this.cipher.encrypt(body));
  }

  listByTicket(ticketId) {
    return this.db.all(MessageSql.listByTicket, ticketId).map(m => ({ ...m, body: this.cipher.decrypt(m.body) }));
  }
}

export class InboundEventRepository {
  constructor(db) {
    this.db = db;
  }

  tryRecord(tenantId, eventId, ticketId) {
    return this.db.run(InboundEventSql.tryRecord, tenantId, eventId, ticketId).changes > 0;
  }
}

export class AttemptRepository {
  constructor(db, cipher, stateMachine) {
    this.db = db;
    this.cipher = cipher;
    this.stateMachine = stateMachine;
  }

  reserve({ ticketId, version, clientRef, body, origin, actor }) {
    const { lastInsertRowid } = this.db.run(
      AttemptSql.insert, ticketId, version, clientRef, this.cipher.encrypt(body), DeliveryState.PENDING, origin, actor
    );
    return this.findById(Number(lastInsertRowid));
  }

  findById(id) {
    return this.#decode(this.db.get(AttemptSql.findById, id));
  }

  findUnresolved(ticketId) {
    return this.#decode(this.db.get(AttemptSql.findUnresolved, ticketId));
  }

  findLiveForVersion(ticketId, version) {
    return this.#decode(this.db.get(AttemptSql.findLiveForVersion, ticketId, version));
  }

  listByTicket(ticketId) {
    return this.db.all(AttemptSql.listByTicket, ticketId).map(row => this.#decode(row));
  }

  listByState(state) {
    return this.db.all(AttemptSql.listByState, state).map(row => this.#decode(row));
  }

  transition(id, from, to, providerId = null) {
    this.stateMachine.assertTransition(from, to);
    return this.db.run(AttemptSql.transition, to, providerId, id, from).changes > 0;
  }

  #decode(row) {
    return row && { ...row, body: this.cipher.decrypt(row.body) };
  }
}

export class AuditRepository {
  constructor(db) {
    this.db = db;
  }

  record(ticketId, action, actor, detail) {
    this.db.run(AuditSql.insert, ticketId, action, actor, detail);
  }

  listByTicket(ticketId) {
    return this.db.all(AuditSql.listByTicket, ticketId);
  }
}
