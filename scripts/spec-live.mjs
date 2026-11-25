#!/usr/bin/env node
// Step 9.5: the Spec agent against the real model. A brief template goes through the same session the
// setup page uses (message → brief; approve → plan), its open questions left to the assumptions, then
// the answers are recorded as mock fixtures (agents/fixtures/responses/) so the setup page and tests
// replay them for $0.
//
//   node scripts/spec-live.mjs [juice-bottling] [--no-record] [--out <dir>]
//
// LIVE: this spends money. Every call goes through the LLM layer (budget guard, ledger, cache); a call
// already answered is free on a rerun. The key stays in .env; only LLM_MODE is overridden for this run.
// Nothing is written to sdd/ (documents there are the owner's approvals); the rendered documents go
// to --out (default .agent-cache/spec-live/<template>/).
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, loadEnv } from 'vite';
import { readTemplates } from '../server/specApi.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--out') ?? 'juice-bottling';
const recordIt = !args.includes('--no-record');
const out = resolve(ROOT, args.includes('--out') ? args[args.indexOf('--out') + 1] : join('.agent-cache', 'spec-live', name));

const template = readTemplates(ROOT).find((t) => t.name === name);
if (!template) throw new Error(`no template "${name}" (there are: ${readTemplates(ROOT).map((t) => t.name).join(', ')})`);

const server = await createServer({
  root: ROOT, logLevel: 'error', appType: 'custom', cacheDir: 'node_modules/.vite-compile',
  server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true, entries: [] },
});
try {
  const { registry } = await server.ssrLoadModule('/lib/components/index.js');
  await server.ssrLoadModule('/lib/products/index.js');
  await server.ssrLoadModule('/lib/ops/index.js');
  const { createSpec } = await server.ssrLoadModule('/agents/spec/spec.js');
  const { createSpecSession } = await server.ssrLoadModule('/agents/spec/session.js');
  const { createLlm, estimateTokens } = await server.ssrLoadModule('/agents/llm.js');

  const llm = createLlm({ env: { ...loadEnv('development', ROOT, ''), LLM_MODE: 'live' }, root: ROOT });
  const st = llm.status();
  console.log(`live: ${llm.config.models.default.name} (strong ${st.models.strongEnabled ? st.models.strong : 'off'}), effort ${llm.config.effort}; budget left $${st.remaining.total.toFixed(4)}`);

  const calls = [];
  const watched = {
    async call(req) {
      const estimate = estimateTokens(req.messages.map((m) => m.content).join('\n')) + estimateTokens(JSON.stringify(req.schema));
      const t0 = Date.now();
      const r = await llm.call(req);
      calls.push({ schemaName: req.schemaName, source: r.source, key: r.key, usage: r.usage ?? null, cost: r.cost, estimate, seconds: (Date.now() - t0) / 1000 });
      return r;
    },
  };

  const session = createSpecSession({ spec: createSpec({ registry, llm: watched }) });
  let v = await session.message(template.text, 'template');
  const b = v.docs.brief;
  console.log(`\nbrief: ${b.status}, ${b.retries} refusal(s)${b.problems.length ? `: ${b.problems.join(' | ')}` : ''}`);
  for (const q of v.questions) console.log(`  question (${q.topic}): ${q.question}  [${q.why}]`);
  if (b.status === 'draft') {
    await session.approve('constitution');
    v = await session.approve('brief'); // with its assumptions; open questions stay listed in the brief
    const p = v.docs.plan;
    console.log(`plan: ${p.status}, ${p.retries} refusal(s)${p.problems.length ? `: ${p.problems.join(' | ')}` : ''}`);
    if (p.status === 'draft') v = await session.approve('plan');
  }

  console.log('\ncalls:');
  for (const c of calls) {
    const u = c.usage;
    console.log(`  ${c.schemaName.padEnd(13)} ${c.source.padEnd(5)} ${u ? `in ${u.inputTokens} (cached ${u.cachedInputTokens}) out ${u.outputTokens}` : 'from cache/fixture'} · estimated in ${c.estimate} · $${c.cost.toFixed(5)} · ${c.seconds.toFixed(1)} s`);
  }
  console.log(`total $${calls.reduce((s, c) => s + c.cost, 0).toFixed(5)}; budget left $${llm.status().remaining.total.toFixed(4)}`);

  mkdirSync(out, { recursive: true });
  const docs = session.state().docs;
  for (const [file, d] of [['constitution.md', docs.constitution], ['factory-brief.md', docs.brief], ['plan.md', docs.plan]]) if (d.md) writeFileSync(join(out, file), d.md);
  if (docs.brief.data) writeFileSync(join(out, 'brief.json'), `${JSON.stringify(docs.brief.data, null, 2)}\n`);
  if (docs.plan.data) writeFileSync(join(out, 'plan.json'), `${JSON.stringify(docs.plan.data, null, 2)}\n`);
  if (v.job) writeFileSync(join(out, 'job.json'), `${JSON.stringify(v.job, null, 2)}\n`);
  console.log(`documents: ${out}`);

  if (recordIt) {
    const keys = [...new Set(calls.filter((c) => c.source === 'live' || c.source === 'cache').map((c) => c.key))];
    for (const k of keys) llm.record(k);
    console.log(`recorded ${keys.length} answer(s) into agents/fixtures/responses/`);
  }
} finally {
  await server.close();
}
