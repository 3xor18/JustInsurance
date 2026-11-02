import { LogLevel } from '../config/constants.mjs';

const STREAMS = Object.freeze({
  [LogLevel.INFO]: process.stdout,
  [LogLevel.WARN]: process.stderr,
  [LogLevel.ERROR]: process.stderr
});

export class Logger {
  static #instance;

  static get() {
    Logger.#instance ??= new Logger();
    return Logger.#instance;
  }

  #write(level, event, fields) {
    STREAMS[level].write(`${JSON.stringify({ time: new Date().toISOString(), level, event, ...fields })}\n`);
  }

  info(event, fields = {}) { this.#write(LogLevel.INFO, event, fields); }

  warn(event, fields = {}) { this.#write(LogLevel.WARN, event, fields); }

  error(event, fields = {}) { this.#write(LogLevel.ERROR, event, fields); }
}
