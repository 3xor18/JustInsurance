import { ErrorMessage, Owner } from '../config/constants.mjs';
import { DeskError } from './errors.mjs';

const specification = (isSatisfiedBy, message) => Object.freeze({ isSatisfiedBy, message });

export const SEND_SPECIFICATIONS = Object.freeze([
  specification(({ ticket }) => Boolean(ticket.draft), ErrorMessage.NO_DRAFT),
  specification(({ ticket }) => ticket.approved_version != null, ErrorMessage.APPROVAL_REQUIRED),
  specification(({ ticket }) => ticket.approved_version === ticket.version, ErrorMessage.APPROVAL_STALE),
  specification(({ ticket, automatic }) => !(automatic && ticket.owner === Owner.HUMAN), ErrorMessage.TAKEOVER_BLOCKS_AUTOMATION),
  specification(({ unresolvedAttempt }) => !unresolvedAttempt, ErrorMessage.UNRESOLVED_DELIVERY),
  specification(({ liveAttemptForVersion }) => !liveAttemptForVersion, ErrorMessage.ALREADY_DISPATCHED)
]);

export class SendPolicy {
  constructor(specifications = SEND_SPECIFICATIONS) {
    this.specifications = specifications;
  }

  firstViolation(context) {
    return this.specifications.find(rule => !rule.isSatisfiedBy(context));
  }

  assertSatisfied(context) {
    const violation = this.firstViolation(context);
    if (violation) throw DeskError.conflict(violation.message);
  }
}
