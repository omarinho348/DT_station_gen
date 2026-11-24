#!/usr/bin/env node
// Step 8.6: a Builder run against the real model, one planned station through the three gates
// (layout → machines → process, each auto-approved here), then its answers recorded as mock fixtures
// (agents/fixtures/responses/) so tests and the panel replay them for $0.
//
//   node scripts/builder-live.mjs [agents/fixtures/jobs/juice-fill.json] [--station <plan id>] [--no-record]
//
// LIVE: this spends money. Every call goes through the LLM layer (budget guard, ledger, cache): a call
// already answered (in the cache or the fixtures) is free, so running it again costs $0. The key stays
// in .env; this script only overrides LLM_MODE for its own run (never writes .env).
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, loadEnv } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const jobFile = args.find((a) => !a.startsWith('--') && a.endsWith('.json')) ?? 'agents/fixtures/jobs/juice-fill.json';
const stationId = args.includes('--station') ? args[args.indexOf('--station') + 1] : null;
const recordIt = !args.includes('--no-record');

const spec = JSON.parse(readFileSync(resolve(ROOT, jobFile), 'utf8'));
const planItem = stationId ? spec.plan.find((p) => p.id === stationId) : spec.plan[0];
if (!planItem) throw new Error(`no plan item "${stationId}" in ${jobFile}`);

const server = await createServer({
  root: ROOT, logLevel: 'error', appType: 'custom', cacheDir: 'node_modules/.vite-compile',
  server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true, entries: [] },
});
try {
  const { registry } = await server.ssrLoadModule('/lib/components/index.js');
  const { preloadComponentAssets } = await server.ssrLoadModule('/lib/core/assets.js');
  await server.ssrLoadModule('/lib/products/index.js');
  await server.ssrLoadModule('/lib/ops/index.js');
  await preloadComponentAssets(registry);
  const { createBuilder } = await server.ssrLoadModule('/agents/builder/builder.js');
  const { createLlm, estimateTokens } = await server.ssrLoadModule('/agents/llm.js');

  const llm = createLlm({ env: { ...loadEnv('development', ROOT, ''), LLM_MODE: 'live' }, root: ROOT });
  console.log(`live: ${llm.config.models.default.name}, effort ${llm.config.effort}, max output ${llm.config.maxOutputTokens}; budget left $${llm.status().remaining.total.toFixed(4)} total, $${llm.status().remaining.session.toFixed(4)} this run`);

  // Every call, with my conservative estimate of its prompt beside what was billed.
  const calls = [];
  const watched = {
    async call(req) {
      const estimate = estimateTokens(req.messages.map((m) => m.content).join('\n')) + estimateTokens(JSON.stringify(req.schema));
      const started = Date.now();
      const r = await llm.call(req);
      calls.push({ schemaName: req.schemaName, source: r.source, key: r.key, usage: r.usage ?? null, cost: r.cost, estimate, seconds: (Date.now() - started) / 1000 });
      return r;
    },
  };

  const builder = createBuilder({ registry, llm: watched, root: ROOT });
  const job = { line: spec.line, product: spec.product, stations: [], plan: planItem };
  const build = builder.newBuild();
  let last = null;
  for (const phase of ['layout', 'machines', 'process']) {
    last = await builder.advance(job, build, { stopAfter: phase });
    console.log(`\n${phase} gate: ${last.ok ? 'passed' : 'FAILED'}${last.attempts.length ? `, ${last.attempts.length} refusal(s) so far` : ''}`);
    for (const a of last.attempts) console.log(`  refused (${a.phase}): ${a.problems.join(' | ')}`);
    if (!last.ok) break;
  }

  console.log('\ncalls:');
  for (const c of calls) {
    const u = c.usage;
    console.log(`  ${c.schemaName.padEnd(16)} ${c.source.padEnd(5)} ${u ? `in ${u.inputTokens} (cached ${u.cachedInputTokens}) out ${u.outputTokens}` : 'from cache/fixture'} · estimated in ${c.estimate} · $${c.cost.toFixed(5)} · ${c.seconds.toFixed(1)} s`);
  }
  const total = calls.reduce((s, c) => s + c.cost, 0);
  console.log(`total $${total.toFixed(5)}; budget left $${llm.status().remaining.total.toFixed(4)}`);

  if (last?.station) {
    const s = last.station;
    console.log(`\nstation "${s.id}" (${s.title}): ${s.equipment.map((e) => `${e.id}:${e.type}@[${e.position.map((v) => v.toFixed(2)).join(',')}]`).join('  ')}`);
    console.log(`process: ${s.process.map((o) => `${o.op}${o.label ? ` "${o.label}"` : ''}`).join(' → ') || '(none)'}`);
    for (const f of last.findings ?? []) if (f.severity !== 'info' || f.check === 'play') console.log(`  ${f.severity} ${f.check}: ${f.message}`);
    const draft = builder.writeDraft(last.factory, { rev: 'live' });
    console.log(`draft: ${draft.url}`);
  }

  if (recordIt) {
    const keys = [...new Set(calls.filter((c) => c.source === 'live' || c.source === 'cache').map((c) => c.key))];
    for (const k of keys) llm.record(k);
    console.log(`\nrecorded ${keys.length} answer(s) into agents/fixtures/responses/`);
  }
} finally {
  await server.close();
}
