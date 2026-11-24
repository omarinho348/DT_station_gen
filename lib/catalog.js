// What the agents see of the library (Claude.md §6.1, §7.5): built from the registry alone, so it
// never names a component itself (rule 6) and changes only when the library does. Two levels:
//
//   catalogIndex(registry)              → catalog.json: every component, op, product and shell on
//                                         one line each. Always in the prompt, in its stable first
//                                         part (prompt caching), kept under ~4k tokens (tested).
//   catalogDetail(registry, { types, ops })  → the full contract of just the types and ops a station
//                                         uses: params with ranges and defaults, ports with places,
//                                         motions with ranges, anchors; op arguments. Goes in the
//                                         variable part of a prompt (the Builder's machines and
//                                         process phases, after the layout phase picked the types).
//
// Sizes and ports in the index are at default params, in the component's own frame (metres; flow
// +X, conveyor on z = 0). The index carries a version (a hash of its content): it must not change
// during a session, or the prompt cache is lost.
import { createHash } from 'node:crypto';
import { paramFields } from './registry.js';
import { CONVENTIONS } from './core/conventions.js';

/** A rough, conservative token count for the size check (about 3 characters per token). */
export const catalogTokens = (value) => Math.ceil(JSON.stringify(value).length / 3);

const r1 = (v) => Math.round(v * 10) / 10;
const r3 = (v) => Math.round(v * 1000) / 1000;

