const freeze = Object.freeze;

export const Pragma = freeze({
  setup: busyTimeoutMs => `PRAGMA journal_mode = WAL; PRAGMA busy_timeout = ${Number(busyTimeoutMs)}; PRAGMA foreign_keys = ON;`,
  readVersion: 'PRAGMA user_version',
  writeVersion: version => `PRAGMA user_version = ${Number(version)}`,
  tableColumns: 'SELECT name FROM pragma_table_info(?)'
});

export const Transaction = freeze({ BEGIN: 'BEGIN IMMEDIATE', COMMIT: 'COMMIT', ROLLBACK: 'ROLLBACK' });

export const Schema = freeze({
  baseline: `
    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, contact TEXT NOT NULL,
      subject TEXT NOT NULL, owner TEXT NOT NULL DEFAULT 'automation',
      draft TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 0,
      approved_version INTEGER, send_state TEXT NOT NULL DEFAULT 'DRAFT'
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY, ticket_id INTEGER NOT NULL, event_id TEXT NOT NULL, body TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY, ticket_id INTEGER NOT NULL, action TEXT NOT NULL,
      detail TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS attempts (
      id INTEGER PRIMARY KEY, ticket_id INTEGER NOT NULL, version INTEGER NOT NULL,
      client_ref TEXT NOT NULL UNIQUE, body TEXT NOT NULL, state TEXT NOT NULL, provider_id TEXT,
      UNIQUE(ticket_id, version)
    );`,
  seedTicket: 'INSERT OR IGNORE INTO tickets(id, tenant_id, contact, subject) VALUES (?, ?, ?, ?)',
  addTicketApprovalColumns: `
    ALTER TABLE tickets ADD COLUMN approved_by TEXT;
    ALTER TABLE tickets ADD COLUMN approved_at TEXT;`,
  addMessageTimestamp: "ALTER TABLE messages ADD COLUMN created_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00'",
  addAuditActor: "ALTER TABLE audit ADD COLUMN actor TEXT NOT NULL DEFAULT ''",
  inboundEvents: `
    CREATE TABLE IF NOT EXISTS inbound_events (
      tenant_id TEXT NOT NULL, event_id TEXT NOT NULL, ticket_id INTEGER NOT NULL,
      received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, event_id)
    );
    INSERT OR IGNORE INTO inbound_events(tenant_id, event_id, ticket_id)
      SELECT t.tenant_id, m.event_id, m.ticket_id FROM messages m JOIN tickets t ON t.id = m.ticket_id;`,
  rebuildAttempts: `
    CREATE TABLE attempts_v2 (
      id INTEGER PRIMARY KEY, ticket_id INTEGER NOT NULL REFERENCES tickets(id), version INTEGER NOT NULL,
      client_ref TEXT NOT NULL UNIQUE, body TEXT NOT NULL, state TEXT NOT NULL, provider_id TEXT,
      origin TEXT NOT NULL DEFAULT 'manual', actor TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO attempts_v2(id, ticket_id, version, client_ref, body, state, provider_id)
      SELECT id, ticket_id, version, client_ref, body, state, provider_id FROM attempts;
    DROP TABLE attempts;
    ALTER TABLE attempts_v2 RENAME TO attempts;
    CREATE UNIQUE INDEX attempts_one_live_per_version ON attempts(ticket_id, version) WHERE state <> 'FAILED';
    CREATE UNIQUE INDEX attempts_one_unresolved_per_ticket ON attempts(ticket_id) WHERE state IN ('PENDING', 'UNKNOWN');
    CREATE INDEX attempts_by_state ON attempts(state);
    CREATE INDEX messages_by_ticket ON messages(ticket_id);
    CREATE INDEX audit_by_ticket ON audit(ticket_id);`
});

export const TicketSql = freeze({
  listForTenant: 'SELECT id, tenant_id, contact, subject, owner, send_state FROM tickets WHERE tenant_id = ? ORDER BY id',
  findForTenant: 'SELECT * FROM tickets WHERE id = ? AND tenant_id = ?',
  saveDraft: `UPDATE tickets SET draft = ?, version = version + 1, approved_version = NULL, approved_by = NULL,
    approved_at = NULL, send_state = ? WHERE id = ? AND tenant_id = ?`,
  approve: `UPDATE tickets SET approved_version = version, approved_by = ?, approved_at = CURRENT_TIMESTAMP,
    send_state = ? WHERE id = ? AND tenant_id = ? AND version = ?`,
  assignOwner: 'UPDATE tickets SET owner = ? WHERE id = ? AND tenant_id = ?',
  setSendState: 'UPDATE tickets SET send_state = ? WHERE id = ?',
  setSendStateIfVersion: 'UPDATE tickets SET send_state = ? WHERE id = ? AND version = ?'
});

export const MessageSql = freeze({
  insert: 'INSERT INTO messages(ticket_id, event_id, body, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
  listByTicket: 'SELECT id, ticket_id, event_id, body, created_at FROM messages WHERE ticket_id = ? ORDER BY id'
});

export const InboundEventSql = freeze({
  tryRecord: 'INSERT OR IGNORE INTO inbound_events(tenant_id, event_id, ticket_id) VALUES (?, ?, ?)'
});

export const AttemptSql = freeze({
  insert: `INSERT INTO attempts(ticket_id, version, client_ref, body, state, origin, actor)
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
  findById: 'SELECT * FROM attempts WHERE id = ?',
  findUnresolved: "SELECT * FROM attempts WHERE ticket_id = ? AND state IN ('PENDING', 'UNKNOWN') ORDER BY id DESC LIMIT 1",
  findLiveForVersion: "SELECT * FROM attempts WHERE ticket_id = ? AND version = ? AND state <> 'FAILED' LIMIT 1",
  listByTicket: 'SELECT * FROM attempts WHERE ticket_id = ? ORDER BY id',
  listByState: 'SELECT * FROM attempts WHERE state = ? ORDER BY id',
  transition: `UPDATE attempts SET state = ?, provider_id = COALESCE(?, provider_id), updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND state = ?`
});

export const AuditSql = freeze({
  insert: 'INSERT INTO audit(ticket_id, action, actor, detail) VALUES (?, ?, ?, ?)',
  listByTicket: 'SELECT id, ticket_id, action, actor, detail, created_at FROM audit WHERE ticket_id = ? ORDER BY id'
});
