// The registry: the one place components, ops and products are declared.
// The compiler, runtime and agents only ever talk to a registry, never to a component by name
// (Claude.md §3 rule 6). Adding a component touches only lib/components/** and nothing else.
import { z } from 'zod';
import { DEFAULT_BUILD_CONTEXT } from './core/conventions.js';

const fn = (what) => z.custom((v) => typeof v === 'function', { message: `${what} must be a function` });
const zodObject = z.custom((v) => v instanceof z.ZodObject, { message: 'params must be a z.object(...)' });
const camelId = z.string().regex(/^[a-z][a-zA-Z0-9]*$/, 'use camelCase, e.g. myMachine');

export const COMPONENT_CATEGORIES = [
  'conveyor', 'robot', 'machine', 'fixture', 'station', // named components
  'frame', 'axis', 'tool', 'transport', 'buffer', // basic building blocks (Phase 6)
];
/** floor-standing, over / beside the conveyor, or a tool carried on a robot's flange. */
export const MOUNTS = ['overConveyor', 'besideConveyor', 'floor', 'tool'];

/** A motion takes either a normalised number in `range` or one of `values`. Ops decide timing. */
const MotionSpec = z.union([
  z.object({ range: z.tuple([z.number(), z.number()]), default: z.number().optional() }).strict(),
  z.object({ values: z.array(z.string()).min(2), default: z.string().optional() }).strict(),
]);

/** A typed point where product enters, is worked on, or leaves (component-local metres). */
const PortSpec = z.object({
  position: z.tuple([z.number(), z.number(), z.number()]),
  direction: z.enum(['in', 'out', 'work']),
  carries: z.enum(['unit', 'batch', 'case', 'pallet']),
});
const Ports = z.record(camelId, PortSpec);

const ComponentDef = z.object({
  type: camelId,
  category: z.enum(COMPONENT_CATEGORIES),
  summary: z.string().min(10).max(200),
  params: zodObject,
  footprint: fn('footprint'),
  mount: z.enum(MOUNTS),
  /** Ports may depend on params and context: ports(params, ctx) → { name: PortSpec }. */
  ports: z.union([Ports, fn('ports')]).default({}),
  /**
   * Motions may depend on params: motions(params, ctx) → { name: MotionSpec }. Ranges are in
   * the motion's own unit (normalised 0–1, metres in the component frame, radians…).
   */
  motions: z.union([z.record(camelId, MotionSpec), fn('motions')]).default({}),
  /** Live data shown on the component (screens, counters): { name: { schema, sample } }. */
  displays: z.record(camelId, z.object({ schema: zodObject, sample: z.record(z.string(), z.unknown()) })).default({}),
  ops: z.array(camelId).default([]),
  /** How far the component may reach below y = 0 (e.g. a floor coating flush with the floor). */
  sinks: z.number().min(0).max(0.05).default(0),
  build: fn('build'),
});

const OpDef = z.object({
  op: camelId,
  summary: z.string().min(10).max(200),
  args: zodObject,
  needs: z.object({ machineOp: camelId.optional() }).default({}),
  duration: fn('duration'),
  expand: fn('expand'),
});

const ProductDef = z.object({
  type: camelId,
  summary: z.string().min(10).max(200),
  params: zodObject,
  stages: z.array(camelId).min(1),
  refs: z.array(camelId).default([]),
  build: fn('build'),
});

const Footprint = z.object({
  x: z.tuple([z.number(), z.number()]).refine(([a, b]) => a < b, 'x: min must be < max'),
  z: z.tuple([z.number(), z.number()]).refine(([a, b]) => a < b, 'z: min must be < max'),
  height: z.number().positive(),
  /** Lowest point (default 0). Below 0 only for tools hanging from a flange or floor coatings. */
  bottom: z.number().max(0).default(0),
});
const Motions = z.record(camelId, MotionSpec);

export class RegistryError extends Error {}

