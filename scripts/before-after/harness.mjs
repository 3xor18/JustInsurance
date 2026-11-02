import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ManagedProcess } from './process-control.mjs';
import { SCENARIOS } from './scenarios.mjs';

const LOOPBACK = 'http://127.0.0.1:';
const PROVIDER_TIMEOUT_MS = '2000';

export async function runBattery({ appDir, providerDir = appDir, appPort, providerPort, label }) {
  const dataDir = mkdtempSync(join(tmpdir(), `desk-${label}-`));
  const appUrl = LOOPBACK + appPort;
  const providerUrl = LOOPBACK + providerPort;
  const provider = new ManagedProcess({
    name: 'provider', cwd: resolve(providerDir), script: 'src/mock-provider.mjs', readyUrl: providerUrl + '/deliveries',
    env: { PROVIDER_PORT: String(providerPort), PROVIDER_DB: join(dataDir, 'provider.sqlite') }
  });
  const app = new ManagedProcess({
    name: 'app', cwd: resolve(appDir), script: 'src/server.mjs', readyUrl: appUrl + '/',
    env: { PORT: String(appPort), DESK_DB: join(dataDir, 'desk.sqlite'), PROVIDER_URL: providerUrl, PROVIDER_TIMEOUT_MS }
  });
  const json = async response => ({ status: response.status, body: await response.json().catch(() => null) });
  const ctx = {
    api: (auth, method, path, body) => fetch(appUrl + path, {
      method, headers: { 'Content-Type': 'application/json', Authorization: auth }, body: body === undefined ? undefined : JSON.stringify(body)
    }).then(json),
    webhook: (event, secret) => fetch(appUrl + '/webhooks/ghl', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Demo-Webhook-Secret': secret }, body: JSON.stringify(event)
    }).then(json),
    mode: mode => fetch(providerUrl + '/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) }),
    deliveries: () => fetch(providerUrl + '/deliveries').then(r => r.json()).then(rows => rows.length),
    restartApp: () => app.restart()
  };
  await provider.start();
  await app.start();
  const results = [];
  try {
    for (const scenario of SCENARIOS) results.push(await runScenario(scenario, ctx));
  } finally {
    await app.kill();
    await provider.kill();
    rmSync(dataDir, { recursive: true, force: true });
  }
  return { label, appDir: resolve(appDir), results };
}

async function runScenario(scenario, ctx) {
  try {
    const observed = await scenario.run(ctx);
    return { id: scenario.id, requirement: scenario.requirement, title: scenario.title, observed, passed: Boolean(scenario.expect(observed)) };
  } catch (error) {
    return { id: scenario.id, requirement: scenario.requirement, title: scenario.title, observed: { error: error.message }, passed: false };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'))) {
  const [appDir, label, outFile, appPort, providerPort] = process.argv.slice(2);
  const report = await runBattery({ appDir, label, appPort: Number(appPort), providerPort: Number(providerPort) });
  writeFileSync(outFile, JSON.stringify(report, null, 2));
}
