// The first live Spec run (step 9.5), replayed in mock mode from its recorded answers
// (agents/fixtures/responses/, recorded by scripts/spec-live.mjs on gpt-5.4-nano): the juice-bottling
// template through the same session the setup page uses. Only the model's answers come from the
// recording. If the catalog, the Spec prompt, its schemas or the template change, the cache keys change
// and this fails with a mock-mode error: re-record with `node scripts/spec-live.mjs` (about $0.005).
import { describe, it, expect } from 'vitest';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import { createSpec } from '../../agents/spec/spec.js';
import { createSpecSession } from '../../agents/spec/session.js';
import { createLlm } from '../../agents/llm.js';
import { readTemplates } from '../../server/specApi.js';

const env = { LLM_MODE: 'mock', LLM_MODEL_DEFAULT: 'gpt-5.4-nano', LLM_REASONING_EFFORT: 'low', LLM_MAX_OUTPUT_TOKENS: '4000' };

describe('the recorded live Spec run (juice-bottling template)', () => {
  it('replays for $0: a brief with three open questions (one refusal fixed), a four-station plan within the takt, the Builder\'s job', async () => {
    const llm = createLlm({ env, root: process.cwd(), session: 'test' });
    const s = createSpecSession({ spec: createSpec({ registry, llm }) });
    const template = readTemplates(process.cwd()).find((t) => t.name === 'juice-bottling');
    let v = await s.message(template.text, 'template');
    expect(v.docs.brief).toMatchObject({ status: 'draft', retries: 1 });
    expect(v.questions.map((q) => q.topic)).toEqual(['throughput', 'quality', 'product']);
    expect(v.line).toMatchObject({ id: 'appleJuiceBottling', targetPerHour: 240, takt: 15 });
    await s.approve('constitution');
    v = await s.approve('brief');
    expect(v.docs.plan).toMatchObject({ status: 'draft', retries: 0 });
    v = await s.approve('plan');
    expect(v.ready).toBe(true);
    expect(v.job.plan.map((p) => p.id)).toEqual(['filling', 'capping', 'labeling', 'inspectionAndReject']);
    expect(v.job.plan.every((p) => p.seconds <= 15)).toBe(true);
    expect(v.job.line.transport.type).toBe('beltConveyor');
    expect(llm.status().calls).toEqual({ live: 0, cached: 0, mock: 3, refused: 0 });
  });
});
