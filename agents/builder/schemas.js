// The Builder's answer schemas (Claude.md §7.2: one station at a time, three phases), built per call
// from the registry and the station so far, so every answer is typed as exactly as it can be:
//
//   layoutSchema(registry)                  station name, shell, which machines (catalog types) and where,
//                                           as placement hints (never coordinates: lib/station/place.js
//                                           turns hints into positions), the ops it will use
//   machinesSchema(registry, equipment)     each machine's params, typed by its own component schema
//   processSchema(registry, { ops, machines })  intake / process / output as op lists, each op typed by its
//                                           own args; machine and conveyor args limited to the station's ids;
//                                           ops nested in a decision use the same op list
//
// Each returns { name, schema (strict, for Structured Outputs), decode(answer) → IR shape, encode(IR) →
// answer shape }. Nothing here names a component or an op (rule 6): types and ops come from the registry.
import { z } from 'zod';
import { toStrict } from '../strict.js';

const ID = '^[a-z][a-zA-Z0-9]*$';

/** Placement hints the layout phase gives instead of coordinates (station frame: flow +X, walkway +Z). */
export const PLACES = Object.freeze({
  line: 'the station conveyor itself, along X through the station origin',
  overLine: 'straddling the station conveyor (a portal, tunnel, lift, gantry), centred on it',
  besideLine: 'right next to the conveyor, against its edge (side: equipment −Z by default, or walkway)',
  rear: 'behind the line on the equipment side (−Z), with a walk-around gap',
  front: 'on the walkway side (+Z): operator panels, monitors',
  upstream: 'in line before the conveyor start (feeds it)',
  downstream: 'in line after the conveyor end (takes from it)',
  onTop: 'resting on another machine (named in "on")',
});
/** Where along the line a hint applies: the conveyor's ports, or the whole length. */
export const ALONG = Object.freeze(['input', 'work', 'output', 'whole']);

const jsonOf = (schema) => z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });

/**
 * A shell's params as the layout phase may set them: only its labels and colour (string params). Its
 * geometry params keep the tuned defaults: set freely they made a shell's own furniture clash (benchmark
 * tuning set, step 12.2).
 */
function shellLabels(params) {
  const json = jsonOf(params);
  const keep = Object.entries(json.properties ?? {}).filter(([, p]) => p.type === 'string');
  return { ...json, properties: Object.fromEntries(keep), required: (json.required ?? []).filter((k) => keep.some(([n]) => n === k)) };
}

/**
 * Phase 1: the station's layout. The answer names the station, picks a shell (or none), lists the
 * machines by catalog type with a placement hint each, names the conveyor units travel on, and the
 * ops its process will use (the process phase is typed by exactly those).
 */
