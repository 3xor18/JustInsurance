import { AuditAction, DeliveryState, ProviderErrorKind } from '../config/constants.mjs';

const outcome = (state, auditAction, providerId = null) => Object.freeze({ state, auditAction, providerId });

const ERROR_STRATEGIES = Object.freeze({
  [ProviderErrorKind.NOT_ACCEPTED]: () => outcome(DeliveryState.FAILED, AuditAction.DELIVERY_FAILED)
});

const UNKNOWN_STRATEGY = () => outcome(DeliveryState.UNKNOWN, AuditAction.DELIVERY_UNKNOWN);

export class OutcomeClassifier {
  fromAccepted(result) {
    return result?.providerMessageId
      ? outcome(DeliveryState.SENT, AuditAction.SENT, result.providerMessageId)
      : UNKNOWN_STRATEGY();
  }

  fromError(error) {
    return (ERROR_STRATEGIES[error?.kind] ?? UNKNOWN_STRATEGY)();
  }
}
