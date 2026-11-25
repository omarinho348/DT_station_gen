#!/usr/bin/env node
// Step 11.5: the Reviewer's critique against the real model, on the line, brief and SimPy KPIs of a job
// file; the answer recorded as a mock fixture, the KPIs written back into the job (so the replay sends
// the same prompt).
//
//   node scripts/critic-live.mjs [agents/fixtures/jobs/critic-bottling.json] [--no-record]
//
// LIVE: this spends money (budget guard, ledger, cache; a rerun is free). Writes nothing to lines/.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, loadEnv } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const jobFile = resolve(ROOT, args.find((a) => a.endsWith('.json')) ?? 'agents/fixtures/jobs/critic-bottling.json');
const recordIt = !args.includes('--no-record');
const job = JSON.parse(readFileSync(jobFile, 'utf8'));

const factory = (() => {
  const f = JSON.parse(readFileSync(join(ROOT, 'spec', 'examples', `${job.example}.factory.json`), 'utf8'));
  delete f.$schema;
  return JSON.parse(JSON.stringify({ ...structuredClone(f), line: { ...f.line, id: job.id } }));
})();

const server = await createServer({
  root: ROOT, logLevel: 'error', appType: 'custom', cacheDir: 'node_modules/.vite-compile',
  server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true, entries: [] },
});
try {
  const { registry } = await server.ssrLoadModule('/lib/components/index.js');
  await server.ssrLoadModule('/lib/products/index.js');
  await server.ssrLoadModule('/lib/ops/index.js');
  const { writeModel, runModel } = await server.ssrLoadModule('/server/simpyRun.js');
  const { createCritic } = await server.ssrLoadModule('/agents/reviewer/critique.js');
  const { createLlm } = await server.ssrLoadModule('/agents/llm.js');

  if (!job.kpis) {
    const { dir } = writeModel({ root: mkdtempSync(join(tmpdir(), 'critic-')), registry, factory });
    job.kpis = (await runModel(dir)).kpis;
    writeFileSync(jobFile, `${JSON.stringify(job, null, 2)}\n`);
    console.log(`SimPy KPIs written into ${jobFile}`);
  }

  const llm = createLlm({ env: { ...loadEnv('development', ROOT, ''), LLM_MODE: 'live' }, root: ROOT });
  console.log(`live: ${llm.config.models.default.name}; budget left $${llm.status().remaining.total.toFixed(4)}`);
  let key = null;
  let usage = null;
  const watched = { call: async (req) => { const r = await llm.call(req); key = r.key; usage = r.usage ?? null; return r; } };
  const r = await createCritic({ registry, llm: watched }).critique({ factory, brief: job.brief, kpis: job.kpis });
  console.log(`\nline summary sent:\n${r.lineSummary}\n`);
  console.log(`verdict: ${r.verdict}\n${r.summary}`);
  for (const i of r.issues) console.log(`- [${i.severity}] ${i.station ?? '(line)'}: ${i.issue}${i.request ? `\n    request: ${i.request}` : ''}`);
  console.log(`\ncost $${r.cost.toFixed(5)}${usage ? ` (in ${usage.inputTokens}, cached ${usage.cachedInputTokens}, out ${usage.outputTokens})` : ' (cache)'}; budget left $${llm.status().remaining.total.toFixed(4)}`);
  if (recordIt && key) { llm.record(key); console.log('recorded 1 answer into agents/fixtures/responses/'); }
} finally {
  await server.close();
}
