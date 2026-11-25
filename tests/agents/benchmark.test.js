// The benchmark runner (agents/benchmark.js, Phase 12 step 2) end to end with a scripted model: Spec
// (brief, plan), Builder (the bottling rehearsal's answers, by plan id), the whole-line review and play,
// a SimPy stand-in, the standard edit and the critique; and the summary metrics.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import { runBrief, summarize, stationKind, STANDARD_EDIT } from '../../agents/benchmark.js';
import { briefSchema, planSchema } from '../../agents/spec/schemas.js';
import { patchSchema } from '../../agents/editor/schemas.js';
import { critiqueSchema } from '../../agents/reviewer/critique.js';
import { loadRehearsal } from '../../agents/builder/rehearsal.js';

const bottling = JSON.parse(readFileSync('spec/examples/bottling-line.factory.json', 'utf8'));
const brief = {
  id: 'juiceBench', title: 'Juice bench line',
  product: { name: 'Juice', description: 'A glass bottle of juice.', model: { kind: 'parametric', params: bottling.product.params } },
  targetPerHour: 200, runSize: 6,
  steps: [{ name: 'Fill', does: 'fill' }, { name: 'Cap', does: 'cap' }, { name: 'Inspect', does: 'camera, rejects off' }, { name: 'Pack', does: 'pack' }],
  quality: 'A camera rejects bad bottles.', constraints: [], assumptions: [], questions: [],
};
const plan = {
  transport: 'beltConveyor',
  stations: [['fill', 'Filling', 'Fill'], ['cap', 'Capping', 'Cap'], ['inspect', 'Inspection', 'Inspect'], ['pack', 'Case packing', 'Pack']]
    .map(([id, title, step], i) => ({ id, code: `ST${i + 1}`, title, does: title, steps: ['in', title, 'out'], seconds: 15, covers: [step], machines: [] })),
  notes: [],
};

/** One model for every agent: the Spec and Editor / critic answers scripted, the Builder's from the rehearsal. */
function pipelineLlm({ editOps = true } = {}) {
  const rehearsal = loadRehearsal(registry, 'bottling', { root: process.cwd() });
  const calls = [];
  return {
    calls,
    async call(req) {
      calls.push(req.schemaName);
      if (req.schemaName.startsWith('station')) return { ...(await rehearsal.llm.call(req)), cost: 0.002 };
      const output = {
        factoryBrief: () => briefSchema(registry).encode(brief),
        linePlan: () => planSchema(registry).encode(plan),
        factoryPatch: () => patchSchema().encode(editOps
          ? { summary: 'Pack 10 % faster', ops: [{ op: 'replace', path: '/stations/3/process/0/seconds', valueJson: '3.6' }], questions: [] }
          : { summary: 'Unclear', ops: [], questions: ['Which station?'] }),
        lineCritique: () => critiqueSchema().encode({ verdict: 'concerns', summary: 'Placeholder packer.', issues: [{ severity: 'high', station: 'pack', issue: 'placeholder', request: null }] }),
      }[req.schemaName]();
      return { output, cost: 0.001, source: 'mock', key: req.schemaName };
    },
  };
}

describe('the benchmark runner', () => {
  it('runs a brief through every stage and records the metrics', async () => {
    const llm = pipelineLlm();
    let t = 0;
    const r = await runBrief({
      registry, llm, name: 'juice', text: '# Juice\nFill, cap, inspect, pack.',
      simpy: async () => ({ finished: true, steadyPerHour: 250, throughputPerHour: 180, taktAchieved: 14.4, rejects: { count: 1 } }),
      now: () => (t += 1000),
    });
    expect(r).toMatchObject({ name: 'juice', stage: 'done', ok: true, planned: 4, target: { perHour: 200, steps: 4 } });
    expect(r.stations.map((s) => [s.id, s.ok, s.refusals, s.kind])).toEqual([['fill', true, 0, 'composite'], ['cap', true, 0, 'composite'], ['inspect', true, 0, 'composite'], ['pack', true, 0, 'placeholder']]);
    expect(r.review).toMatchObject({ ok: true, errors: 0, plays: true });
    expect(r.simpy).toMatchObject({ steadyPerHour: 250, meetsTarget: true });
    expect(r.edit).toMatchObject({ ok: true, ops: 1, success: true });
    expect(r.critique).toMatchObject({ verdict: 'concerns' });
    expect(llm.calls).toEqual(['factoryBrief', 'linePlan', ...Array(4).fill(['stationLayout', 'stationMachines', 'stationProcess']).flat(), 'factoryPatch', 'lineCritique']);
    for (const [agent, v] of Object.entries({ spec: 0.002, builder: 0.024, editor: 0.001, reviewer: 0.001 })) expect(r.cost[agent], agent).toBeCloseTo(v, 9);
    expect(r.totalCost).toBeCloseTo(0.028, 9);
    expect(r.factory.stations).toHaveLength(4);
    expect(r.seconds).toBeGreaterThan(0);
  }, 180000);

  it('a refusal by the LLM layer ends the run where it happened, with the reason', async () => {
    const r = await runBrief({ registry, llm: { call: async () => { throw Object.assign(new Error('budget: this call could cost up to $0.0070'), { name: 'LlmError' }); } }, name: 'x', text: 'x' });
    expect(r).toMatchObject({ ok: false, stage: 'spec' });
    expect(r.reason).toMatch(/budget: this call could cost/);
  });

  it('stationKind and the summary', async () => {
    expect(stationKind({ equipment: [{ type: 'beltConveyor' }, { type: 'filler' }] })).toBe('named');
    expect(stationKind({ equipment: [{ type: 'beltConveyor' }, { type: 'composite' }] })).toBe('composite');
    expect(stationKind({ equipment: [{ type: 'composite' }, { type: 'genericMachine' }] })).toBe('placeholder');
    const s = summarize([
      { stage: 'done', planned: 2, stations: [{ ok: true, refusals: 0, kind: 'named' }, { ok: true, refusals: 2, kind: 'placeholder' }], review: { ok: true, plays: true }, simpy: { meetsTarget: true }, edit: { success: true }, critique: { verdict: 'fits' }, totalCost: 0.03, seconds: 40 },
      { stage: 'builder', planned: 3, stations: [{ ok: true, refusals: 0, kind: 'composite' }, { ok: false, refusals: 3, kind: 'named' }], totalCost: 0.05, seconds: 60 },
    ]);
    expect(s).toMatchObject({
      briefs: 2, linesComplete: 1, stationsPlanned: 5, stationsBuilt: 3, firstPassStations: 66.7,
      parts: { named: 33.3, composite: 33.3, placeholder: 33.3 }, reviewOk: 1, plays: 1, meetsTarget: 1, editSuccess: 100,
      verdicts: { fits: 1, concerns: 0, misfit: 0 }, secondsPerLine: 50,
    });
    expect(s.cost.total).toBeCloseTo(0.08, 9);
    expect(STANDARD_EDIT).toMatch(/slowest station/);
  });
});
