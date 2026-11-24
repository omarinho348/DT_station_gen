// The Builder's answer schemas (agents/builder/schemas.js) and the strict-mode converter under them
// (agents/strict.js), Phase 8 step 3a. Every schema must pass strict mode's rules, and every op and
// param set of the three example lines must survive IR → strict form → IR unchanged.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import { expandStation } from '../../compiler/expand.js';
import { parseFactory } from '../../spec/factory.schema.js';
import { CONVENTIONS } from '../../lib/core/conventions.js';
import { toStrict, checkStrict, ANY_VALUE, STRICT_LIMITS } from '../../agents/strict.js';
import { layoutSchema, machinesSchema, processSchema, PLACES, ALONG } from '../../agents/builder/schemas.js';

const lines = ['printer-line', 'lubricant-line', 'bottling-line'].map((n) => [n, JSON.parse(readFileSync(`spec/examples/${n}.factory.json`, 'utf8'))]);
const stations = lines.flatMap(([n, f]) => f.stations.map((s) => [`${n}/${s.id}`, s]));
const parsed = Object.fromEntries(lines.flatMap(([n, f]) => parseFactory(f).stations.map((s) => [`${n}/${s.id}`, s])));

/** Every op named in a list, nested ones included. */
function opsIn(list, out = new Set()) {
  for (const op of list ?? []) {
    out.add(op.op);
    for (const v of Object.values(op)) {
      if (Array.isArray(v) && v.every((x) => x && typeof x === 'object' && 'op' in x)) opsIn(v, out);
      if (v && typeof v === 'object' && !Array.isArray(v)) for (const w of Object.values(v)) if (Array.isArray(w) && w.every((x) => x && typeof x === 'object' && 'op' in x)) opsIn(w, out);
    }
  }
  return out;
}

describe('strict converter', () => {
  const zs = z.object({
    name: z.string().min(1).max(10),
    size: z.number().min(0).max(5).default(1),
    tags: z.record(z.string(), z.number()).optional(),
    at: z.tuple([z.number(), z.number(), z.number()]),
    extra: z.record(z.string(), z.unknown()).optional(),
    kind: z.union([z.object({ a: z.literal('x'), n: z.number().optional() }), z.object({ a: z.literal('y'), s: z.string() })]),
  });
  const { schema, decode, encode } = toStrict(z.toJSONSchema(zs, { io: 'input', unrepresentable: 'any' }));

  it('every property required, optional ones nullable, maps as { key, value } lists, tuples fixed-length, unknown values typed', () => {
    expect(checkStrict(schema)).toEqual([]);
    expect(schema.required).toEqual(['name', 'size', 'tags', 'at', 'extra', 'kind']);
    expect(schema.properties.size.anyOf.at(-1)).toEqual({ type: 'null' });
    expect(schema.properties.size.anyOf[0]).not.toHaveProperty('default');
    expect(schema.properties.name).not.toHaveProperty('maxLength');
    expect(schema.properties.tags.anyOf[0]).toMatchObject({ type: 'array', items: { required: ['key', 'value'], additionalProperties: false } });
    expect(schema.properties.at).toMatchObject({ type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 });
    expect(schema.properties.extra.anyOf[0].items.properties.value).toEqual(ANY_VALUE);
  });

  it('decode undoes it (nulls dropped so defaults apply, lists back to maps, the right union branch); encode is its reverse', () => {
    const answer = { name: 'a', size: null, tags: [{ key: 'w', value: 2 }], at: [1, 2, 3], extra: null, kind: { a: 'y', s: 'z' } };
    const ir = decode(answer);
    expect(ir).toEqual({ name: 'a', tags: { w: 2 }, at: [1, 2, 3], kind: { a: 'y', s: 'z' } });
    expect(zs.parse(ir)).toMatchObject({ size: 1 });
    expect(decode(encode(ir))).toEqual(ir);
    expect(decode(encode({ ...ir, kind: { a: 'x', n: 4 } })).kind).toEqual({ a: 'x', n: 4 });
  });

  it('refuses what strict mode cannot take, and checkStrict reports what is wrong', () => {
    expect(() => toStrict({ type: 'object', properties: { a: { allOf: [{ type: 'string' }] } } })).toThrow(/"allOf" is not supported/);
    expect(() => toStrict({ type: 'array', items: { type: 'string' } })).toThrow(/root of a strict schema must be an object/);
    expect(checkStrict({ type: 'object', properties: { a: { type: 'string' }, b: {} }, required: ['a'] })).toEqual([
      '(root): additionalProperties must be false',
      '(root): every property must be required (b are not)',
      '(root).b: no type (any JSON value is not allowed)',
    ]);
  });

  it('const and enum get a type beside them (OpenAI refused a bare const on the first live call, step 8.6)', () => {
    const { schema } = toStrict({ type: 'object', properties: { op: { const: 'fill' }, n: { const: 2 }, k: { enum: ['a', 'b'] }, m: { enum: [1, 'x'] } }, required: ['op', 'n', 'k', 'm'] });
    expect(schema.properties).toEqual({ op: { const: 'fill', type: 'string' }, n: { const: 2, type: 'integer' }, k: { enum: ['a', 'b'], type: 'string' }, m: { enum: [1, 'x'], type: ['integer', 'string'] } });
    expect(checkStrict({ type: 'object', properties: { op: { const: 'x' } }, required: ['op'], additionalProperties: false })).toEqual(['(root).op: no type beside const / enum (OpenAI requires one)']);
    // Every const in the Builder's real schemas carries its type.
    const bare = [];
    const walk = (s, path) => {
      if (Array.isArray(s)) s.forEach((x, i) => walk(x, `${path}[${i}]`));
      else if (s && typeof s === 'object') {
        if (('const' in s || s.enum) && !('type' in s)) bare.push(path);
        for (const [k, v] of Object.entries(s)) walk(v, `${path}.${k}`);
      }
    };
    walk(layoutSchema(registry).schema, 'layout');
    walk(processSchema(registry, { ops: registry.ops().map((d) => d.op), machines: ['a'] }).schema, 'process');
    expect(bare).toEqual([]);
  });
});

