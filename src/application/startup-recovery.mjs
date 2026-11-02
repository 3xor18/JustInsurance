import { AuditAction, AuditDetail, DeliveryState, SystemActor } from '../config/constants.mjs';
import { describe } from './support.mjs';

export class StartupRecovery {
  constructor({ db, repositories }) {
    this.db = db;
    this.repositories = repositories;
  }

  run() {
    return this.db.transaction(() => this.repositories.attempts.listByState(DeliveryState.PENDING).filter(a => this.#markUnknown(a)).length);
  }

  #markUnknown(attempt) {
    const { attempts, tickets, audit } = this.repositories;
    if (!attempts.transition(attempt.id, DeliveryState.PENDING, DeliveryState.UNKNOWN)) return false;
    tickets.setSendStateIfVersion(attempt.ticket_id, attempt.version, DeliveryState.UNKNOWN);
    audit.record(attempt.ticket_id, AuditAction.RECOVERED_AFTER_RESTART, SystemActor.RECOVERY, describe(
      AuditDetail.CLIENT_REF + attempt.client_ref, AuditDetail.FROM_STATE + DeliveryState.PENDING
    ));
    return true;
  }
}
