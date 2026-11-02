import { FIXTURE_TICKETS } from '../config/fixtures.mjs';
import { Pragma, Schema } from './sql.mjs';

const seedFixtures = db => FIXTURE_TICKETS.forEach(t => db.run(Schema.seedTicket, t.id, t.tenantId, t.contact, t.subject));

export const MIGRATIONS = Object.freeze([
  Object.freeze({ version: 1, up: db => { db.exec(Schema.baseline); seedFixtures(db); } }),
  Object.freeze({ version: 2, up: db => db.exec(Schema.addTicketApprovalColumns) }),
  Object.freeze({ version: 3, up: db => { db.exec(Schema.addMessageTimestamp); db.exec(Schema.addAuditActor); } }),
  Object.freeze({ version: 4, up: db => db.exec(Schema.inboundEvents) }),
  Object.freeze({ version: 5, up: db => db.exec(Schema.rebuildAttempts) })
]);

export class Migrator {
  constructor(db, migrations = MIGRATIONS) {
    this.db = db;
    this.migrations = migrations;
  }

  currentVersion() {
    return Object.values(this.db.get(Pragma.readVersion))[0];
  }

  migrate() {
    const current = this.currentVersion();
    this.migrations.filter(m => m.version > current).forEach(m => this.#apply(m));
  }

  #apply(migration) {
    this.db.transaction(() => {
      migration.up(this.db);
      this.db.exec(Pragma.writeVersion(migration.version));
    });
  }
}
