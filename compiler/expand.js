// factory.json → what the runtime plays: shells expanded into equipment, station fields merged with
// the shell's, convention overrides merged with the defaults. Deterministic; knows no component
// by name (rule 6): shells come from the registry.
//
//   expandFactory(registry, data) → { factory, conventions, ctx, line }
//     line         line data for lib/line/Line.js and compiler/timing.js (stations with full equipment)
//     conventions  the line conventions with this factory's overrides
//     ctx          build context for components and products (belt height…)
//   checkFactory(registry, data)  → { ok, errors: [{ path, message }], expanded?, timing? }
//     parse + expand + a dry plan of every station and the layout: everything short of geometry.
import { parseFactory, FactoryError } from '../spec/factory.schema.js';
import { CONVENTIONS } from '../lib/core/conventions.js';
import { lineTiming } from './timing.js';

/** The line conventions with overrides applied (nested groups merged, not replaced). */
export function mergeConventions(overrides = {}) {
  const o = overrides ?? {};
  return Object.freeze({
    ...CONVENTIONS,
    ...pick(o, ['beltHeight', 'transferLength', 'holdSeconds']),
    conveyor: Object.freeze({ ...CONVENTIONS.conveyor, ...pick(o.conveyor ?? {}, ['speed', 'ramp']) }),
    lift: Object.freeze({ ...CONVENTIONS.lift, ...pick(o.lift ?? {}, ['drop', 'duration']) }),
  });
}

function pick(obj, keys) {
  return Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
}

/** Copy without undefined values (so schema defaults downstream still apply). */
function defined(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

/** One station of factory.json → a station of the runtime line (shell expanded and merged). */
export function expandStation(registry, station, ctx = {}) {
  const where = `stations › ${station.id}`;
  let shell = null;
  if (station.shell) {
    try {
      shell = registry.expandShell(station.shell.type, station.shell.params, ctx);
    } catch (error) {
      throw new FactoryError(`${where} › shell: ${error.message}`, [{ path: `${where}.shell`, message: error.message }]);
    }
  }
  const equipment = [...(shell?.equipment ?? [])];
  for (const e of station.equipment) {
    if (equipment.some((x) => x.id === e.id)) {
      const message = `equipment id "${e.id}" is already used by the shell (${shell.equipment.map((x) => x.id).join(', ')})`;
      throw new FactoryError(`${where}: ${message}`, [{ path: `${where}.equipment`, message }]);
    }
    equipment.push(e);
  }
  if (!equipment.length) {
    const message = 'no equipment (give a shell or equipment)';
    throw new FactoryError(`${where}: ${message}`, [{ path: where, message }]);
  }

  // Ports: the shell's, each overridden field by field by the station's own.
  const ports = {};
  for (const [name, p] of Object.entries(shell?.station.ports ?? {})) ports[name] = { ...p };
  for (const [name, p] of Object.entries(station.ports)) ports[name] = { ...ports[name], ...defined(p) };
  // Signals: same, per signal.
  const signals = {};
  for (const key of ['beacon', 'display', 'dashboard']) {
    const merged = { ...(shell?.station.signals?.[key] ?? {}), ...defined(station.signals?.[key] ?? {}) };
    if (Object.keys(merged).length) signals[key] = merged;
  }

  return defined({
    id: station.id,
    code: station.code,
    title: station.title,
    workState: station.workState,
    role: station.role === 'transfer' ? 'transfer' : undefined, // left out for ordinary stations
    inputStage: station.inputStage,
    unit: station.unit,
    conveyor: station.conveyor ?? shell?.station.conveyor,
    ports,
    prepare: station.prepare?.length ? station.prepare : undefined, // left out when there are none
    intake: station.intake,
    process: station.process,
    output: station.output,
    home: station.home,
    stock: station.stock,
    stacks: station.stacks,
    // Only when there are any, so stations without connections compile exactly as before.
    connections: station.connections?.length ? station.connections : undefined,
    batch: station.batch, // undefined (left out) unless units arrive as batches
    indexing: station.indexing, // undefined (left out) for single-unit stations
    sensors: station.sensors?.length ? station.sensors : undefined,
    status: station.status,
    signals,
    feed: station.feed,
    equipment,
  });
}

/** Expands a whole factory.json (see the header). Throws FactoryError on any problem found. */
export function expandFactory(registry, data) {
  const factory = parseFactory(data);
  const conventions = mergeConventions(factory.line.conventions);
  const ctx = { beltHeight: conventions.beltHeight };
  if (factory.product.kind === 'catalog' && !registry.getProduct(factory.product.type)) {
    const known = registry.products().map((p) => p.type).join(', ');
    throw new FactoryError(`product: unknown catalog product "${factory.product.type}" (products: ${known})`, [{ path: 'product.type', message: `unknown catalog product "${factory.product.type}"` }]);
  }
  const line = {
    id: factory.line.id,
    title: factory.line.title,
    runSize: factory.line.runSize,
    product: { type: factory.product.type, params: factory.product.params },
    transferLength: conventions.transferLength,
    stations: factory.stations.map((s) => expandStation(registry, s, ctx)),
    edges: factory.graph.edges,
  };
  return { factory, conventions, ctx, line };
}

/**
 * Everything that can be checked without building geometry: schema, references, catalog types,
 * every op of every station (dry plan), ports, edges and layout. Never throws.
 */
export function checkFactory(registry, data) {
  try {
    const expanded = expandFactory(registry, data);
    const timing = lineTiming(registry, expanded.line, { ctx: expanded.ctx, conventions: expanded.conventions });
    return { ok: true, errors: [], expanded, timing };
  } catch (error) {
    if (error instanceof FactoryError && error.issues.length) return { ok: false, errors: error.issues };
    return { ok: false, errors: [{ path: '(compile)', message: error.message }] };
  }
}
