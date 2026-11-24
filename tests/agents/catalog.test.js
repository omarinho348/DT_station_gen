// What the agents see of the library (lib/catalog.js, Phase 8 step 2): the index (agents/catalog.json,
// always in the prompt, under ~4k tokens) and the detail of the types and ops a station uses.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { registry, paramFields } from '../../lib/registry.js';
import '../../lib/components/index.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import { catalogIndex, catalogDetail, catalogTokens, shortSummary } from '../../lib/catalog.js';

const index = catalogIndex(registry);
const lines = Object.values(index.components).flat();
const typeOf = (line) => line.split(/[ [·]/)[0];

describe('catalog index (agents/catalog.json)', () => {
  it('is under 4000 tokens (conservative count, compact JSON) and the file on disk is current (npm run catalog)', () => {
    expect(catalogTokens(index)).toBeLessThan(4000);
    expect(JSON.parse(readFileSync('agents/catalog.json', 'utf8'))).toEqual(index);
  });

  it('lists every component (by category), op, product and shell once', () => {
    expect(lines.map(typeOf).sort()).toEqual(registry.components().map((d) => d.type).sort());
    for (const [category, list] of Object.entries(index.components)) {
      for (const line of list) expect(registry.getComponent(typeOf(line)).category).toBe(category);
    }
    expect(index.ops.map((l) => l.split('(')[0]).sort()).toEqual(registry.ops().map((d) => d.op).sort());
    expect(index.products.map((l) => l.split(' ')[0]).sort()).toEqual(registry.products().map((d) => d.type).sort());
    expect(index.shells.map((l) => l.split('(')[0])).toEqual(registry.shells().map((d) => d.type));
  });

  it('each component line: mount when not floor, size at default params, ports with direction and goods, ops', () => {
    for (const def of registry.components()) {
      const line = lines.find((l) => typeOf(l) === def.type);
      if (def.mount === 'floor') expect(line, def.type).not.toMatch(/^\S+ \[/);
      else expect(line, def.type).toContain(`${def.type} [${def.mount}]`);
      expect(line, def.type).toMatch(/ [\d.]+×[\d.]+×[\d.]+ m/);
      const spec = registry.componentSpec(def.type, {}, {});
      for (const name of Object.keys(spec.ports)) expect(line, def.type).toMatch(new RegExp(`\\b${name}\\b`));
      for (const op of def.ops) expect(line, def.type).toMatch(new RegExp(`ops [^—]*\\b${op}\\b`));
    }
  });

  it('each op line: every required arg; the args every op takes said once in the legend, not per line', () => {
    expect(index.legend.join(' ')).toMatch(/every op also takes label\?, state\?, status\?/);
    for (const def of registry.ops()) {
      const line = index.ops.find((l) => l.startsWith(`${def.op}(`));
      const args = line.slice(line.indexOf('(') + 1, line.indexOf(')')).split(', ');
      expect(args, def.op).not.toContain('label?');
      for (const [key, schema] of Object.entries(def.args.shape)) {
        if (!schema.safeParse(undefined).success) expect(args, `${def.op}.${key}`).toContain(key);
      }
      if (def.needs?.machineOp) expect(line).toContain(`[machine with op ${def.needs.machineOp}]`);
    }
  });

  it('is deterministic, and its version changes only with its content', () => {
    expect(catalogIndex(registry)).toEqual(index);
    expect(index.version).toMatch(/^[0-9a-f]{12}$/);
  });

  it('short summaries: the first clause, cut at a word with "…" past the limit', () => {
    expect(shortSummary('Flat-belt conveyor for loose units. It has two drums.')).toBe('Flat-belt conveyor for loose units');
    expect(shortSummary('Servo screw capper in a guarded portal: four heads over the belt')).toBe('Servo screw capper in a guarded portal');
    const long = shortSummary('A very long summary that keeps going well past the limit of the index line here', 40);
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('catalog detail', () => {
  it('the full contract of the asked types: params with ranges and defaults as the schema says, ports, motions, anchors, ops', () => {
    for (const def of registry.components()) {
      const d = catalogDetail(registry, { types: [def.type] }).components[def.type];
      const spec = registry.componentSpec(def.type, {}, {});
      expect(d.params.map((p) => p.key), def.type).toEqual(paramFields(def.params).map((f) => f.key));
      for (const p of d.params) {
        const f = paramFields(def.params).find((x) => x.key === p.key);
        if (f.min !== undefined) expect(p.min).toBe(f.min);
        if (f.max !== undefined) expect(p.max).toBe(f.max);
        expect(p.default).toEqual(f.default);
      }
      expect(Object.keys(d.ports)).toEqual(Object.keys(spec.ports));
      expect(Object.keys(d.motions)).toEqual(Object.keys(spec.motions));
      expect(d.mount).toBe(def.mount);
    }
  });

  it('ops with every arg (required marked) and what machine op they need; unknown names listed, not thrown', () => {
    const def = registry.ops()[0];
    const d = catalogDetail(registry, { ops: [def.op, 'teleport'], types: ['warpDrive'] });
    expect(d.ops[def.op].args.map((a) => a.key)).toEqual(paramFields(def.args).map((f) => f.key));
    expect(d.unknown).toEqual(['warpDrive', 'teleport']);
  });

  it('a station\'s worth of detail stays small: the three biggest components and five ops under 4000 tokens', () => {
    const bySize = registry.components().map((c) => [c.type, catalogTokens(catalogDetail(registry, { types: [c.type] }))]).sort((a, b) => b[1] - a[1]);
    const ops = registry.ops().slice(0, 5).map((o) => o.op);
    const d = catalogDetail(registry, { types: bySize.slice(0, 3).map(([t]) => t), ops });
    expect(catalogTokens(d)).toBeLessThan(4000);
  });
});
