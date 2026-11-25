// The first live critique (step 11.5), replayed in mock mode from its recorded answer: the bottling copy,
// the SimPy KPIs and the brief kept in agents/fixtures/jobs/critic-bottling.json. If the catalog, the
// critic's prompt or schema, the summary or the example change, the key changes and this fails with a
// mock-mode error: re-record with `node scripts/critic-live.mjs` (about $0.002).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import { createCritic } from '../../agents/reviewer/critique.js';
import { createLlm } from '../../agents/llm.js';

const job = JSON.parse(readFileSync('agents/fixtures/jobs/critic-bottling.json', 'utf8'));
const env = { LLM_MODE: 'mock', LLM_MODEL_DEFAULT: 'gpt-5.4-nano', LLM_REASONING_EFFORT: 'low', LLM_MAX_OUTPUT_TOKENS: '4000' };

function copyOf(example, id) {
  const factory = JSON.parse(readFileSync(`spec/examples/${example}.factory.json`, 'utf8'));
  delete factory.$schema;
  return JSON.parse(JSON.stringify({ ...structuredClone(factory), line: { ...factory.line, id } }));
}

describe('the recorded live critique (bottling copy against a brief asking for more)', () => {
  it('replays for $0: concerns; the placeholders, the rate against 300/h and the missing Label station are all named', async () => {
    const llm = createLlm({ env, root: process.cwd(), session: 'test' });
    const r = await createCritic({ registry, llm }).critique({ factory: copyOf(job.example, job.id), brief: job.brief, kpis: job.kpis });
    expect(r).toMatchObject({ ok: true, verdict: 'concerns', cost: 0 });
    const text = r.issues.map((i) => i.issue).join(' ');
    expect(text).toMatch(/placeholder/i);
    expect(text).toMatch(/300/);
    expect(text).toMatch(/Label/);
    expect(r.issues.some((i) => i.severity === 'high')).toBe(true);
    expect(llm.status().calls).toEqual({ live: 0, cached: 0, mock: 1, refused: 0 });
  });
});
