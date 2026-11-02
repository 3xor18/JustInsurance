import { resolve } from 'node:path';
import { FIXTURE_DEV_DATA_PASSPHRASE, FIXTURE_IDENTITIES, FIXTURE_WEBHOOK_SECRET } from './fixtures.mjs';

const DEFAULTS = Object.freeze({
  HOST: '127.0.0.1',
  PORT: 4300,
  PROVIDER_URL: 'http://127.0.0.1:4301',
  PROVIDER_TIMEOUT_MS: 5000,
  DATABASE_FILE: 'data/desk.sqlite',
  BUSY_TIMEOUT_MS: 3000,
  MAX_BODY_BYTES: 100000,
  MAX_MESSAGE_LENGTH: 5000,
  MAX_EVENT_ID_LENGTH: 200
});

const toNumber = (value, fallback) => (value === undefined || value === '' ? fallback : Number(value));

const build = env => Object.freeze({
  server: Object.freeze({
    host: env.HOST || DEFAULTS.HOST,
    port: toNumber(env.PORT, DEFAULTS.PORT),
    maxBodyBytes: toNumber(env.DESK_MAX_BODY_BYTES, DEFAULTS.MAX_BODY_BYTES)
  }),
  database: Object.freeze({
    path: env.DESK_DB || resolve(DEFAULTS.DATABASE_FILE),
    busyTimeoutMs: toNumber(env.DESK_BUSY_TIMEOUT_MS, DEFAULTS.BUSY_TIMEOUT_MS)
  }),
  provider: Object.freeze({
    baseUrl: env.PROVIDER_URL || DEFAULTS.PROVIDER_URL,
    timeoutMs: toNumber(env.PROVIDER_TIMEOUT_MS, DEFAULTS.PROVIDER_TIMEOUT_MS)
  }),
  security: Object.freeze({
    webhookSecret: env.DESK_WEBHOOK_SECRET || FIXTURE_WEBHOOK_SECRET,
    dataKey: env.DESK_DATA_KEY || '',
    devPassphrase: FIXTURE_DEV_DATA_PASSPHRASE,
    identities: FIXTURE_IDENTITIES
  }),
  limits: Object.freeze({
    maxMessageLength: toNumber(env.DESK_MAX_MESSAGE_LENGTH, DEFAULTS.MAX_MESSAGE_LENGTH),
    maxEventIdLength: toNumber(env.DESK_MAX_EVENT_ID_LENGTH, DEFAULTS.MAX_EVENT_ID_LENGTH)
  })
});

export class AppConfig {
  static #instance;

  static get() {
    AppConfig.#instance ??= build(process.env);
    return AppConfig.#instance;
  }

  static from(env) {
    return build(env);
  }
}