export function createRegistry() {
  const components = new Map();
  const ops = new Map();
  const products = new Map();

  function define(map, kind, schema, key, def) {
    const parsed = schema.safeParse(def);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
      throw new RegistryError(`Invalid ${kind} "${def?.[key] ?? '?'}": ${issues}`);
    }
    const id = parsed.data[key];
    if (map.has(id)) throw new RegistryError(`Duplicate ${kind} "${id}"`);
    map.set(id, Object.freeze(parsed.data));
    return parsed.data;
  }

  function getComponent(type) {
    const def = components.get(type);
    if (!def) throw new RegistryError(`Unknown component type "${type}"`);
    return def;
  }

  /**
   * Builds one component instance. `params` are validated and completed with defaults.
   * ctx: { materials, ...line conventions (defaults from DEFAULT_BUILD_CONTEXT) }. Returns
   * { type, params, footprint, ports, root, motions, state, set(name, value), dispose() }.
   */
  function buildComponent(type, params = {}, userCtx = {}) {
    const def = getComponent(type);
    const ctx = { ...DEFAULT_BUILD_CONTEXT, ...userCtx };
    const parsed = def.params.safeParse(params);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new RegistryError(`Invalid params for "${type}": ${issues}`);
    }
    const p = parsed.data;
    const footprint = Footprint.parse(def.footprint(p, ctx));
    const portsParsed = Ports.safeParse(typeof def.ports === 'function' ? def.ports(p, ctx) : def.ports);
    if (!portsParsed.success) throw new RegistryError(`"${type}" ports: ${portsParsed.error.issues[0].message}`);
    const ports = portsParsed.data;
    const motionsParsed = Motions.safeParse(typeof def.motions === 'function' ? def.motions(p, ctx) : def.motions);
    if (!motionsParsed.success) throw new RegistryError(`"${type}" motions: ${motionsParsed.error.issues[0].message}`);
    const motions = motionsParsed.data;
    const built = def.build({ ...ctx, params: p });
    if (!built?.root?.isObject3D) throw new RegistryError(`"${type}".build() must return { root, motions }`);

    const declaredByKind = { motions, displays: def.displays };
    for (const kind of ['motions', 'displays']) {
      const declared = Object.keys(declaredByKind[kind]);
      const provided = Object.keys(built[kind] ?? {});
      const missing = declared.filter((m) => !provided.includes(m));
      const extra = provided.filter((m) => !declared.includes(m));
      if (missing.length || extra.length) {
        throw new RegistryError(`"${type}" ${kind} mismatch (missing: ${missing.join(', ') || '-'}; undeclared: ${extra.join(', ') || '-'})`);
      }
    }

    built.root.name ||= type;
    built.root.userData.component = type;
    const state = {};
    const shared = new Set(Object.values(ctx.materials ?? {}));

    const instance = {
      type,
      params: p,
      footprint,
      ports,
      root: built.root,
      motions,
      state,
      /** Drive a motion: a number inside its range, or one of its values. */
      set(name, value) {
        const spec = motions[name];
        if (!spec) throw new RegistryError(`"${type}" has no motion "${name}"`);
        if (spec.range) {
          const [lo, hi] = spec.range;
          if (typeof value !== 'number' || Number.isNaN(value) || value < lo - 1e-9 || value > hi + 1e-9) {
            throw new RegistryError(`"${type}".${name} expects a number in [${lo}, ${hi}], got ${value}`);
          }
        } else if (!spec.values.includes(value)) {
          throw new RegistryError(`"${type}".${name} expects one of ${spec.values.join(' | ')}, got ${value}`);
        }
        built.motions[name](value);
        state[name] = value;
      },
      displays: def.displays,
      /** Show data on a display (validated against its schema). */
      show(name, data) {
        const spec = def.displays[name];
        if (!spec) throw new RegistryError(`"${type}" has no display "${name}"`);
        const parsed = spec.schema.safeParse(data);
        if (!parsed.success) {
          throw new RegistryError(`"${type}".${name} display: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
        }
        built.displays[name](parsed.data);
      },
      /** Frees geometry and the materials this instance made itself (shared ones stay). */
      dispose() {
        built.root.removeFromParent();
        built.root.traverse((o) => {
          o.geometry?.dispose();
          for (const m of [o.material].flat()) {
            if (m && !shared.has(m)) {
              m.map?.dispose();
              m.dispose();
            }
          }
        });
      },
    };
    // Start every motion at its declared default (or the start of its range / first value).
    for (const [name, spec] of Object.entries(motions)) {
      instance.set(name, spec.default ?? (spec.range ? spec.range[0] : spec.values[0]));
    }
    // Displays start with their sample content (a screen is never blank in the gallery).
    for (const [name, spec] of Object.entries(def.displays)) instance.show(name, spec.sample);
    return instance;
  }

  return {
    defineComponent: (def) => define(components, 'component', ComponentDef, 'type', def),
    defineOp: (def) => define(ops, 'op', OpDef, 'op', def),
    defineProduct: (def) => define(products, 'product', ProductDef, 'type', def),
    getComponent,
    getOp: (op) => ops.get(op) ?? null,
    getProduct: (type) => products.get(type) ?? null,
    components: () => [...components.values()],
    ops: () => [...ops.values()],
    products: () => [...products.values()],
    buildComponent,
  };
}

/**
 * Editable fields of a params schema, for the gallery sliders, catalog.json and the tests:
 * [{ key, kind: 'number' | 'integer' | 'boolean' | 'enum', min, max, step, default, options, label }]
 */
export function paramFields(paramsSchema) {
  const json = z.toJSONSchema(paramsSchema);
  return Object.entries(json.properties ?? {}).map(([key, prop]) => {
    const field = { key, label: prop.description ?? key, default: prop.default };
    if (prop.enum) return { ...field, kind: 'enum', options: prop.enum };
    if (prop.type === 'boolean') return { ...field, kind: 'boolean' };
    if (prop.type === 'string') return { ...field, kind: 'string', maxLength: prop.maxLength, pattern: prop.pattern };
    if (prop.type === 'integer' || prop.type === 'number') {
      const kind = prop.type;
      const min = prop.minimum ?? prop.exclusiveMinimum;
      const max = prop.maximum ?? prop.exclusiveMaximum;
      const step = kind === 'integer' ? 1 : niceStep(min, max);
      return { ...field, kind, min, max, step };
    }
    return { ...field, kind: 'other' };
  });
}

function niceStep(min, max) {
  if (min === undefined || max === undefined) return 0.01;
  const raw = (max - min) / 100;
  const pow = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw);
}

/**
 * Parameter sets to test a component with: all defaults, all minimums, all maximums
 * (booleans flipped, enums at first / last option).
 */
export function paramSamples(paramsSchema) {
  const fields = paramFields(paramsSchema);
  const pick = (which) =>
    Object.fromEntries(
      fields.map((f) => {
        if (which === 'default') return [f.key, f.default];
        if (f.kind === 'boolean') return [f.key, which === 'max' ? !f.default : f.default];
        if (f.kind === 'enum') return [f.key, which === 'min' ? f.options[0] : f.options.at(-1)];
        if (f.kind === 'number' || f.kind === 'integer') return [f.key, which === 'min' ? f.min : f.max];
        return [f.key, f.default];
      }),
    );
  return { default: pick('default'), min: pick('min'), max: pick('max') };
}

/** The app-wide registry. lib/components/index.js fills it. */
export const registry = createRegistry();
export const { defineComponent, defineOp, defineProduct } = registry;