/** A summary cut to its first clause, at most `max` characters (at a word, with "…"). */
export function shortSummary(text, max = 56) {
  let s = String(text).split(/(?<=\.)\s/)[0].replace(/\.$/, '');
  const clause = s.search(/[:;(]/);
  if (clause > 20) s = s.slice(0, clause).trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).replace(/[\s,]+\S*$/, '')}…`;
}

/** Ports as "input(in) work output(out) [unit]" (each port's goods when they differ). */
function portText(ports) {
  const list = Object.entries(ports);
  if (!list.length) return '';
  const goods = new Set(list.map(([, p]) => p.carries));
  const one = goods.size === 1;
  const items = list.map(([name, p]) => {
    const tags = [p.direction === 'work' ? null : p.direction, one ? null : p.carries].filter(Boolean);
    return tags.length ? `${name}(${tags.join(' ')})` : name;
  });
  return `ports ${items.join(' ')}${one ? ` [${[...goods][0]}]` : ''}`;
}

const specAtDefaults = (registry, type) => registry.componentSpec(type, {}, { beltHeight: CONVENTIONS.beltHeight });

/** One line per component: "type [mount] L×W×H m · ports … · ops … — summary". */
function componentLine(registry, def) {
  const spec = specAtDefaults(registry, def.type);
  const f = spec.footprint;
  const parts = [
    `${def.type}${def.mount === 'floor' ? '' : ` [${def.mount}]`} ${r1(f.x[1] - f.x[0])}×${r1(f.z[1] - f.z[0])}×${r1(f.height)} m`,
    portText(spec.ports),
    def.ops.length ? `ops ${def.ops.join(' ')}` : '',
  ].filter(Boolean);
  return `${parts.join(' · ')} — ${shortSummary(def.summary)}`;
}

/** The args every op takes (worked out from the registry): said once in the legend, not on every line. */
function sharedArgs(registry) {
  const all = registry.ops().map((d) => new Set(paramFields(d.args).map((f) => f.key)));
  return all.length ? [...all[0]].filter((k) => all.every((a) => a.has(k))) : [];
}

/**
 * One line per op: "op(arg, arg?, …) [needs a machine with op X] — summary": every required arg, the
 * first three optional ones (marked ?), "…" when there are more (the detail lists them all).
 */
function opLine(def, shared = []) {
  const json = paramFields(def.args).filter((f) => !shared.includes(f.key));
  const required = new Set(requiredKeys(def.args));
  let optional = 0;
  const shown = [];
  for (const f of json) {
    if (required.has(f.key)) shown.push(f.key);
    else if ((optional += 1) <= 3) shown.push(`${f.key}?`);
  }
  if (optional > 3) shown.push('…');
  const needs = def.needs?.machineOp ? ` [machine with op ${def.needs.machineOp}]` : '';
  return `${def.op}(${shown.join(', ')})${needs} — ${shortSummary(def.summary, 60)}`;
}

function requiredKeys(schema) {
  return Object.entries(schema.shape ?? {}).filter(([, s]) => !s.safeParse(undefined).success).map(([k]) => k);
}

/** One line per product: "type — stages a → b → c · parts N · facts f(v|w) — summary". */
function productLine(def) {
  const bits = [`stages ${def.stages.join(' → ')}`];
  if (def.parts.length) bits.push(`${def.parts.length} parts`);
  const facts = Object.entries(def.facts ?? {});
  if (facts.length) bits.push(`facts ${facts.map(([k, v]) => `${k}(${v.values.join('|')})`).join(' ')}`);
  return `${def.type} · ${bits.join(' · ')} — ${shortSummary(def.summary)}`;
}

function shellLine(def) {
  return `${def.type}(${paramFields(def.params).map((f) => f.key).join(', ')}) — ${shortSummary(def.summary, 90)}`;
}

/** catalog.json: the whole library, one line per entry (see the header). */
export function catalogIndex(registry) {
  const byCategory = {};
  for (const def of [...registry.components()].sort((a, b) => a.type.localeCompare(b.type))) {
    (byCategory[def.category] ??= []).push(componentLine(registry, def));
  }
  const components = Object.fromEntries(Object.keys(byCategory).sort().map((k) => [k, byCategory[k]]));
  const shared = sharedArgs(registry);
  const body = {
    legend: [
      'Components: type [mount] length(x)×depth(z)×height m at default params · ports · ops — summary.',
      'Mount: floor unless shown; overConveyor / besideConveyor sit at a conveyor, surface on another component, tool on a robot.',
      'Ports: name(in|out); others are work places; [unit|batch|case|pallet] is what they carry.',
      `Ops: op(args), "?" optional${shared.length ? `; every op also takes ${shared.map((k) => `${k}?`).join(', ')}` : ''}. Ask for the detail of the types and ops you use (params, ranges, motions, all args).`,
    ],
    components,
    ops: [...registry.ops()].sort((a, b) => a.op.localeCompare(b.op)).map((d) => opLine(d, shared)),
    products: [...registry.products()].sort((a, b) => a.type.localeCompare(b.type)).map(productLine),
    shells: registry.shells().map(shellLine),
  };
  const version = createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 12);
  return { version, ...body };
}

/** A param field as compact data: { key, kind, default, min?, max?, options?, about? }. */
function fieldOf(f) {
  const out = { key: f.key, kind: f.kind };
  if (f.default !== undefined) out.default = f.default;
  if (f.min !== undefined) out.min = f.min;
  if (f.max !== undefined) out.max = f.max;
  if (f.options) out.options = f.options;
  if (f.label && f.label !== f.key) out.about = f.label;
  return out;
}

/**
 * The full contract of some components and ops (see the header). Unknown names are listed under
 * `unknown` rather than thrown, so an agent's wrong guess becomes feedback, not a crash.
 */
export function catalogDetail(registry, { types = [], ops = [] } = {}) {
  const known = new Set(registry.components().map((d) => d.type));
  const out = { components: {}, ops: {}, unknown: [] };
  for (const type of [...new Set(types)]) {
    if (!known.has(type)) { out.unknown.push(type); continue; }
    const def = registry.getComponent(type);
    const spec = specAtDefaults(registry, type);
    const f = spec.footprint;
    out.components[type] = {
      category: def.category,
      summary: def.summary,
      mount: def.mount,
      footprint: { x: f.x.map(r3), z: f.z.map(r3), height: r3(f.height) },
      params: paramFields(def.params).map(fieldOf),
      ports: Object.fromEntries(Object.entries(spec.ports).map(([k, p]) => [k, { direction: p.direction, carries: p.carries, at: p.position.map(r3) }])),
      motions: Object.fromEntries(Object.entries(spec.motions).map(([k, m]) => [k, m.range ? { range: m.range.map(r3) } : { values: m.values }])),
      ...(spec.anchors.length ? { anchors: spec.anchors } : {}),
      ...(def.ops.length ? { ops: def.ops } : {}),
    };
  }
  for (const op of [...new Set(ops)]) {
    const def = registry.getOp(op);
    if (!def) { out.unknown.push(op); continue; }
    const required = new Set(requiredKeys(def.args));
    out.ops[op] = {
      summary: def.summary,
      args: paramFields(def.args).map((f) => ({ ...fieldOf(f), ...(required.has(f.key) ? { required: true } : {}) })),
      ...(def.needs?.machineOp ? { needsMachineOp: def.needs.machineOp } : {}),
    };
  }
  return out;
}