describe('layout phase', () => {
  const { schema, decode } = layoutSchema(registry);

  it('is strict; machines are catalog types with a placement hint, never coordinates; ops from the registry', () => {
    expect(checkStrict(schema)).toEqual([]);
    const item = schema.properties.equipment.items;
    expect(item.properties.type.enum).toEqual(registry.components().map((d) => d.type).sort());
    expect(item.properties.place.enum).toEqual(Object.keys(PLACES));
    expect(item.properties.at.enum).toEqual(ALONG);
    expect(JSON.stringify(schema)).not.toMatch(/"position"|"rotationY"/);
    expect(schema.properties.ops.items.enum).toEqual(registry.ops().map((d) => d.op).sort());
    expect(schema.properties.shell.anyOf.map((b) => b.properties?.type?.const).filter(Boolean)).toEqual(registry.shells().map((d) => d.type));
  });

  it('an answer decodes to the station layout (nulls gone)', () => {
    const type = registry.components()[0].type;
    const out = decode({
      id: 'capping', code: null, title: 'Capping', shell: null,
      equipment: [{ id: 'capper', type, why: 'caps the bottle', place: 'overLine', at: 'work', on: null }],
      conveyor: 'belt', ops: ['move'],
    });
    expect(out).toEqual({ id: 'capping', title: 'Capping', equipment: [{ id: 'capper', type, why: 'caps the bottle', place: 'overLine', at: 'work' }], conveyor: 'belt', ops: ['move'] });
  });
});

describe('machines phase', () => {
  it('for every example station: strict, one property per machine typed by its component, and every param set survives the round trip and still validates', () => {
    for (const [name, s] of stations) {
      if (!s.equipment.length) continue;
      const { schema, decode, encode } = machinesSchema(registry, s.equipment);
      expect(checkStrict(schema), name).toEqual([]);
      expect(Object.keys(schema.properties.params.properties)).toEqual(s.equipment.map((e) => e.id));
      const ir = { params: Object.fromEntries(s.equipment.map((e) => [e.id, e.params ?? {}])) };
      const back = decode(encode(ir));
      expect(back, name).toEqual(ir);
      for (const e of s.equipment) expect(() => registry.componentSpec(e.type, back.params[e.id], { beltHeight: CONVENTIONS.beltHeight }), `${name}/${e.id}`).not.toThrow();
    }
  });
});

describe('process phase', () => {
  it('for every example station: strict and within the limits; ops typed by their args; machine args limited to the station\'s ids; intake / process / output survive the round trip', () => {
    let largest = 0;
    for (const [name, s] of stations) {
      const phases = { intake: s.intake, process: s.process, output: s.output, inputStage: s.inputStage };
      const ops = [...opsIn([...(s.intake ?? []), ...(s.process ?? []), ...(s.output ?? [])])];
      if (!ops.length) continue;
      const machines = expandStation(registry, parsed[name], { beltHeight: CONVENTIONS.beltHeight }).equipment.map((e) => e.id);
      const { schema, decode, encode } = processSchema(registry, { ops, machines });
      expect(checkStrict(schema), name).toEqual([]);
      const branches = schema.$defs.op.anyOf;
      expect(branches.map((b) => b.properties.op.const).sort()).toEqual([...ops].sort());
      for (const b of branches) {
        if (b.properties.machine) {
          const m = b.properties.machine.anyOf?.[0] ?? b.properties.machine;
          expect(m.enum, `${name} ${b.properties.op.const}`).toEqual(machines);
        }
      }
      const ir = Object.fromEntries(Object.entries(phases).filter(([, v]) => v !== undefined));
      expect(decode(encode(ir)), name).toEqual(ir);
      largest = Math.max(largest, JSON.stringify(schema).length);
    }
    expect(largest).toBeLessThan(120000); // OpenAI's limit on all names and enum values together is 120k characters
  });

  it('ops a decision runs are typed by the same union; an unknown op is refused', () => {
    const decideOp = registry.ops().find((d) => JSON.stringify(z.toJSONSchema(d.args, { io: 'input', unrepresentable: 'any' })).includes('"additionalProperties":{}') && /branch/i.test(d.summary));
    const { schema } = processSchema(registry, { ops: [decideOp.op, 'wait'], machines: ['a'] });
    expect(JSON.stringify(schema.$defs.op)).toContain('"$ref":"#/$defs/op"');
    expect(() => processSchema(registry, { ops: ['teleport'], machines: [] })).toThrow(/unknown op "teleport"/);
  });

  it('size: the limits OpenAI documents', () => {
    expect(STRICT_LIMITS).toEqual({ properties: 5000, depth: 10, enumValues: 1000 });
  });
});
