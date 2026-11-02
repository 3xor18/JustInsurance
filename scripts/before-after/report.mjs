const HTML_ESCAPES = Object.freeze({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' });
const escape = value => String(value).replace(/[&<>"']/g, char => HTML_ESCAPES[char]);
const verdict = passed => (passed ? '<b class="ok">PASS</b>' : '<b class="ko">FAIL</b>');

const fieldRows = (before, after) => {
  const keys = [...new Set([...Object.keys(before.observed), ...Object.keys(after.observed)])];
  return keys.map(key => {
    const left = JSON.stringify(before.observed[key]);
    const right = JSON.stringify(after.observed[key]);
    const changed = left !== right ? ' class="changed"' : '';
    return `<tr><td>${escape(key)}</td><td>${escape(left)}</td><td${changed}>${escape(right)}</td></tr>`;
  }).join('');
};

const scenarioBlock = (before, after) => `
<section><h3>${escape(before.id)} · ${escape(before.requirement)} · ${escape(before.title)}</h3>
<p>Before: ${verdict(before.passed)} &nbsp; After: ${verdict(after.passed)}</p>
<table><thead><tr><th>Observed</th><th>Before (baseline)</th><th>After (feature)</th></tr></thead><tbody>${fieldRows(before, after)}</tbody></table></section>`;

export function renderHtml({ before, after, tests, generatedAt, baselineRef, featureRef }) {
  const pairs = before.results.map((b, index) => [b, after.results[index]]);
  const summary = pairs.map(([b, a]) => `<tr><td>${escape(b.id)}</td><td>${escape(b.requirement)}</td><td>${escape(b.title)}</td><td>${verdict(b.passed)}</td><td>${verdict(a.passed)}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Before / After report</title>
<style>body{font:15px system-ui;max-width:1100px;margin:30px auto;padding:0 20px;color:#182231}table{border-collapse:collapse;width:100%;margin:6px 0 18px}td,th{border:1px solid #d5dae2;padding:5px 8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#f1f3f6}.changed{background:#fff59d}.ok{color:#15803d}.ko{color:#b91c1c}code{background:#f1f3f6;padding:1px 4px}</style>
<h1>Before / After report</h1>
<p>Generated ${escape(generatedAt)} · baseline <code>${escape(baselineRef)}</code> · feature <code>${escape(featureRef)}</code>. Same black-box battery, real mock provider, real HTTP server, real restarts, isolated databases per side. Cells in <span class="changed">yellow</span> changed between before and after.</p>
<h2>Requirement tests (node --test test/requirements.test.mjs)</h2>
<table><thead><tr><th></th><th>Pass</th><th>Fail</th></tr></thead><tbody>
<tr><td>Baseline</td><td>${tests.before.pass}</td><td>${tests.before.fail}</td></tr><tr><td>Feature</td><td>${tests.after.pass}</td><td>${tests.after.fail}</td></tr></tbody></table>
<h2>Scenario summary</h2><table><thead><tr><th>ID</th><th>Req</th><th>Scenario</th><th>Before</th><th>After</th></tr></thead><tbody>${summary}</tbody></table>
<h2>Scenario details</h2>${pairs.map(([b, a]) => scenarioBlock(b, a)).join('')}</html>`;
}

export function renderMarkdown({ before, after, tests }) {
  const mark = passed => (passed ? 'PASS' : 'FAIL');
  const rows = before.results.map((b, i) => `| ${b.id} | ${b.requirement} | ${b.title} | ${mark(b.passed)} | ${mark(after.results[i].passed)} |`);
  return ['# Before / After summary', '',
    `Requirement tests: baseline ${tests.before.pass} pass / ${tests.before.fail} fail · feature ${tests.after.pass} pass / ${tests.after.fail} fail`, '',
    '| ID | Req | Scenario | Before | After |', '|---|---|---|---|---|', ...rows, '',
    'Full detail with highlighted deltas: `docs/before-after/report.html`.', ''].join('\n');
}
