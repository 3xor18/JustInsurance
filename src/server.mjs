import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AppConfig } from './config/config.mjs';
import { ErrorMessage, HttpStatus, LogEvent } from './config/constants.mjs';
import { isDeskError } from './domain/errors.mjs';
import { ActorResolver, WebhookVerifier } from './http/auth.mjs';
import { readJson, sendJson, sendPage } from './http/http-io.mjs';
import { Router } from './http/router.mjs';
import { Logger } from './infrastructure/logger.mjs';
import { ProviderClient } from './provider-client.mjs';
import { DeskService } from './service.mjs';

const HOME_PAGE_URL = new URL('../public/index.html', import.meta.url);
const LOCAL_ORIGIN = 'http://localhost';
const SHUTDOWN_SIGNALS = Object.freeze(['SIGTERM', 'SIGINT']);
const ETAG_HASH = 'sha256';
const ETAG_ENCODING = 'base64url';

const loadPage = () => {
  const body = readFileSync(fileURLToPath(HOME_PAGE_URL));
  return Object.freeze({ body, etag: `"${createHash(ETAG_HASH).update(body).digest(ETAG_ENCODING)}"` });
};

export function createApp({ config = AppConfig.get(), service, logger = Logger.get() } = {}) {
  const router = new Router({
    service,
    actors: new ActorResolver(config.security.identities),
    webhookVerifier: new WebhookVerifier(config.security.webhookSecret),
    readBody: request => readJson(request, config.server.maxBodyBytes),
    homePage: loadPage()
  });
  return createServer(async (request, response) => {
    const requestId = randomUUID();
    try {
      const result = await router.handle(request, new URL(request.url, LOCAL_ORIGIN));
      return result.page ? sendPage(request, response, result.page, requestId) : sendJson(response, HttpStatus.OK, result.json, requestId);
    } catch (error) {
      if (isDeskError(error)) return sendJson(response, error.status, { error: error.message }, requestId);
      logger.error(LogEvent.REQUEST_FAILED, { requestId, method: request.method, path: request.url, message: error.message, stack: error.stack });
      return sendJson(response, HttpStatus.INTERNAL_ERROR, { error: ErrorMessage.UNEXPECTED, requestId }, requestId);
    }
  });
}

export async function shutdown({ server, service, config, logger }) {
  server.close();
  const pending = await service.drain(config.shutdown.graceMs);
  server.closeAllConnections();
  service.close();
  logger.info(LogEvent.SHUTDOWN, { unfinishedDispatches: pending });
}

export function start(config = AppConfig.get(), logger = Logger.get()) {
  const service = new DeskService({ databasePath: config.database.path, provider: new ProviderClient(config.provider.baseUrl, config.provider), config, logger });
  const server = createApp({ config, service, logger });
  if (service.recoveredAttempts) logger.warn(LogEvent.RECOVERY, { recoveredAttempts: service.recoveredAttempts });
  server.listen(config.server.port, config.server.host, () => logger.info(LogEvent.LISTENING, { url: `http://${config.server.host}:${config.server.port}` }));
  service.startBackgroundJobs();
  const stop = () => shutdown({ server, service, config, logger }).finally(() => process.exit());
  SHUTDOWN_SIGNALS.forEach(signal => process.once(signal, stop));
  return { server, service };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) start();
