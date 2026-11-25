#!/usr/bin/env node
// Step 10.5: the Editor agent against the real model. Each request of a job file is proposed on version 1
// of an example copied under a new id (the copy /api/lines/import makes), checked as the app checks it,
// and the answers recorded as mock fixtures (agents/fixtures/responses/) for $0 replay.
//
//   node scripts/editor-live.mjs [agents/fixtures/jobs/editor-bottling.json] [--no-record]
//
// LIVE: this spends money (budget guard, ledger, cache as always; a rerun of answered calls is free).
// Nothing is written to lines/ or generated/: proposals are shown, never applied here.
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, loadEnv } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const jobFile = args.find((a) => a.endsWith('.json')) ?? 'agents/fixtures/jobs/editor-bottling.json';
const recordIt = !args.includes('--no-record');
const job = JSON.parse(readFileSync(resolve(ROOT, jobFile), 'utf8'));

/** The copy /api/lines/import + the line store make (same keys, same order). */
export function copyOf(example, id) {
  const factory = JSON.parse(readFileSync(join(ROOT, 'spec', 'examples', `${example}.factory.json`), 'utf8'));
  delete factory.$schema;
  return JSON.parse(JSON.stringify({ ...structuredClone(factory), line: { ...factory.line, id } }));
}

const server = await createServer({
  root: ROOT, logLevel: 'error', appType: 'custom', cacheDir: 'node_modules/.vite-compile',
  server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true, entries: [] },
});
try {
  const { registry } = await server.ssrLoadModule('/lib/components/index.js');
  await server.ssrLoadModule('/lib/products/index.js');
  await server.ssrLoadModule('/lib/ops/index.js');
  const { createEditor } = await server.ssrLoadModule('/agents/editor/editor.js');
  const { createLlm, estimateTokens } = await server.ssrLoadModule('/agents/llm.js');
  const llm = createLlm({ env: { ...loadEnv('development', ROOT, ''), LLM_MODE: 'live' }, root: ROOT });
  console.log(`live: ${llm.config.models.default.name}, effort ${llm.config.effort}; budget left $${llm.status().remaining.total.toFixed(4)}`);

  const calls = [];
  const watched = {
    async call(req) {
      const estimate = estimateTokens(req.messages.map((m) => m.content).join('\n')) + estimateTokens(JSON.stringify(req.schema));
      const t0 = Date.now();
      const r = await llm.call(req);
      calls.push({ source: r.source, key: r.key, usage: r.usage ?? null, cost: r.cost, estimate, seconds: (Date.now() - t0) / 1000 });
      return r;
    },
  };
  const editor = createEditor({ registry, llm: watched });
  const factory = copyOf(job.example, job.id);
  for (const request of job.requests) {
    const before = calls.length;
    const r = await editor.propose({ factory, request });
    console.log(`\n"${request}"\n  ${r.ok ? 'ok' : 'FAILED'}: ${r.summary}${r.attempts.length ? ` (${r.attempts.length} refusal(s))` : ''}`);
    for (const a of r.attempts) console.log(`  refused: ${a.problems.join(' | ')}`);
    for (const q of r.questions) console.log(`  asks: ${q}`);
    for (const d of r.diff) console.log(`  ${d.op} ${d.label}: ${JSON.stringify(d.from)} → ${JSON.stringify(d.value)}`);
    for (const f of r.findings ?? []) if (f.check === 'play' || f.check === 'takt') console.log(`  ${f.check}: ${f.message}`);
    for (const c of calls.slice(before)) {
      const u = c.usage;
      console.log(`  call: ${c.source} ${u ? `in ${u.inputTokens} (cached ${u.cachedInputTokens}) out ${u.outputTokens}` : 'cache/fixture'} · estimated in ${c.estimate} · $${c.cost.toFixed(5)} · ${c.seconds.toFixed(1)} s`);
    }
  }
  console.log(`\ntotal $${calls.reduce((s, c) => s + c.cost, 0).toFixed(5)}; budget left $${llm.status().remaining.total.toFixed(4)}`);
  if (recordIt) {
    const keys = [...new Set(calls.filter((c) => c.source === 'live' || c.source === 'cache').map((c) => c.key))];
    for (const k of keys) llm.record(k);
    console.log(`recorded ${keys.length} answer(s) into agents/fixtures/responses/`);
  }
} finally {
  await server.close();
}
