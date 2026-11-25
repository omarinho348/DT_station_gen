// Machine routines ("recipes" in code; Phase 13): a machine's standard process, written and tested
// once in its component file (`recipes` in the component contract, lib/registry.js), so an agent picks
// one and sets a few args instead of composing ops itself. The benchmark (Phase 12) showed the Builder
// failing on exactly that: which machine an op drives, motion names and values, decision branches.
//
// A routine call is one entry in a process list:
//   { use: 'm1.fillUnit', seconds: 4 }            machine id . routine name, plus the routine's args
// expandRecipes() turns every such entry (decision branches included) into the plain ops it stands for,
// so factory.json, the compiler, the reviewer, the Editor and SimPy see ordinary ops only.
//
// Generic: nothing here names a component (rule 6); the routines live with their components.

import { reachPose, reachNeeded, workPlaceOf } from './station/reach.js';
import { midWork } from './station/stationSpec.js';

export class RecipeError extends Error {}

/**
 * A place arg ("machine.port") as the ops take it: { machine, port, offset? }. A conveyor's "work"
 * where it has no work port is its middle, as the station runtime has it (input port + offset).
 */
function placeOf(registry, text, station, ctx) {
  const [machine, port] = text.split('.');
  const m = station.machines.find((x) => x.id === machine);
  const spec = m ? registry.componentSpec(m.type, m.params ?? {}, ctx) : null;
  if (port === 'work' && spec && !spec.ports?.work) {
    const mid = midWork(spec);
    if (mid) return { machine, port: mid.port, offset: mid.offset };
  }
  return { machine, port };
}

/** A routine call's id: "machineId.routine". */
export const USE_PATTERN = /^([a-z][a-zA-Z0-9]*)\.([a-z][a-zA-Z0-9]*)$/;

/** The routines of a component type ({} when it has none or is unknown). */
export function recipesOf(registry, type) {
  try {
    return registry.getComponent(type).recipes ?? {};
  } catch {
    return {};
  }
}

/** Does the product have what a routine needs (its routines, features, facts)? */
export function productFits(productDef, needs = {}) {
  if (!productDef) return true;
  const has = (kind, name) => (kind === 'routines' ? productDef.routines?.[name] : kind === 'features' ? productDef.features?.[name] : productDef.facts?.[name]);
  return Object.entries(needs).every(([kind, names]) => (names ?? []).every((n) => Boolean(has(kind, n))));
}

/**
 * What a station arg may name. kind machine: the station machines of the wanted categories that have
 * every wanted motion (their ids). kind place: "machine.port" for every port of another machine that
 * carries what the rule wants (default unit); a conveyor's work place counts even where it has no work
 * port (a plain belt's middle, as lib/station/stationSpec.js gives it).
 * `machines`: [{ id, type, params? }]; `ctx`: build context (belt height); `exclude`: the routine's own machine.
 */
export function candidatesFor(registry, rule, machines, ctx = {}, { exclude = null } = {}) {
  const others = machines.filter((m) => m.id !== exclude);
  if (rule.kind === 'place') {
    const carries = rule.carries ?? 'unit';
    const out = [];
    for (const m of others) {
      let def;
      let spec;
      try { def = registry.getComponent(m.type); spec = registry.componentSpec(m.type, m.params ?? {}, ctx); } catch { continue; }
      if (rule.categories?.length && !rule.categories.includes(def.category)) continue;
      const ports = Object.entries(spec.ports ?? {}).filter(([, p]) => p.carries === carries).map(([name]) => name);
      const conveying = ['conveyor', 'transport'].includes(def.category);
      if (conveying && !ports.includes('work') && ports.length) ports.unshift('work');
      out.push(...ports.map((p) => `${m.id}.${p}`));
    }
    return out;
  }
  return others.filter((m) => {
    let def;
    try { def = registry.getComponent(m.type); } catch { return false; }
    if (rule.categories?.length && !rule.categories.includes(def.category)) return false;
    if (!rule.motions?.length) return true;
    try {
      const motions = registry.componentSpec(m.type, m.params ?? {}, ctx).motions ?? {};
      return rule.motions.every((x) => x in motions);
    } catch {
      return false;
    }
  }).map((m) => m.id);
}

