import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database as DatabaseConstant, ErrorMessage } from '../config/constants.mjs';
import { Pragma, Transaction } from './sql.mjs';

const isPromise = value => typeof value?.then === 'function';

export class Database {
  #connection;
  #statements = new Map();
  #depth = 0;

  constructor(path, { busyTimeoutMs }) {
    if (path !== DatabaseConstant.MEMORY) mkdirSync(dirname(path), { recursive: true });
    this.#connection = new DatabaseSync(path);
    this.#connection.exec(Pragma.setup(busyTimeoutMs));
  }

  exec(sql) {
    this.#connection.exec(sql);
  }

  statement(sql) {
    if (!this.#statements.has(sql)) this.#statements.set(sql, this.#connection.prepare(sql));
    return this.#statements.get(sql);
  }

  get(sql, ...params) { return this.statement(sql).get(...params); }

  all(sql, ...params) { return this.statement(sql).all(...params); }

  run(sql, ...params) { return this.statement(sql).run(...params); }

  transaction(work) {
    if (this.#depth > 0) return this.#nested(work);
    this.#connection.exec(Transaction.BEGIN);
    this.#depth += 1;
    try {
      const result = this.#nested(work);
      this.#connection.exec(Transaction.COMMIT);
      return result;
    } catch (error) {
      this.#connection.exec(Transaction.ROLLBACK);
      throw error;
    } finally {
      this.#depth -= 1;
    }
  }

  #nested(work) {
    const result = work();
    if (isPromise(result)) throw new Error(ErrorMessage.ASYNC_TRANSACTION);
    return result;
  }

  close() {
    this.#statements.clear();
    this.#connection.close();
  }
}

export const isUniqueViolation = error => String(error?.message).includes(DatabaseConstant.UNIQUE_MARKER);
