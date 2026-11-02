import { spawn } from 'node:child_process';

const SERVICES = Object.freeze(['src/mock-provider.mjs', 'src/server.mjs']);
const SIGNALS = Object.freeze(['SIGTERM', 'SIGINT']);
const STARTUP_GAP_MS = 500;

const children = [];
const launch = script => {
  const child = spawn(process.execPath, ['--no-warnings', script], { stdio: 'inherit', env: process.env });
  child.on('exit', code => { children.forEach(c => c.kill()); process.exit(code ?? 1); });
  children.push(child);
};

launch(SERVICES[0]);
setTimeout(() => launch(SERVICES[1]), STARTUP_GAP_MS);
SIGNALS.forEach(signal => process.on(signal, () => children.forEach(c => c.kill(signal))));
