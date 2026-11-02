import { DeliveryStateMachine } from '../domain/delivery-state-machine.mjs';
import { Database } from './database.mjs';
import { FieldCipher } from './field-cipher.mjs';
import { Migrator } from './migrations.mjs';
import {
  AttemptRepository, AuditRepository, InboundEventRepository, MessageRepository, TicketRepository
} from './repositories.mjs';

export class PersistenceFactory {
  createDatabase() { throw new TypeError(PersistenceFactory.name); }

  createRepositories() { throw new TypeError(PersistenceFactory.name); }
}

export class SqlitePersistenceFactory extends PersistenceFactory {
  constructor({ databasePath, busyTimeoutMs, security }) {
    super();
    this.databasePath = databasePath;
    this.busyTimeoutMs = busyTimeoutMs;
    this.security = security;
  }

  createDatabase() {
    const db = new Database(this.databasePath, { busyTimeoutMs: this.busyTimeoutMs });
    new Migrator(db).migrate();
    return db;
  }

  createRepositories(db) {
    const cipher = new FieldCipher(this.security);
    return Object.freeze({
      tickets: new TicketRepository(db, cipher),
      messages: new MessageRepository(db, cipher),
      inboundEvents: new InboundEventRepository(db),
      attempts: new AttemptRepository(db, cipher, new DeliveryStateMachine()),
      audit: new AuditRepository(db)
    });
  }
}