export function layoutSchema(registry, { product = null } = {}) {
  const types = registry.components().map((d) => d.type).sort();
  // Ops that need something of the product (parts, cables) only when the product has it.
  const productDef = product ? registry.getProduct(product) : null;
  const has = (need) => (productDef?.[need]?.length ?? 0) > 0;
  const ops = registry.ops().filter((d) => !productDef || (d.needs?.product ?? []).every(has)).map((d) => d.op).sort();
  const shells = registry.shells();
  const source = {
    type: 'object',
    properties: {
      id: { type: 'string', pattern: ID, description: 'Station id, camelCase (e.g. capping)' },
      code: { type: 'string', maxLength: 8, description: 'Short code on the HMI, e.g. ST3' },
      title: { type: 'string', description: 'Station function, at most 40 characters' },
      shell: {
        description: 'Shared furniture preset (slab, fence, station conveyor, lifts, sign, HMI, stack light), or null for none',
        anyOf: shells.map((d) => ({
          type: 'object',
          properties: { type: { const: d.type }, params: shellLabels(d.params) },
          required: ['type', 'params'],
        })),
      },
      equipment: {
        type: 'array',
        description: 'The station\'s own machines (not the shell\'s), in the order they matter to the process',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', pattern: ID, description: 'camelCase, unique in the station' },
            type: { type: 'string', enum: types, description: 'Catalog component type' },
            why: { type: 'string', description: 'One short phrase: what it does here' },
            place: { type: 'string', enum: Object.keys(PLACES), description: Object.entries(PLACES).map(([k, v]) => `${k}: ${v}`).join('; ') },
            at: { type: 'string', enum: ALONG, description: 'Where along the line: at the conveyor\'s input, work or output port, or along the whole' },
            on: { type: 'string', pattern: ID, description: 'For place onTop: the id of the machine it rests on' },
            side: { type: 'string', enum: ['equipment', 'walkway'], description: 'For place besideLine: which edge of the conveyor (default equipment, −Z)' },
            turned: { type: 'boolean', description: 'For place besideLine: turned to run away from the line (a reject lane), else along it' },
          },
          required: ['id', 'type', 'why', 'place', 'at'],
        },
      },
      conveyor: { type: 'string', pattern: ID, description: 'Id of the conveyor units travel on through the station (the shell\'s, if a shell has one, or one of the equipment)' },
      ports: {
        type: 'array',
        description: 'Extra station ports beyond input / work / output (those default to the conveyor\'s), e.g. a reject port on a reject lane\'s output',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', pattern: ID, description: 'Station port name, e.g. reject' },
            machine: { type: 'string', pattern: ID, description: 'The machine whose port it is' },
            port: { type: 'string', pattern: ID, description: 'That machine\'s port name (see its detail)' },
            direction: { type: 'string', enum: ['in', 'out'] },
          },
          required: ['name', 'machine', 'port', 'direction'],
        },
      },
      ops: { type: 'array', items: { type: 'string', enum: ops }, description: 'The ops the process will use beyond its machines\' routines (routines need no listing; the process phase can use only these ops); often none' },
    },
    required: ['id', 'title', 'equipment', 'conveyor', 'ops'],
  };
  if (!shells.length) delete source.properties.shell;
  return { name: 'stationLayout', ...toStrict(source) };
}

/**
 * Phase 2: the machines' params. One property per machine id, typed by that machine's component
 * params (ranges, enums, defaults dropped: a null leaves the default); each type defined once.
 * @param {{ id: string, type: string }[]} equipment  the layout's machines
 */
export function machinesSchema(registry, equipment) {
  // Each type's params once (in $defs), each machine a reference: many machines of a type cost no more.
  const properties = {};
  const $defs = {};
  for (const e of equipment) {
    const def = registry.getComponent(e.type);
    $defs[e.type] ??= { ...jsonOf(def.params), description: `${e.type}: ${def.summary}` };
    properties[e.id] = { $ref: `#/$defs/${e.type}` };
  }
  const source = { type: 'object', properties: { params: { type: 'object', properties, required: equipment.map((e) => e.id) } }, required: ['params'], $defs };
  return { name: 'stationMachines', ...toStrict(source) };
}

/** Is this schema node a loose nested op entry ({ op } plus anything)? Then it becomes the op union. */
const isOpEntry = (s) => s && s.type === 'object' && Object.keys(s.properties ?? {}).join() === 'op' && s.additionalProperties && typeof s.additionalProperties === 'object';

/**
 * Replaces nested op entries with a reference to the union, limits machine / conveyor args to the
 * station's ids (machine: those that have what the op needs) and item args to the station's items.
 */
function shapeOpArgs(node, { machines, conveyors = machines, items = null }) {
  if (!node || typeof node !== 'object') return node;
  if (isOpEntry(node)) return { $ref: '#/$defs/op' };
  if (Array.isArray(node)) return node.map((n) => shapeOpArgs(n, { machines, conveyors, items }));
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === 'properties') {
      out.properties = Object.fromEntries(Object.entries(v).map(([name, p]) => {
        const list = name === 'machine' ? machines : name === 'conveyor' ? conveyors : name === 'item' ? items : null;
        const limit = list?.length && p.type === 'string';
        return [name, limit ? { ...p, pattern: undefined, enum: list } : shapeOpArgs(p, { machines, conveyors, items })];
      }).map(([name, p]) => [name, Object.fromEntries(Object.entries(p).filter(([, x]) => x !== undefined))]));
    } else {
      out[k] = shapeOpArgs(v, { machines, conveyors, items });
    }
  }
  return out;
}

