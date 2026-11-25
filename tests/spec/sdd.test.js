// The SDD documents (Phase 9 step 1): the Spec agent's brief and plan schemas, the checks in code, the
// markdown templates and the plan as the Builder's job.
import { describe, it, expect } from 'vitest';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import { briefSchema, planSchema, briefProducts, transportTypes, QUESTION_TOPICS } from '../../agents/spec/schemas.js';
import { checkStrict } from '../../agents/strict.js';
import { taktOf, productOf, checkBrief, checkPlan, jobFromSdd, briefWarnings } from '../../spec/sdd/checks.js';
import { renderConstitution, renderBrief, renderPlan } from '../../spec/sdd/render.js';
import { CONVENTIONS } from '../../lib/core/conventions.js';
import { juiceBrief, juicePlan } from './fixtures.js';

describe('the Spec agent\'s schemas', () => {
  it('strict-valid; products built from params (no imported model), conveyors with in and out ports', () => {
    expect(checkStrict(briefSchema(registry).schema)).toEqual([]);
    expect(checkStrict(planSchema(registry).schema)).toEqual([]);
    const products = briefProducts(registry);
    expect(products).toContain('parametric');
    expect(products).not.toContain('model');
    const transports = transportTypes(registry);
    expect(transports).toContain('beltConveyor');
    for (const t of transports) expect(['conveyor', 'transport']).toContain(registry.getComponent(t).category);
    expect(QUESTION_TOPICS).toContain('throughput');
  });

  it('a brief and a plan go answer form → IR → answer form unchanged; the line-set serial is never asked', () => {
    const b = briefSchema(registry);
    const decoded = b.decode(b.encode(juiceBrief));
    expect(decoded).toEqual(juiceBrief);
    expect(JSON.stringify(b.schema)).not.toContain('"serial"');
    const p = planSchema(registry);
    expect(p.decode(p.encode(juicePlan))).toEqual(juicePlan);
    // A catalog product decodes to its own branch.
    const printer = { ...juiceBrief, product: { ...juiceBrief.product, model: { kind: 'catalog', type: 'printer', params: {} } } };
    expect(b.decode(b.encode(printer)).product.model).toEqual({ kind: 'catalog', type: 'printer', params: {} });
  });
});

describe('checks in code', () => {
  it('a good brief and plan pass; takt and product as factory.json has them', () => {
    expect(checkBrief(registry, juiceBrief)).toEqual([]);
    expect(checkPlan(registry, juicePlan, juiceBrief)).toEqual([]);
    expect(taktOf(juiceBrief)).toBe(15);
    expect(productOf(juiceBrief)).toEqual({ kind: 'parametric', params: juiceBrief.product.model.params });
  });

  it('brief problems: id, title, product params, duplicate steps', () => {
    const bad = structuredClone(juiceBrief);
    bad.id = 'Juice line';
    bad.title = 'x'.repeat(61);
    bad.product.model.params.height = 5;
    bad.steps.push({ name: 'fill', does: 'again' });
    expect(checkBrief(registry, bad)).toEqual([
      'id: "Juice line" must be camelCase (a-z first, then letters and digits)',
      'title: 61 characters, at most 60',
      expect.stringMatching(/^product\.model\.params\.height: /),
      'steps: "fill" is named twice; step names must be unique',
    ]);
  });

  it('plan problems: over the takt, a step nobody covers, a cover that is no step, ids, unknown machines', () => {
    const bad = structuredClone(juicePlan);
    bad.stations[0].seconds = 20;
    bad.stations[1].covers = ['Screw'];
    bad.stations[2].id = 'filling';
    bad.stations[2].machines = ['teleporter'];
    expect(checkPlan(registry, bad, juiceBrief)).toEqual([
      'stations[0].seconds: 20 s is over the takt of 15.0 s (240/h); split the work over more stations or shorten it',
      'stations[2].machines: "teleporter" is not a catalog type',
      'stations: id "filling" is used twice',
      'stations[1].covers: "Screw" is not a brief step (Fill, Cap, Inspect)',
      'stations: no station covers the brief step "Cap"',
    ]);
  });

  it('the plan as the Builder\'s job: line with its transport, product, stations with their steps', () => {
    const job = jobFromSdd(juiceBrief, juicePlan);
    expect(job.line).toEqual({ id: 'juiceLine', title: 'Apple juice bottling', runSize: 8, transport: { type: 'beltConveyor', params: {} } });
    expect(job.product.kind).toBe('parametric');
    expect(job.plan.map((s) => s.id)).toEqual(['filling', 'capping', 'inspection']);
    expect(job.plan[0]).toEqual({ id: 'filling', code: 'ST1', title: 'Filling', does: 'Fills each bottle', steps: juicePlan.stations[0].steps, seconds: 12, machines: ['beltConveyor'] });
  });
});

