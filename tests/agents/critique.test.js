// The Reviewer's LLM critique (agents/reviewer/critique.js, Phase 11 step 4) with a scripted model: the
// text summary it reads (no code), deterministic checks first, the answer, and the /api/lines route.
import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import { lineSummary, critiqueSchema, createCritic } from '../../agents/reviewer/critique.js';
import { checkStrict } from '../../agents/strict.js';
import { parseFactory } from '../../spec/factory.schema.js';
import { compileFactory, lineFolder } from '../../compiler/emit.js';
import { writeCompiled } from '../../compiler/write.js';
import { projectLineStore } from '../../server/lineStore.js';
import { createLinesService } from '../../server/linesApi.js';
import { createEditor } from '../../agents/editor/editor.js';

const bottling = JSON.parse(readFileSync('spec/examples/bottling-line.factory.json', 'utf8'));
const def = critiqueSchema();
const answer = (o) => def.encode({ verdict: 'concerns', summary: 'It works; packing is slow.', issues: [], ...o });
const scripted = (outputs) => {
  const calls = [];
  return { calls, call: async (req) => { calls.push(req); return { output: outputs.shift(), cost: 0.002, source: 'mock', key: 'k' }; } };
};

describe('the critique', () => {
  it('the summary: line, timing, each station (machines, work), flow, KPIs and warnings, as text; no code', () => {
    const s = lineSummary(registry, bottling, { kpis: { runSize: 10, throughputPerHour: 205.4, taktAchieved: 9.75, leadTime: { mean: 68.7 }, wip: { mean: 4.9 }, rejects: { count: 2 }, utilisation: { pack: 0.6 } }, findings: [{ severity: 'warning', check: 'placeholder', message: 'x is a placeholder' }] });
    expect(s).toMatch(/^LINE Juice bottling \(generic level\) \(bottlingLine\), run of 10 units, product: parametric bottle, every 4th unit fails inspection/);
    expect(s).toMatch(/\nTIMING line cycle 10\.48 s \(344 units\/h\); bottleneck station pack/);
    expect(s).toContain('- C Capping (cap): cycle 9.6 s; machines belt:beltConveyor, capper:composite; 7 ops; work: Chuck down to the neck → Cap placed');
    expect(s).toContain('extra port reject');
    expect(s).toContain('FLOW fill.output → cap.input (buffer 3); cap.output → inspect.input');
    expect(s).toContain('SIMULATION run of 10: 205 good units/h');
    expect(s).toContain('CHECK WARNINGS placeholder: x is a placeholder');
    expect(s).not.toMatch(/import |function|=>|THREE/);
    expect(checkStrict(def.schema)).toEqual([]);
  });

  it('asks only after the deterministic checks pass; the brief and the summary in the prompt; a station it named wrong becomes the whole line', async () => {
    const llm = scripted([answer({ issues: [{ severity: 'high', station: 'pack', issue: 'Packing is the bottleneck at 10.5 s against a 12 s takt', request: 'make Case packing 2 s faster' }, { severity: 'low', station: 'labelling', issue: 'no labelling station', request: null }] })]);
    const brief = { title: 'Juice', product: { name: 'Juice 1 L' }, targetPerHour: 300, steps: [{ name: 'Fill', does: 'fill' }], quality: 'camera', constraints: [] };
    const r = await createCritic({ registry, llm }).critique({ factory: bottling, brief });
    expect(r).toMatchObject({ ok: true, verdict: 'concerns', cost: 0.002 });
    expect(r.issues).toEqual([
      { severity: 'high', station: 'pack', issue: 'Packing is the bottleneck at 10.5 s against a 12 s takt', request: 'make Case packing 2 s faster' },
      { severity: 'low', station: null, issue: 'no labelling station' },
    ]);
    const [req] = llm.calls;
    expect(req).toMatchObject({ agent: 'reviewer', schemaName: 'lineCritique' });
    expect(req.messages[0].content).toMatch(/^You are the Reviewer/);
    expect(req.messages[1].content).toMatch(/^CRITIQUE\n\nBRIEF\n\{"title":"Juice","product":"Juice 1 L","targetPerHour":300/);
    expect(req.messages[1].content).toContain('\n\nLINE SUMMARY\nLINE Juice bottling');

    // A line with errors: no model call.
    const broken = structuredClone(bottling);
    broken.stations[0].equipment[0].type = 'teleporter';
    const llm2 = scripted([]);
    const skipped = await createCritic({ registry, llm: llm2 }).critique({ factory: broken });
    expect(skipped).toMatchObject({ ok: false, cost: 0, skipped: expect.stringMatching(/deterministic checks have errors/) });
    expect(llm2.calls).toHaveLength(0);
  });

  it('POST /api/lines/<id>/critique: kept with the line, against its brief and KPIs when there; stale once the line changes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'critique-'));
    mkdirSync(join(root, 'spec', 'examples'), { recursive: true });
    copyFileSync('spec/examples/bottling-line.factory.json', join(root, 'spec', 'examples', 'bottling-line.factory.json'));
    const store = projectLineStore({ root, registry, parseFactory, compileFactory, writeCompiled });
    store.create('juice', bottling, { by: 'owner', message: 'copied' });
    mkdirSync(join(root, 'sdd', 'juice'), { recursive: true });
    writeFileSync(join(root, 'sdd', 'juice', 'brief.json'), JSON.stringify({ title: 'Juice', targetPerHour: 300, steps: [] }));
    const llm = scripted([answer({ verdict: 'fits', summary: 'Fine.' })]);
    const svc = createLinesService({ root, llm: () => llm, load: async () => ({ registry, createEditor, createCritic, lineStore: store, lineFolder }) });
    expect((await svc.handle({ method: 'GET', path: '/juice' })).body.critique).toBe(null);
    let r = await svc.handle({ method: 'POST', path: '/juice/critique', body: {} });
    expect(r.body.critique).toMatchObject({ ok: true, verdict: 'fits', version: 1, withBrief: true, withKpis: false, stale: false });
    expect(r.body.critique.lineSummary).toBeUndefined();
    store.save('juice', { ...store.load('juice').factory, line: { ...store.load('juice').factory.line, runSize: 12 } }, { by: 'owner', message: 'run 12' });
    r = await svc.handle({ method: 'GET', path: '/juice' });
    expect(r.body.critique.stale).toBe(true);
  }, 60000);
});
