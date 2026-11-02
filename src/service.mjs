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

export { DeskError } from './domain/errors.mjs';

export class DeskService {
  constructor({ databasePath = DatabaseConstant.MEMORY, provider, config = AppConfig.get(), persistenceFactory } = {}) {
    const factory = persistenceFactory ?? new SqlitePersistenceFactory({
      databasePath, busyTimeoutMs: config.database.busyTimeoutMs, security: config.security
    });
    this.db = factory.createDatabase();
    const repositories = factory.createRepositories(this.db);
    const access = new TicketAccess(repositories.tickets);
    const shared = { db: this.db, repositories, access, limits: config.limits };
    this.query = new TicketQuery({ repositories, access, advisor: new NextActionAdvisor() });
    this.inbound = new InboundWebhookHandler(shared);
    this.drafts = new DraftWorkflow(shared);
    this.dispatcher = new DeliveryDispatcher({ ...shared, provider, policy: new SendPolicy(), classifier: new OutcomeClassifier() });
    this.reconciler = new DeliveryReconciler({ ...shared, provider, resolver: new ReconcileResolver() });
    this.recoveredAttempts = new StartupRecovery(shared).run();
  }

  close() { this.db.close(); }

  listTickets(actor) { return this.query.list(actor); }

  getTicket(actor, id) { return this.query.get(actor, id); }

  receiveWebhook(event) { return this.inbound.handle(event); }

  updateDraft(actor, id, body) {
    this.drafts.updateDraft(actor, id, body);
    return this.getTicket(actor, id);
  }

  approveDraft(actor, id) {
    this.drafts.approve(actor, id);
    return this.getTicket(actor, id);
  }

  handoff(actor, id) {
    this.drafts.handoff(actor, id);
    return this.getTicket(actor, id);
  }

  async sendReply(actor, id, options = {}) {
    await this.dispatcher.dispatch(actor, id, options);
    return this.getTicket(actor, id);
  }

  async reconcile(actor, id) {
    await this.reconciler.reconcile(actor, id);
    return this.getTicket(actor, id);
  }
}
