import { AppConfig } from './config/config.mjs';
import { Database as DatabaseConstant } from './config/constants.mjs';
import { NextActionAdvisor } from './domain/next-action-advisor.mjs';
import { OutcomeClassifier } from './domain/outcome-classifier.mjs';
import { ReconcileResolver } from './domain/reconcile-resolver.mjs';
import { SendPolicy } from './domain/send-policy.mjs';
import { SqlitePersistenceFactory } from './infrastructure/persistence-factory.mjs';
import { DeliveryDispatcher } from './application/delivery-dispatcher.mjs';
import { DeliveryReconciler } from './application/delivery-reconciler.mjs';
import { DraftWorkflow } from './application/draft-workflow.mjs';
import { InboundWebhookHandler } from './application/inbound-webhook-handler.mjs';
import { StartupRecovery } from './application/startup-recovery.mjs';
import { TicketAccess } from './application/support.mjs';
import { TicketQuery } from './application/ticket-query.mjs';
import { OperationsQuery } from './application/operations-query.mjs';
import { ReconciliationSweeper } from './application/reconciliation-sweeper.mjs';
import { Logger } from './infrastructure/logger.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms).unref?.());

export { DeskError } from './domain/errors.mjs';

export class DeskService {
  #inFlight = new Set();

  constructor({ databasePath = DatabaseConstant.MEMORY, provider, config = AppConfig.get(), persistenceFactory, logger = Logger.get(), clock, random } = {}) {
    const factory = persistenceFactory ?? new SqlitePersistenceFactory({
      databasePath, busyTimeoutMs: config.database.busyTimeoutMs, security: config.security
    });
    this.db = factory.createDatabase();
    const repositories = factory.createRepositories(this.db);
    const access = new TicketAccess(repositories.tickets);
    this.limits = config.limits;
    const shared = { db: this.db, repositories, access, limits: config.limits };
    this.query = new TicketQuery({ repositories, access, advisor: new NextActionAdvisor() });
    this.inbound = new InboundWebhookHandler(shared);
    this.drafts = new DraftWorkflow(shared);
    this.dispatcher = new DeliveryDispatcher({ ...shared, provider, policy: new SendPolicy(), classifier: new OutcomeClassifier() });
    this.reconciler = new DeliveryReconciler({ ...shared, provider, resolver: new ReconcileResolver() });
    this.recoveredAttempts = new StartupRecovery(shared).run();
    this.sweeper = new ReconciliationSweeper({ repositories, reconciler: this.reconciler, settings: config.reconciler, logger, clock, random });
    this.operations = new OperationsQuery({ db: this.db, sweeper: this.sweeper });
  }

  startBackgroundJobs() { this.sweeper.start(); }

  stopBackgroundJobs() { this.sweeper.stop(); }

  health() { return this.operations.health(); }

  metrics(actor) { return this.operations.metrics(actor); }

  async drain(graceMs) {
    this.stopBackgroundJobs();
    await Promise.race([Promise.allSettled([...this.#inFlight, this.sweeper.whenIdle()]), sleep(graceMs)]);
    return this.#inFlight.size;
  }

  #track(work) {
    this.#inFlight.add(work);
    work.finally(() => this.#inFlight.delete(work)).catch(() => {});
    return work;
  }

  close() {
    this.stopBackgroundJobs();
    this.db.close();
  }

  listTickets(actor) { return this.query.list(actor); }

  getTicket(actor, id) { return this.query.get(actor, id); }

  receiveWebhook(event) { return this.inbound.handle(event); }

  updateDraft(actor, id, body) {
    this.drafts.updateDraft(actor, id, body);
    return this.getTicket(actor, id);
  }

  approveDraft(actor, id, reviewedVersion) {
    this.drafts.approve(actor, id, reviewedVersion);
    return this.getTicket(actor, id);
  }

  handoff(actor, id) {
    this.drafts.handoff(actor, id);
    return this.getTicket(actor, id);
  }

  async sendReply(actor, id, options = {}) {
    await this.#track(this.dispatcher.dispatch(actor, id, options));
    return this.getTicket(actor, id);
  }

  markUndelivered(actor, id, reason) {
    this.reconciler.markUndelivered(actor, id, reason, this.limits.maxMessageLength);
    return this.getTicket(actor, id);
  }

  async reconcile(actor, id) {
    await this.#track(this.reconciler.reconcile(actor, id));
    return this.getTicket(actor, id);
  }
}
