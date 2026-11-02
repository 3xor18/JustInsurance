import { HttpMethod, RoutePath, TicketAction } from '../config/constants.mjs';
import { DeskError } from '../domain/errors.mjs';

const TICKET_COMMANDS = Object.freeze({
  [TicketAction.DRAFT]: (service, actor, id, body) => service.updateDraft(actor, id, body.body),
  [TicketAction.APPROVE]: (service, actor, id, body) => service.approveDraft(actor, id, body.version),
  [TicketAction.HANDOFF]: (service, actor, id) => service.handoff(actor, id),
  [TicketAction.SEND]: (service, actor, id) => service.sendReply(actor, id),
  [TicketAction.AUTOMATION]: (service, actor, id) => service.sendReply(actor, id, { automatic: true }),
  [TicketAction.RECONCILE]: (service, actor, id) => service.reconcile(actor, id),
  [TicketAction.MARK_UNDELIVERED]: (service, actor, id, body) => service.markUndelivered(actor, id, body.reason)
});

export class Router {
  constructor({ service, actors, webhookVerifier, readBody, homePage }) {
    this.service = service;
    this.actors = actors;
    this.webhookVerifier = webhookVerifier;
    this.readBody = readBody;
    this.homePage = homePage;
  }

  async handle(request, url) {
    if (url.pathname === RoutePath.HOME && request.method === HttpMethod.GET) return { html: this.homePage() };
    if (url.pathname === RoutePath.WEBHOOK && request.method === HttpMethod.POST) return this.#webhook(request);
    return this.#authenticated(request, url, this.actors.resolve(request.headers));
  }

  async #webhook(request) {
    this.webhookVerifier.verify(request.headers);
    return { json: this.service.receiveWebhook(await this.readBody(request)) };
  }

  async #authenticated(request, url, actor) {
    if (url.pathname === RoutePath.TICKETS) return this.#onlyGet(request, () => this.service.listTickets(actor));
    const view = url.pathname.match(RoutePath.TICKET);
    if (view) return this.#onlyGet(request, () => this.service.getTicket(actor, Number(view[1])));
    const action = url.pathname.match(RoutePath.TICKET_ACTION);
    if (!action) throw DeskError.notFound();
    if (request.method !== HttpMethod.POST) throw DeskError.methodNotAllowed();
    const body = await this.readBody(request);
    return { json: await TICKET_COMMANDS[action[2]](this.service, actor, Number(action[1]), body) };
  }

  #onlyGet(request, query) {
    if (request.method !== HttpMethod.GET) throw DeskError.methodNotAllowed();
    return { json: query() };
  }
}