/**
 * The routines a station can use: one entry per (machine, routine) whose product needs are met.
 * → [{ use, machine, type, name, def }]
 */
export function stationRecipes(registry, machines, { productDef = null } = {}) {
  const out = [];
  for (const m of machines) {
    for (const [name, def] of Object.entries(recipesOf(registry, m.type))) {
      if (!productFits(productDef, def.productNeeds)) continue;
      out.push({ use: `${m.id}.${name}`, machine: m.id, type: m.type, name, def });
    }
  }
  return out;
}

/** The required and optional arg keys of a zod object (optional ones: those that accept undefined). */
function argKeys(schema) {
  return Object.entries(schema.shape ?? {}).map(([k, s]) => (s.safeParse(undefined).success ? `${k}?` : k));
}

/**
 * One line per component routine, for an agent's prompt (stable: it changes only with the library):
 *   "<type>.fillUnit(seconds?, liquid?, supply?) — Fill the unit at the work place…"
 * The machine part is the component type; in a station the call uses the machine's id.
 */
export function recipeLines(registry) {
  const lines = [];
  for (const def of [...registry.components()].sort((a, b) => a.type.localeCompare(b.type))) {
    for (const [name, r] of Object.entries(def.recipes ?? {})) {
      const station = Object.entries(r.stationArgs ?? {}).map(([k, v]) => (v.optional ? `${k}?` : k));
      lines.push(`${def.type}.${name}(${[...argKeys(r.args), ...station].join(', ')}) — ${r.summary}`);
    }
  }
  return lines;
}

/** The max length of a (possibly optional / defaulted) zod string, or null. */
function maxLengthOf(schema) {
  let s = schema;
  for (let i = 0; i < 4 && s && typeof s.maxLength !== 'number' && typeof s.unwrap === 'function'; i += 1) s = s.unwrap();
  return typeof s?.maxLength === 'number' ? s.maxLength : null;
}

/**
 * Expands one routine call into its ops. Throws RecipeError naming the problem (an unknown machine
 * or routine, args out of range, a station arg naming the wrong kind of machine).
 *   station: { conveyor, machines: [{ id, type, params?, position?, rotationY? }] }
 *   unit: the measured unit (lib/station/unit.js), for routines that fit to it
 */
