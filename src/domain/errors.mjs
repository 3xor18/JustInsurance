import { ErrorMessage, HttpStatus } from '../config/constants.mjs';

export class DeskError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }

  static badRequest(message) { return new DeskError(HttpStatus.BAD_REQUEST, message); }

  static unauthorized(message) { return new DeskError(HttpStatus.UNAUTHORIZED, message); }

  static notFound(message = ErrorMessage.NOT_FOUND) { return new DeskError(HttpStatus.NOT_FOUND, message); }

  static conflict(message) { return new DeskError(HttpStatus.CONFLICT, message); }

  static methodNotAllowed() { return new DeskError(HttpStatus.METHOD_NOT_ALLOWED, ErrorMessage.METHOD_NOT_ALLOWED); }

  static payloadTooLarge() { return new DeskError(HttpStatus.PAYLOAD_TOO_LARGE, ErrorMessage.BODY_TOO_LARGE); }
}

export const isDeskError = error => error instanceof DeskError;