describe('the documents', () => {
  it('constitution.md from the conventions alone', () => {
    const md = renderConstitution();
    expect(md).toMatch(/^# Constitution/);
    expect(md).toContain(`belt top at **${CONVENTIONS.beltHeight} m**`);
    expect(md).toContain('Units flow along **+X**');
    expect(md).toContain('1×, 2×, 10×');
    expect(renderConstitution({ ...CONVENTIONS, beltHeight: 0.9 })).toContain('belt top at **0.9 m**');
  });

  it('factory-brief.md: product, takt, the steps as a table, open questions only when there are some', () => {
    const md = renderBrief(juiceBrief);
    expect(md).toContain('# Factory brief: Apple juice bottling');
    expect(md).toContain('**240 units per hour**, so a takt of **15 s**');
    expect(md).toContain('parametric bottle, 90 × 90 × 260 mm');
    expect(md).toContain('| 2 | Cap | Screw a cap on |');
    expect(md).not.toContain('Open questions');
    const open = renderBrief({ ...juiceBrief, questions: [{ topic: 'throughput', question: 'One shift or two?', why: 'decides the run size' }] });
    expect(open).toContain('## Open questions\n- **throughput**: One shift or two? _(decides the run size)_');
  });

  it('plan.md: graph, stations, steps, takt shares; the same data gives the same text', () => {
    const md = renderPlan(juicePlan, juiceBrief);
    expect(md).toContain('3 stations in a straight line, joined by `beltConveyor` transfers. Takt 15 s (240/h); the slowest station is **Filling** at 12 s.');
    expect(md).toContain('**ST1** Filling → **ST2** Capping → **ST3** Inspection');
    expect(md).toContain('| Filling | 12 | 80 % |');
    expect(md).toContain('### ST2 Capping\n1. bottle in');
    expect(md).toContain('Expected machines: `beltConveyor`.');
    expect(renderPlan(juicePlan, juiceBrief)).toBe(md);
  });
});

describe('warnings (shown to the owner, not refused)', () => {
  it('rejects described but the product never fails: a warning in the list and in factory-brief.md', () => {
    expect(briefWarnings(registry, juiceBrief)).toEqual([]); // rejectEvery 4
    const never = structuredClone(juiceBrief);
    delete never.product.model.params.rejectEvery;
    const w = briefWarnings(registry, never);
    expect(w).toEqual([expect.stringMatching(/^The brief says bad units are rejected, but product\.model\.params\.rejectEvery is unset: no unit will ever fail/)]);
    expect(renderBrief(never, { warnings: w })).toContain('## Checks\n- ⚠ The brief says bad units');
    // No rejects described: no warning.
    const calm = { ...never, quality: '', steps: [{ name: 'Fill', does: 'Fill each bottle' }] };
    expect(briefWarnings(registry, calm)).toEqual([]);
    // A catalog product without such a setting: nothing to say.
    expect(briefWarnings(registry, { ...juiceBrief, product: { ...juiceBrief.product, model: { kind: 'catalog', type: 'printer', params: {} } } })).toEqual([]);
  });
});
