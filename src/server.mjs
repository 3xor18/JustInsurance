import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AppConfig } from './config/config.mjs';
import { ErrorMessage, HttpStatus, LogEvent } from './config/constants.mjs';
import { isDeskError } from './domain/errors.mjs';
import { ActorResolver, WebhookVerifier } from './http/auth.mjs';
import { readJson, sendHtml, sendJson } from './http/http-io.mjs';
import { Router } from './http/router.mjs';
import { Logger } from './infrastructure/logger.mjs';
import { ProviderClient } from './provider-client.mjs';
import { DeskService } from './service.mjs';

const HOME_PAGE_URL = new URL('../public/index.html', import.meta.url);
const LOCAL_ORIGIN = 'http://localhost';
const SHUTDOWN_SIGNALS = Object.freeze(['SIGTERM', 'SIGINT']);

export function createApp({ config = AppConfig.get(), service, logger = Logger.get() } = {}) {
  const homePage = () => readFileSync(fileURLToPath(HOME_PAGE_URL));
  const router = new Router({
    service,
    actors: new ActorResolver(config.security.identities),
    webhookVerifier: new WebhookVerifier(config.security.webhookSecret),
    readBody: request => readJson(request, config.server.maxBodyBytes),
    homePage
  });
  return createServer(async (request, response) => {
    const requestId = randomUUID();
    try {
      const result = await router.handle(request, new URL(request.url, LOCAL_ORIGIN));
      return result.html ? sendHtml(response, HttpStatus.OK, result.html, requestId) : sendJson(response, HttpStatus.OK, result.json, requestId);
    } catch (error) {
      if (isDeskError(error)) return sendJson(response, error.status, { error: error.message }, requestId);
      logger.error(LogEvent.REQUEST_FAILED, { requestId, method: request.method, path: request.url, message: error.message, stack: error.stack });
      return sendJson(response, HttpStatus.INTERNAL_ERROR, { error: ErrorMessage.UNEXPECTED, requestId }, requestId);
    }
  });
}

export function start(config = AppConfig.get(), logger = Logger.get()) {
  const service = new DeskService({ databasePath: config.database.path, provider: new ProviderClient(config.provider.baseUrl, config.provider), config });
  const server = createApp({ config, service, logger });
  if (service.recoveredAttempts) logger.warn(LogEvent.RECOVERY, { recoveredAttempts: service.recoveredAttempts });
  server.listen(config.server.port, config.server.host, () => logger.info(LogEvent.LISTENING, { url: `http://${config.server.host}:${config.server.port}` }));
  const shutdown = () => server.close(() => { service.close(); logger.info(LogEvent.SHUTDOWN); process.exit(); });
  SHUTDOWN_SIGNALS.forEach(signal => process.on(signal, shutdown));
  return { server, service };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) start();