export function expandCall(registry, call, station, { ctx = {}, productDef = null, unit = null } = {}) {
  const m = USE_PATTERN.exec(call.use ?? '');
  if (!m) throw new RecipeError(`use "${call.use}": write it as machineId.routine`);
  const [, machineId, name] = m;
  const machine = station.machines.find((x) => x.id === machineId);
  if (!machine) throw new RecipeError(`use "${call.use}": "${machineId}" is no machine of this station (${station.machines.map((x) => x.id).join(', ')})`);
  const recipes = recipesOf(registry, machine.type);
  const def = recipes[name];
  if (!def) {
    const known = Object.keys(recipes);
    throw new RecipeError(`use "${call.use}": a ${machine.type} has no routine "${name}"${known.length ? ` (its routines: ${known.join(', ')})` : ' (it has none: write its ops instead)'}`);
  }
  if (!productFits(productDef, def.productNeeds)) throw new RecipeError(`use "${call.use}": the product lacks what this routine needs (${JSON.stringify(def.productNeeds)})`);
  const { use, ...rest } = call;
  const stationKeys = Object.keys(def.stationArgs ?? {});
  const plain = Object.fromEntries(Object.entries(rest).filter(([k]) => !stationKeys.includes(k)));
  // Text args over their length are shortened at a word, not refused: strict mode drops maxLength, so
  // the model can't see the limit (benchmark step 13.3: a 5-times refused task label).
  for (const [k, v] of Object.entries(plain)) {
    const max = maxLengthOf(def.args.shape?.[k]);
    if (typeof v === 'string' && max && v.length > max) plain[k] = v.slice(0, max + 1).replace(/\s+\S*$/, '').slice(0, max) || v.slice(0, max);
  }
  const parsed = def.args.safeParse(plain);
  if (!parsed.success) throw new RecipeError(`use "${call.use}": ${parsed.error.issues.map((i) => `${i.path.join('.') || '(args)'}: ${i.message}`).join('; ')}`);
  const args = { ...parsed.data };
  for (const [key, rule] of Object.entries(def.stationArgs ?? {})) {
    const given = rest[key];
    if (given === undefined || given === null) {
      if (!rule.optional) throw new RecipeError(`use "${call.use}": "${key}" is needed (${rule.about ?? 'a machine of the station'})`);
      continue;
    }
    const ok = candidatesFor(registry, rule, station.machines, ctx, { exclude: machineId });
    if (!ok.includes(given)) throw new RecipeError(`use "${call.use}": "${key}" must name ${rule.about ?? (rule.kind === 'place' ? 'a place of the station' : 'a fitting machine of the station')}${ok.length ? ` (here: ${ok.join(', ')})` : ' and the station has none: add one, or leave it out'}`);
    args[key] = rule.kind === 'place' ? placeOf(registry, given, station, ctx) : given;
  }
  let spec;
  try {
    spec = registry.componentSpec(machine.type, machine.params ?? {}, ctx);
  } catch (error) {
    throw new RecipeError(`use "${call.use}": ${error.message}`);
  }
  // Where it stands, and for a reach-in tool how far it must go to touch the unit at the work place.
  const place = machine.position ? { position: machine.position, rotationY: machine.rotationY ?? 0 } : null;
  let reachTo = null;
  if (place && unit && station.conveyor) {
    const conveyor = station.machines.find((x) => x.id === station.conveyor);
    if (conveyor?.position) reachTo = reachNeeded(reachPose(registry, machine, ctx), unit, workPlaceOf(registry, conveyor, ctx));
  }
  const ops = def.ops({ machine: machineId, args, spec, station, place, unit, reachTo, ctx });
  if (!Array.isArray(ops) || !ops.every((o) => o && typeof o.op === 'string')) throw new RecipeError(`routine ${machine.type}.${name} returned no op list (a library bug)`);
  return structuredClone(ops);
}

/**
 * Replaces every routine call in an op list (decision branches included) with the ops it stands for.
 * Returns { ops, problems }: problems as "path: message" for the agent (nothing thrown).
 */
export function expandRecipes(registry, list, station, { ctx = {}, productDef = null, unit = null, path = 'process' } = {}) {
  const problems = [];
  const walk = (items, at) => {
    if (!Array.isArray(items)) return items;
    const out = [];
    for (const [i, entry] of items.entries()) {
      if (entry && typeof entry === 'object' && typeof entry.use === 'string' && entry.op === undefined) {
        try {
          out.push(...walk(expandCall(registry, entry, station, { ctx, productDef, unit }), `${at}[${i}]`));
        } catch (error) {
          if (!(error instanceof RecipeError)) throw error;
          problems.push(`${at}[${i}]: ${error.message}`);
        }
        continue;
      }
      if (entry && typeof entry === 'object' && entry.op === 'decide') {
        const cases = Object.fromEntries(Object.entries(entry.cases ?? {}).map(([k, v]) => [k, walk(v, `${at}[${i}].cases.${k}`)]));
        out.push({ ...entry, cases, ...(entry.otherwise ? { otherwise: walk(entry.otherwise, `${at}[${i}].otherwise`) } : {}) });
        continue;
      }
      out.push(entry);
    }
    return out;
  };
  const ops = walk(list, path);
  return { ops, problems };
}
