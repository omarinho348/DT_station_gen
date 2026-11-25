// The first live Builder run (step 8.6), replayed in mock mode from its recorded answers
// (agents/fixtures/responses/, recorded by scripts/builder-live.mjs on gpt-5.4-nano; re-recorded in step
// 12.2 after the Builder's schemas changed). The real LLM
// layer, Builder, placer, reviewer and play: only the model's answers come from the recording.
// If the catalog, the Builder's prompt or its schemas change, the cache keys change and this fails with
// a mock-mode error: re-record with `node scripts/builder-live.mjs` (a live call, about $0.005).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import { createBuilder } from '../../agents/builder/builder.js';
import { createBuildSession } from '../../agents/builder/session.js';
import { createLlm } from '../../agents/llm.js';

const spec = JSON.parse(readFileSync('agents/fixtures/jobs/juice-fill.json', 'utf8'));
// The settings the recording was made with (.env at recording time); mock mode needs no key.
const env = { LLM_MODE: 'mock', LLM_MODEL_DEFAULT: 'gpt-5.4-nano', LLM_REASONING_EFFORT: 'low', LLM_MAX_OUTPUT_TOKENS: '4000' };

describe('the recorded live run (juice line, filling)', () => {
  it('replays through the three gates for $0: right first time, a catalog filler with its supply tank, the run played', async () => {
    const llm = createLlm({ env, root: process.cwd(), session: 'test' });
    const builder = createBuilder({ registry, llm });
    const s = createBuildSession({ builder, job: { line: spec.line, product: spec.product }, plan: spec.plan });
    const gates = [];
    while (!s.view().finished) {
      const v = await s.next();
      gates.push([v.gate.phase, v.gate.ok]);
      if (!v.gate.ok) break;
      s.approve();
    }
    expect(gates).toEqual([['layout', true], ['machines', true], ['process', true]]);
    expect(llm.status().calls).toEqual({ live: 0, cached: 0, mock: 3, refused: 0 });
    const station = s.factory().stations[0];
    expect(station.equipment.map((e) => e.type)).toEqual(['supplyTank', 'filler', 'dispenseNozzle']);
    expect(station.process.map((o) => o.op)).toEqual(['fill']);
    expect(s.view().log.filter((l) => l.action === 'draft').every((l) => l.retries === 0)).toBe(true);
  }, 60000);
});
