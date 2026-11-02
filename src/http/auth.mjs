import { createHash, timingSafeEqual } from 'node:crypto';
import { ErrorMessage, HeaderValue, HttpHeader } from '../config/constants.mjs';
import { DeskError } from '../domain/errors.mjs';

const HASH = 'sha256';
const digest = value => createHash(HASH).update(String(value ?? '')).digest();

export const constantTimeEquals = (left, right) => timingSafeEqual(digest(left), digest(right));

export class ActorResolver {
  constructor(identities) {
    this.identities = identities;
  }

  resolve(headers) {
    const token = String(headers[HttpHeader.AUTHORIZATION] ?? '').replace(HeaderValue.BEARER_PREFIX, '');
    const actor = Object.hasOwn(this.identities, token) ? this.identities[token] : undefined;
    if (!actor) throw DeskError.unauthorized(ErrorMessage.SIGN_IN_REQUIRED);
    return actor;
  }
}

export class WebhookVerifier {
  constructor(secret) {
    this.secret = secret;
  }

  verify(headers) {
    if (!constantTimeEquals(headers[HttpHeader.WEBHOOK_SECRET], this.secret)) {
      throw DeskError.unauthorized(ErrorMessage.INVALID_WEBHOOK_SECRET);
    }
  }
}
