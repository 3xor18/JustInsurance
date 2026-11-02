import { spawn } from 'node:child_process';
import { join } from 'node:path';

const POLL_INTERVAL_MS = 100;
const STARTUP_TIMEOUT_MS = 15000;
const NODE_FLAGS = Object.freeze(['--no-warnings']);

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export class ManagedProcess {
  constructor({ name, cwd, script, env, readyUrl }) {
    Object.assign(this, { name, cwd, script, env, readyUrl });
    this.child = null;
  }

  async start() {
    this.child = spawn(process.execPath, [...NODE_FLAGS, join(this.cwd, this.script)], {
      cwd: this.cwd, env: { ...process.env, ...this.env }, stdio: ['ignore', 'ignore', 'ignore']
    });
    await this.#waitUntilReady();
    return this;
  }

  async kill() {
    if (!this.child || this.child.exitCode !== null) return;
    const exited = new Promise(resolve => this.child.once('exit', resolve));
    this.child.kill('SIGKILL');
    await exited;
  }

  async restart(extraEnv = {}) {
    await this.kill();
    this.env = { ...this.env, ...extraEnv };
    return this.start();
  }

  async #waitUntilReady() {
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await fetch(this.readyUrl).then(() => true, () => false)) return;
      await sleep(POLL_INTERVAL_MS);
    }
    throw new Error(`${this.name} did not start`);
  }
}