/** The machines an op can drive: all of them, or those with the named op / every motion it needs. */
function machinesFor(def, machines, info) {
  const needs = def.needs ?? {};
  if (!info || (!needs.machineOp && !needs.motions?.length && !needs.valueMotion)) return machines;
  const fit = machines.filter((m) => {
    const i = info[m];
    if (!i) return true;
    if (needs.machineOp && !i.ops.includes(needs.machineOp)) return false;
    if (needs.valueMotion && !(i.valueMotions ?? []).length) return false;
    return (needs.motions ?? []).every((x) => i.motions.includes(x));
  });
  return fit.length ? fit : machines; // none fits: the checks will say why
}

/**
 * A routine call as a union branch: { use: "machine.routine", ...its args, ...its station args }.
 * Station args are limited to the station machines that fit (`candidates`); an optional one with no
 * candidate is left out.
 */
function recipeBranch({ use, def, candidates = {} }) {
  const args = jsonOf(def.args);
  const station = {};
  const required = [...(args.required ?? [])];
  for (const [key, rule] of Object.entries(def.stationArgs ?? {})) {
    const list = candidates[key] ?? [];
    if (!list.length) continue;
    station[key] = { type: 'string', enum: list, description: rule.about ?? 'a machine of the station' };
    if (!rule.optional) required.push(key);
  }
  return {
    type: 'object',
    description: `Routine: ${def.summary}`,
    properties: { use: { const: use }, ...(args.properties ?? {}), ...station },
    required: ['use', ...required],
  };
}

/**
 * Phase 3: the process. intake / output may be null (the defaults: convey from the input port to the
 * work place and on to the output port); process is the station's own steps. Each step is a routine
 * of one of the station's machines ({ use: "machine.routine", args }: the machine's standard process,
 * lib/recipes.js) or one of `ops`, typed by its args; steps a decision runs are the same union.
 * @param {object} o
 * @param {string[]} o.ops       the ops the layout phase chose
 * @param {string[]} o.machines  every equipment id of the station (shell's included)
 * @param {object} [o.info]      { id: { ops, motions } } per machine (its component's ops and motions)
 * @param {string[]} [o.items]   the items the station's ops can name (the unit is "product")
 * @param {object[]} [o.recipes] the station's routines: [{ use, def, candidates: { stationArg: [ids] } }]
 */
export function processSchema(registry, { ops, machines, info = null, items = null, recipes = [] }) {
  const routineBranches = recipes.map(recipeBranch);
  // Nothing to choose from at all would be an empty union: a wait keeps the schema valid (the checks
  // then say what is missing).
  const opNames = [...new Set(ops)];
  if (!opNames.length && !routineBranches.length) opNames.push('wait');
  const branches = opNames.map((op) => {
    const def = registry.getOp(op);
    if (!def) throw new Error(`unknown op "${op}"`);
    const args = shapeOpArgs(jsonOf(def.args), { machines: machinesFor(def, machines, info), conveyors: machines, items });
    return {
      type: 'object',
      description: def.summary,
      properties: { op: { const: op }, ...(args.properties ?? {}) },
      required: ['op', ...(args.required ?? [])],
    };
  });
  const list = (description) => ({ type: 'array', items: { $ref: '#/$defs/op' }, description });
  const source = {
    type: 'object',
    properties: {
      intake: list('Steps that bring a unit from the input port to the work place; null for the default'),
      process: list('The station\'s own steps on the unit at the work place: machine routines first, ops for what no routine covers'),
      output: list('Steps that take the finished unit to the output port; null for the default'),
      inputStage: { type: 'string', description: 'The product stage units arrive in (one of the product\'s stages), or null' },
    },
    required: ['process'],
    $defs: { op: { anyOf: [...routineBranches, ...branches] } },
  };
  return { name: 'stationProcess', ...toStrict(source) };
}
