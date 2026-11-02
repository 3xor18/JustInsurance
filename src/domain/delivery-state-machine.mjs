import { DeliveryState, ErrorMessage } from '../config/constants.mjs';

const TRANSITIONS = Object.freeze({
  [DeliveryState.PENDING]: Object.freeze([DeliveryState.SENT, DeliveryState.UNKNOWN, DeliveryState.FAILED]),
  [DeliveryState.UNKNOWN]: Object.freeze([DeliveryState.SENT, DeliveryState.FAILED]),
  [DeliveryState.SENT]: Object.freeze([]),
  [DeliveryState.FAILED]: Object.freeze([])
});

export class DeliveryStateMachine {
  canTransition(from, to) {
    return (TRANSITIONS[from] ?? []).includes(to);
  }

  assertTransition(from, to) {
    if (!this.canTransition(from, to)) throw new Error(`${ErrorMessage.ILLEGAL_TRANSITION}: ${from} -> ${to}`);
  }

  isTerminal(state) {
    return (TRANSITIONS[state] ?? []).length === 0;
  }
}
