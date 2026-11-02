import { DeliveryState, HealthStatus, METRIC_AUDIT_ACTIONS } from '../config/constants.mjs';
import { MetricsSql, UNRESOLVED_PARAMS } from '../infrastructure/sql.mjs';

const MS_PER_SECOND = 1000;
const ZERO_BY_STATE = Object.freeze(Object.fromEntries(Object.values(DeliveryState).map(state => [state, 0])));
const ZERO_BY_ACTION = Object.freeze(Object.fromEntries(METRIC_AUDIT_ACTIONS.map(action => [action, 0])));
const countsBy = (rows, key, zero) => ({ ...zero, ...Object.fromEntries(rows.map(row => [row[key], row.count])) });

export class OperationsQuery {
  constructor({ db, sweeper, startedAt = Date.now() }) {
    this.db = db;
    this.sweeper = sweeper;
    this.startedAt = startedAt;
  }

  health() {
    const database = this.#ping();
    return {
      status: database ? HealthStatus.OK : HealthStatus.DEGRADED,
      database,
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / MS_PER_SECOND),
      reconciler: this.sweeper.status()
    };
  }

  metrics(actor) {
    const oldest = this.db.get(MetricsSql.oldestUnresolvedSeconds, actor.tenantId, ...UNRESOLVED_PARAMS);
    return {
      tenantId: actor.tenantId,
      attemptsByState: countsBy(this.db.all(MetricsSql.attemptsByState, actor.tenantId), 'state', ZERO_BY_STATE),
      oldestUnresolvedSeconds: oldest?.seconds ?? null,
      auditEvents: countsBy(this.db.all(MetricsSql.auditCounts(METRIC_AUDIT_ACTIONS), actor.tenantId, ...METRIC_AUDIT_ACTIONS), 'action', ZERO_BY_ACTION),
      reconciler: this.sweeper.status()
    };
  }

  #ping() {
    try {
      return Boolean(this.db.get(MetricsSql.ping)?.ok);
    } catch {
      return false;
    }
  }
}
