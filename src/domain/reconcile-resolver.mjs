import { AuditAction, AuditDetail, DeliveryState, LookupState } from '../config/constants.mjs';

const resolution = (resolved, auditAction, reason, providerId = null, count = 0) =>
  Object.freeze({ resolved, auditAction, reason, providerId, count, state: resolved ? DeliveryState.SENT : null });

const LOOKUP_STRATEGIES = Object.freeze({
  [LookupState.DELIVERED]: evidence =>
    resolution(true, AuditAction.DELIVERY_CONFIRMED, LookupState.DELIVERED, evidence.providerMessageId, evidence.count),
  [LookupState.NOT_FOUND]: () =>
    resolution(false, AuditAction.RECONCILE_INCONCLUSIVE, AuditDetail.LOOKUP_NOT_FOUND)
});

const INCONCLUSIVE = () => resolution(false, AuditAction.RECONCILE_INCONCLUSIVE, AuditDetail.LOOKUP_ERROR);

export class ReconcileResolver {
  fromEvidence(evidence) {
    const strategy = LOOKUP_STRATEGIES[evidence?.state];
    return strategy && (evidence.state !== LookupState.DELIVERED || evidence.providerMessageId)
      ? strategy(evidence)
      : INCONCLUSIVE();
  }

  fromLookupFailure() {
    return INCONCLUSIVE();
  }
}
