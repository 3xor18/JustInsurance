import { DeliveryState, NextAction } from '../config/constants.mjs';

const BY_STATE = Object.freeze({
  [DeliveryState.APPROVED]: NextAction.SEND,
  [DeliveryState.PENDING]: NextAction.WAIT_FOR_DISPATCH,
  [DeliveryState.UNKNOWN]: NextAction.CHECK_DELIVERY,
  [DeliveryState.FAILED]: NextAction.RETRY_SEND,
  [DeliveryState.SENT]: NextAction.NEW_REPLY
});

export class NextActionAdvisor {
  advise(ticket) {
    if (BY_STATE[ticket.send_state]) return BY_STATE[ticket.send_state];
    return ticket.draft ? NextAction.APPROVE : NextAction.WRITE_DRAFT;
  }
}
