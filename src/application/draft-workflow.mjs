import { AuditAction, AuditDetail, ErrorMessage, Owner } from '../config/constants.mjs';
import { DeskError } from '../domain/errors.mjs';
import { describe, isNonEmptyText } from './support.mjs';

export class DraftWorkflow {
  constructor({ db, repositories, access, limits }) {
    this.db = db;
    this.repositories = repositories;
    this.access = access;
    this.limits = limits;
  }

  updateDraft(actor, id, body) {
    this.#assertReply(body);
    this.db.transaction(() => {
      const ticket = this.access.require(actor, id);
      const { tickets, audit } = this.repositories;
      tickets.saveDraft(actor.tenantId, id, body);
      audit.record(id, AuditAction.DRAFT_UPDATED, actor.id, describe(AuditDetail.VERSION + (ticket.version + 1)));
      if (ticket.approved_version != null) {
        audit.record(id, AuditAction.APPROVAL_INVALIDATED, actor.id, describe(AuditDetail.VERSION + ticket.approved_version));
      }
    });
  }

  approve(actor, id, reviewedVersion) {
    this.db.transaction(() => {
      const ticket = this.access.require(actor, id);
      this.#assertApprovable(ticket, reviewedVersion);
      this.repositories.tickets.approve(actor.tenantId, id, ticket.version, actor.id);
      this.repositories.audit.record(id, AuditAction.APPROVED, actor.id, describe(AuditDetail.VERSION + ticket.version));
    });
  }

  handoff(actor, id) {
    this.db.transaction(() => {
      this.access.require(actor, id);
      this.repositories.tickets.assignOwner(actor.tenantId, id, Owner.HUMAN);
      this.repositories.audit.record(id, AuditAction.HUMAN_HANDOFF, actor.id, describe(Owner.HUMAN));
    });
  }

  #assertApprovable(ticket, reviewedVersion) {
    if (!ticket.draft) throw DeskError.badRequest(ErrorMessage.NO_DRAFT);
    if (reviewedVersion !== undefined && reviewedVersion !== ticket.version) throw DeskError.conflict(ErrorMessage.APPROVAL_VERSION_MISMATCH);
    if (this.repositories.attempts.findLiveForVersion(ticket.id, ticket.version)) throw DeskError.conflict(ErrorMessage.ALREADY_DISPATCHED);
  }

  #assertReply(body) {
    if (typeof body !== 'string' || !body.trim()) throw DeskError.badRequest(ErrorMessage.REPLY_REQUIRED);
    if (!isNonEmptyText(body, this.limits.maxMessageLength)) throw DeskError.badRequest(ErrorMessage.REPLY_TOO_LONG);
  }
}
