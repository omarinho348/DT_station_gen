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
    supplies: Object.keys(station.supplies ?? {}).length ? station.supplies : undefined, // left out when there are none
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
    product: checkedProduct(registry, factory.product),
    transferLength: conventions.transferLength,
    ...expandParallel(factory, factory.stations.map((s) => expandStation(registry, s, ctx))),
  };
  return { factory, conventions, ctx, line };
}

/**
 * The product the line plays: a catalog product as written; a parametric one or the owner's GLB
 * model as the generic product types that build them (lib/products/parametric, lib/products/model).
 */
function productOf(product) {
  if (product.kind === 'parametric') return { type: 'parametric', params: product.params };
  if (product.kind === 'glb') return { type: 'model', params: { ...product.params, file: product.file } };
  return { type: product.type, params: product.params };
}

/** productOf, with its params checked against the product type (clear errors at product.params). */
function checkedProduct(registry, product) {
  const out = productOf(product);
  const def = registry.getProduct(out.type);
  const parsed = def?.params.safeParse(out.params);
  if (parsed && !parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: `product.params.${i.path.join('.')}`, message: i.message }));
    throw new FactoryError(`product: ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`, issues);
  }
  return out;
}

/**
 * Parallel copies (station `parallel: n`): the station becomes n stations, <id>1 … <id>n, each with
 * `copyOf` (the layout stands them side by side, the timing shares their work), and every edge to
 * or from it is repeated for each copy. Returns { stations, edges }.
 */
function expandParallel(factory, stations) {
  const copiesOf = new Map();
  const out = [];
  factory.stations.forEach((raw, i) => {
    const s = stations[i];
    if (!raw.parallel) { out.push(s); return; }
    const ids = Array.from({ length: raw.parallel }, (_, k) => `${s.id}${k + 1}`);
    for (const id of ids) {
      if (factory.stations.some((o) => o.id === id)) {
        const message = `parallel copy id "${id}" is already a station id`;
        throw new FactoryError(`stations[${i}]: ${message}`, [{ path: `stations[${i}].parallel`, message }]);
      }
    }
    copiesOf.set(s.id, ids);
    ids.forEach((id, k) => out.push({
      ...s,
      id,
      code: s.code ? `${s.code}${String.fromCharCode(97 + k)}`.slice(0, 8) : undefined,
      title: `${s.title} ${k + 1}/${raw.parallel}`.slice(0, 40),
      copyOf: s.id,
    }));
  });
  const ends = (text) => {
    const [station, port] = text.split('.');
    return (copiesOf.get(station) ?? [station]).map((id) => `${id}.${port}`);
  };
  const edges = factory.graph.edges.flatMap((e) => ends(e.from).flatMap((from) => ends(e.to).map((to) => ({ ...e, from, to }))));
  return { stations: out.map((s) => (s.code === undefined ? Object.fromEntries(Object.entries(s).filter(([k]) => k !== 'code')) : s)), edges };
}

/**
 * Everything that can be checked without building geometry: schema, references, catalog types,
 * every op of every station (dry plan), ports, edges and layout. Never throws.
 */
export function checkFactory(registry, data) {
  try {
    const expanded = expandFactory(registry, data);
    const timing = lineTiming(registry, expanded.line, { ctx: expanded.ctx, conventions: expanded.conventions });
    return { ok: true, errors: [], warnings: factoryWarnings(data), expanded, timing };
  } catch (error) {
    if (error instanceof FactoryError && error.issues.length) return { ok: false, errors: error.issues, warnings: [] };
    return { ok: false, errors: [{ path: '(compile)', message: error.message }], warnings: [] };
  }
}

/**
 * What is valid but not finished: every placeholder machine (a genericMachine, the IR keyword of
 * Claude.md §6.5) is listed, so the line runs while the reviewer and the owner see what still stands
 * in for a real machine. [{ path, message }]
 */
export function factoryWarnings(data) {
  const warnings = [];
  (data?.stations ?? []).forEach((station, i) => (station.equipment ?? []).forEach((e, j) => {
    if (e.type !== 'genericMachine') return;
    const what = e.params?.name ? `"${e.params.name}"` : 'a machine';
    warnings.push({
      path: `stations[${i}].equipment[${j}]`,
      message: `station "${station.id}": "${e.id}" is a placeholder for ${what} (genericMachine); replace it with a catalog machine or a composite`,
    });
  }));
  return warnings;
}
