import { DeliveryState, LogEvent, SystemActor } from '../config/constants.mjs';

const EMPTY_RUN = Object.freeze({ checked: 0, resolved: 0 });
const BACKOFF_BASE = 2;

export class ReconciliationSweeper {
  #timer = null;
  #running = false;
  #stopped = true;
  #schedule = new Map();
  #lastRun = null;
  #current = Promise.resolve(EMPTY_RUN);

  constructor({ repositories, reconciler, settings, logger, clock = Date.now, random = Math.random }) {
    this.repositories = repositories;
    this.reconciler = reconciler;
    this.settings = settings;
    this.logger = logger;
    this.clock = clock;
    this.random = random;
  }

  get enabled() {
    return this.settings.intervalMs > 0;
  }

  start() {
    if (!this.enabled || !this.#stopped) return;
    this.#stopped = false;
    this.#arm();
  }

  stop() {
    this.#stopped = true;
    clearTimeout(this.#timer);
    this.#timer = null;
  }

  whenIdle() {
    return this.#current;
  }

  status() {
    return { enabled: this.enabled, running: !this.#stopped, tracked: this.#schedule.size, lastRun: this.#lastRun };
  }

  async runOnce() {
    if (this.#running) return EMPTY_RUN;
    this.#running = true;
    try {
      const due = this.repositories.attempts.listByState(DeliveryState.UNKNOWN).filter(attempt => this.#isDue(attempt));
      const outcomes = [];
      for (const attempt of due) outcomes.push(await this.#check(attempt));
      this.#lastRun = { at: new Date(this.clock()).toISOString(), checked: due.length, resolved: outcomes.filter(Boolean).length };
      return this.#lastRun;
    } finally {
      this.#running = false;
    }
  }

  #arm() {
    this.#timer = setTimeout(() => this.#tick(), this.settings.intervalMs);
    this.#timer.unref?.();
  }

  async #tick() {
    try {
      this.#current = this.runOnce();
      const run = await this.#current;
      if (run.checked) this.logger.info(LogEvent.SWEEP, run);
    } catch (error) {
      this.logger.error(LogEvent.SWEEP_FAILED, { message: error.message });
    }
    if (!this.#stopped) this.#arm();
  }

  #isDue(attempt) {
    return (this.#schedule.get(attempt.id)?.nextAt ?? 0) <= this.clock();
  }

  async #check(attempt) {
    const resolution = await this.reconciler.reconcileAttempt(attempt, SystemActor.RECONCILER, { auditInconclusive: false });
    if (resolution.resolved) {
      this.#schedule.delete(attempt.id);
      return true;
    }
    const failures = (this.#schedule.get(attempt.id)?.failures ?? 0) + 1;
    this.#schedule.set(attempt.id, { failures, nextAt: this.clock() + this.#backoff(failures) });
    return false;
  }

  #backoff(failures) {
    const capped = Math.min(this.settings.intervalMs * BACKOFF_BASE ** failures, this.settings.maxBackoffMs);
    return capped + capped * this.settings.jitterRatio * this.random();
  }
}
