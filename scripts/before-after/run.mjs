import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runBattery } from './harness.mjs';
import { renderHtml, renderMarkdown } from './report.mjs';

const ROOT = resolve('.');
const OUT_DIR = join(ROOT, 'docs', 'before-after');
const TEST_FILES = Object.freeze(['test/helpers.mjs', 'test/requirements.test.mjs']);
const PORTS = Object.freeze({ before: [4410, 4411], after: [4420, 4421] });

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const baselineRef = process.env.BASELINE_REF || git('rev-list', '--max-parents=0', 'HEAD');
const featureRef = git('rev-parse', '--short', 'HEAD');

function countTests(cwd) {
  const run = spawnSync(process.execPath, ['--no-warnings', '--test', '--test-reporter=tap', 'test/requirements.test.mjs'], { cwd, encoding: 'utf8' });
  const read = name => Number((run.stdout.match(new RegExp(`^# ${name} (\\d+)`, 'm')) ?? [0, 0])[1]);
  return { pass: read('pass'), fail: read('fail') };
}

const worktree = join(mkdtempSync(join(tmpdir(), 'desk-baseline-')), 'baseline');
git('worktree', 'add', '--detach', worktree, baselineRef);
try {
  TEST_FILES.forEach(file => copyFileSync(join(ROOT, file), join(worktree, file)));
  const tests = { before: countTests(worktree), after: countTests(ROOT) };
  const before = await runBattery({ appDir: worktree, providerDir: ROOT, appPort: PORTS.before[0], providerPort: PORTS.before[1], label: 'before' });
  const after = await runBattery({ appDir: ROOT, appPort: PORTS.after[0], providerPort: PORTS.after[1], label: 'after' });
  const report = { generatedAt: new Date().toISOString(), baselineRef, featureRef, tests, before, after };
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'report.json'), JSON.stringify({ ...report, before: { ...before, appDir: 'baseline-worktree' }, after: { ...after, appDir: '.' } }, null, 2));
  writeFileSync(join(OUT_DIR, 'report.html'), renderHtml(report));
  writeFileSync(join(OUT_DIR, 'report.md'), renderMarkdown(report));
  const failedAfter = after.results.filter(r => !r.passed).map(r => r.id);
  process.stdout.write(`${renderMarkdown(report)}\n`);
  process.exitCode = failedAfter.length ? 1 : 0;
} finally {
  git('worktree', 'remove', '--force', worktree);
  rmSync(resolve(worktree, '..'), { recursive: true, force: true });
}
