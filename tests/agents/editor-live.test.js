// The first live Editor calls (step 10.5), replayed in mock mode from their recorded answers
// (agents/fixtures/responses/, recorded by scripts/editor-live.mjs on gpt-5.4-nano) on the same copy of
// the bottling line the app's "Copy to edit" makes. If the catalog, the Editor's prompt or schema, or
// the example change, the keys change and this fails with a mock-mode error: re-record (about $0.004).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import { createEditor } from '../../agents/editor/editor.js';
import { createLlm } from '../../agents/llm.js';

const job = JSON.parse(readFileSync('agents/fixtures/jobs/editor-bottling.json', 'utf8'));
const env = { LLM_MODE: 'mock', LLM_MODEL_DEFAULT: 'gpt-5.4-nano', LLM_REASONING_EFFORT: 'low', LLM_MAX_OUTPUT_TOKENS: '4000' };

/** The copy /api/lines/import + the line store make. */
function copyOf(example, id) {
  const factory = JSON.parse(readFileSync(`spec/examples/${example}.factory.json`, 'utf8'));
  delete factory.$schema;
  return JSON.parse(JSON.stringify({ ...structuredClone(factory), line: { ...factory.line, id } }));
}

describe('the recorded live Editor calls (bottling copy)', () => {
  it('replay for $0: a timing change, a rename, and questions for a vague request', async () => {
    const llm = createLlm({ env, root: process.cwd(), session: 'test' });
    const editor = createEditor({ registry, llm });
    const factory = copyOf(job.example, job.id);
    const [faster, rename, vague] = job.requests;

    let r = await editor.propose({ factory, request: faster });
    expect(r.ok).toBe(true);
    expect(r.diff.map((d) => [d.label, d.from, d.value])).toEqual([['stations › fill › process › [2] › seconds', 6, 5]]);

    r = await editor.propose({ factory, request: rename });
    expect(r.diff.map((d) => [d.label, d.value]).sort()).toEqual([['stations › inspect › code', 'V'], ['stations › inspect › title', 'Vision check']]);

    r = await editor.propose({ factory, request: vague });
    expect(r).toMatchObject({ ok: true, ops: [], diff: [] });
    expect(r.questions.length).toBeGreaterThan(0);
    expect(llm.status().calls).toEqual({ live: 0, cached: 0, mock: 3, refused: 0 });
  }, 120000);
});
