import { randomUUID } from 'node:crypto';
import { AuditAction, AuditDetail, DeliveryState, DispatchOrigin, ErrorMessage, HttpStatus, SystemActor } from '../config/constants.mjs';
import { DeskError } from '../domain/errors.mjs';
import { isUniqueViolation } from '../infrastructure/database.mjs';
import { describe } from './support.mjs';

const originOf = automatic => (automatic ? DispatchOrigin.AUTOMATION : DispatchOrigin.MANUAL);
const actorLabel = (actor, automatic) => (automatic ? SystemActor.AUTOMATION : actor.id);

export class DeliveryDispatcher {
  constructor({ db, repositories, access, provider, policy, classifier }) {
    this.db = db;
    this.repositories = repositories;
    this.access = access;
    this.provider = provider;
    this.policy = policy;
    this.classifier = classifier;
  }

  async dispatch(actor, id, { automatic = false } = {}) {
    const attempt = this.#reserveOrAudit(actor, id, automatic);
    const outcome = await this.#deliver(attempt);
    this.#settle(attempt, outcome, actorLabel(actor, automatic));
  }

  #reserveOrAudit(actor, id, automatic) {
    try {
      return this.db.transaction(() => this.#reserve(actor, id, automatic));
    } catch (error) {
      if (error.status === HttpStatus.CONFLICT) this.#recordRefusal(actor, id, automatic, error.message);
      throw error;
    }
  }

  #reserve(actor, id, automatic) {
    const ticket = this.access.require(actor, id);
    const { attempts, tickets, audit } = this.repositories;
    this.policy.assertSatisfied({
      ticket,
      automatic,
      unresolvedAttempt: attempts.findUnresolved(id),
      liveAttemptForVersion: attempts.findLiveForVersion(id, ticket.version)
    });
    const attempt = this.#insertAttempt({
      ticketId: id, version: ticket.version, clientRef: randomUUID(), body: ticket.draft,
      origin: originOf(automatic), actor: actorLabel(actor, automatic)
    });
    tickets.setSendState(id, DeliveryState.PENDING);
    audit.record(id, AuditAction.DISPATCH_RESERVED, attempt.actor, describe(
      AuditDetail.ORIGIN + attempt.origin, AuditDetail.VERSION + attempt.version, AuditDetail.CLIENT_REF + attempt.client_ref
    ));
    return attempt;
  }

  #insertAttempt(fields) {
    try {
      return this.repositories.attempts.reserve(fields);
    } catch (error) {
      if (isUniqueViolation(error)) throw DeskError.conflict(ErrorMessage.ALREADY_DISPATCHED);
      throw error;
    }
  }

  async #deliver(attempt) {
    try {
      const result = await this.provider.send({ clientRef: attempt.client_ref, ticketId: attempt.ticket_id, body: attempt.body });
      return this.classifier.fromAccepted(result);
    } catch (error) {
      return this.classifier.fromError(error);
    }
  }

  #settle(attempt, outcome, actor) {
    this.db.transaction(() => {
      const { attempts, tickets, audit } = this.repositories;
      const detail = describe(AuditDetail.CLIENT_REF + attempt.client_ref, outcome.providerId && AuditDetail.PROVIDER_ID + outcome.providerId);
      if (!attempts.transition(attempt.id, DeliveryState.PENDING, outcome.state, outcome.providerId)) {
        audit.record(attempt.ticket_id, AuditAction.SETTLEMENT_SKIPPED, actor, detail);
        return;
      }
      tickets.setSendStateIfVersion(attempt.ticket_id, attempt.version, outcome.state);
      audit.record(attempt.ticket_id, outcome.auditAction, actor, detail);
    });
  }

  #recordRefusal(actor, id, automatic, reason) {
    this.db.transaction(() => this.repositories.audit.record(
      id, AuditAction.DISPATCH_REFUSED, actorLabel(actor, automatic),
      describe(AuditDetail.ORIGIN + originOf(automatic), AuditDetail.REASON + reason)
    ));
  }
}
