import { AuditAction, AuditDetail, DeliveryState, ErrorMessage, UNRESOLVED_STATES } from '../config/constants.mjs';
import { DeskError } from '../domain/errors.mjs';
import { describe, isNonEmptyText } from './support.mjs';

const MULTIPLE_DELIVERIES = 1;

export class DeliveryReconciler {
  constructor({ db, repositories, access, provider, resolver }) {
    this.db = db;
    this.repositories = repositories;
    this.access = access;
    this.provider = provider;
    this.resolver = resolver;
  }

  async reconcile(actor, id) {
    const attempt = this.db.transaction(() => this.#requireUnresolved(actor, id));
    const resolution = await this.#lookup(attempt);
    this.db.transaction(() => this.#apply(actor, attempt, resolution));
  }

  markUndelivered(actor, id, reason, maxReasonLength) {
    if (!isNonEmptyText(reason, maxReasonLength)) throw DeskError.badRequest(ErrorMessage.REASON_REQUIRED);
    this.db.transaction(() => {
      const attempt = this.#requireUnresolved(actor, id);
      if (attempt.state !== DeliveryState.UNKNOWN) throw DeskError.conflict(ErrorMessage.ONLY_UNKNOWN_CAN_BE_MARKED);
      this.repositories.attempts.transition(attempt.id, DeliveryState.UNKNOWN, DeliveryState.FAILED);
      this.repositories.tickets.setSendStateIfVersion(attempt.ticket_id, attempt.version, DeliveryState.FAILED);
      this.repositories.audit.record(attempt.ticket_id, AuditAction.MARKED_UNDELIVERED, actor.id, describe(
        AuditDetail.CLIENT_REF + attempt.client_ref, AuditDetail.REASON + reason
      ));
    });
  }

  #requireUnresolved(actor, id) {
    this.access.require(actor, id);
    const attempt = this.repositories.attempts.findUnresolved(id);
    if (!attempt) throw DeskError.conflict(ErrorMessage.NOTHING_TO_RECONCILE);
    return attempt;
  }

  async #lookup(attempt) {
    try {
      return this.resolver.fromEvidence(await this.provider.lookup(attempt.client_ref));
    } catch {
      return this.resolver.fromLookupFailure();
    }
  }

  #apply(actor, attempt, resolution) {
    const { attempts, audit } = this.repositories;
    const current = attempts.findById(attempt.id);
    const base = describe(AuditDetail.CLIENT_REF + attempt.client_ref, AuditDetail.FROM_STATE + current.state);
    if (!resolution.resolved || !UNRESOLVED_STATES.includes(current.state)) {
      audit.record(attempt.ticket_id, AuditAction.RECONCILE_INCONCLUSIVE, actor.id, describe(base, AuditDetail.REASON + resolution.reason));
      return;
    }
    attempts.transition(current.id, current.state, DeliveryState.SENT, resolution.providerId);
    this.repositories.tickets.setSendStateIfVersion(current.ticket_id, current.version, DeliveryState.SENT);
    audit.record(current.ticket_id, resolution.auditAction, actor.id, describe(
      base, AuditDetail.PROVIDER_ID + resolution.providerId, AuditDetail.COUNT + resolution.count
    ));
    if (resolution.count > MULTIPLE_DELIVERIES) {
      audit.record(current.ticket_id, AuditAction.DUPLICATE_DELIVERY_DETECTED, actor.id, describe(base, AuditDetail.COUNT + resolution.count));
    }
  }
}
