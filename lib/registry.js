// The registry: the one place components, ops and products are declared.
// The compiler, runtime and agents only ever talk to a registry, never to a component by name
// (Claude.md §3 rule 6). Adding a component touches only lib/components/** and nothing else.
import { z } from 'zod';
import { isAssetLoaded } from './core/assets.js';
import * as THREE from 'three';
import { DEFAULT_BUILD_CONTEXT } from './core/conventions.js';

const fn = (what) => z.custom((v) => typeof v === 'function', { message: `${what} must be a function` });
const zodObject = z.custom((v) => v instanceof z.ZodObject, { message: 'params must be a z.object(...)' });
const camelId = z.string().regex(/^[a-z][a-zA-Z0-9]*$/, 'use camelCase, e.g. myMachine');

export const COMPONENT_CATEGORIES = [
  'conveyor', 'robot', 'machine', 'fixture', 'station', // named components
  'frame', 'axis', 'tool', 'transport', 'buffer', // basic building blocks (Phase 6)
];
/**
 * floor-standing, over / beside the conveyor, a tool carried on a robot's flange, or resting on
 * another component's top (a container on a bench or shelf). y = 0 is the floor or that surface.
 */
export const MOUNTS = ['overConveyor', 'besideConveyor', 'floor', 'tool', 'surface'];

/**
 * A motion takes either a number in `range` or one of `values`. Ops decide timing.
 * `wrap`: the range is one period (an angle, a belt or roller phase), so ops may advance it past
 * the end and it wraps round, and moves take the short way. `travel`: metres of surface travel
 * per full range (a belt or roller), so a conveyor op can scroll it with the product it moves.
 * `angle`: radians the part turns per full range (a spindle or roller phase), so an op can ask
 * for whole turns without knowing the component's units.
 */
const MotionSpec = z.union([
  z.object({
    range: z.tuple([z.number(), z.number()]),
    default: z.number().optional(),
    wrap: z.boolean().optional(),
    travel: z.number().positive().optional(),
    angle: z.number().positive().optional(),
  }).strict(),
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
  /**
   * Named frames that move with the motions and can carry things (a robot's tool point, a
   * locating plate). anchors(params, ctx) → names, or a fixed list. build() returns
   * `anchors: { name: Object3D }`; an item attached to an anchor keeps its pose relative to it.
   */
  anchors: z.union([z.array(camelId), fn('anchors')]).default([]),
  /** How far the component may reach below y = 0 (e.g. a floor coating flush with the floor). */
  sinks: z.number().min(0).max(0.05).default(0),
  /** Model files in lib/assets/ it is built from (preloaded, see lib/core/assets.js); most have none. */
  assets: z.array(z.string().regex(/^[\w.-]+\.glb$/, 'a .glb file name in lib/assets/')).default([]),
  build: fn('build'),
});

const OpDef = z.object({
  op: camelId,
  summary: z.string().min(10).max(200),
  args: zodObject,
  // What the machine an op drives must offer: a named op (fill) or motions (state, progress); the
  // Builder's process schema offers each op only the machines that have them.
  // product: what the product must have (parts to assemble, cables to route); the layout phase offers
  // an op only for products that have it.
  // valueMotion: the machine needs an on/off (multi-value) motion.
  needs: z.object({ machineOp: camelId.optional(), motions: z.array(camelId).optional(), valueMotion: z.boolean().optional(), product: z.array(z.enum(['parts', 'cables'])).optional() }).default({}),
  /** Optional: when absent, the duration is the sum of the steps expand() queues (dry run). */
  duration: fn('duration').optional(),
  expand: fn('expand'),
});

/**
 * A product: what flows down the line. `stages` are its visual build states in line order,
 * `refs` named points in the product frame (grasp points, ports…), `parts` the separately
 * handled parts of an assembled product (each with kit / assembled poses).
 * build({ params, materials, … }) → { root, setStage(stage), refs: { name: () => Vector3 }, api?, assembly?, dispose? }
 *
 * A product with `parts` also returns `assembly`, the generic interface the assembly ops use
 * (all points in the product frame):
 *   origin()                 → Vector3   reference point heights are measured from (clearances)
 *   grip(part, mode)         → { point: Vector3, yaw }   where a gripper holds it in 'kit' / 'asm' pose
 *   pose(part, mode)         → Matrix4   the part's transform in that pose
 *   object(part)             → Object3D  the part itself (a gripper carries it)
 *   setPart(part, mode)      'hidden' | 'kit' | 'asm' | 'carried'
 *   screws(part)             → ids        screwSeat(id) → Vector3 (head seat, part assembled)
 *   setScrew(id, driven)
 *
 * `features`: single visual details an op may switch mid-process without a stage change (a belt
 * engaged, a cable stowed): { name: { values: [...] } }; build() returns features: { name(value) }.
 * `payloads` (optional): parts of a unit a station can take off it as items of their own (a printer
 * lifted off its work carrier into a carton): names; build() returns payloads: { name: Object3D }.
 * A payload no longer under the unit's root is no longer the unit's to dispose (its
 * root.userData.dispose frees it).
 * `facts` (optional): what is known about a unit that a station can decide on (a test verdict,
 * deterministic per serial): { name: { values } }; build() returns facts: { name() → value }.
 * `routines` (optional): things the product does by itself while a station drives it (a test
 * printer's firmware homing, probing, heating, printing): { name: { summary, args: z.object } };
 * build() returns routines: { name(args) → { start?(), update?(progress, previous) → status?, end?() → status? } }.
 * A station plays one per timed step (`runRoutine`); the returned status patches feed the HMI live.
 * `cables` (optional): cable names; static `cableRoute(name)` → { kind: 'loose' | 'attached',
 * a: { point, dir }, coil, clips: [Vector3], b: { point, dir, socket } } in the product frame; build()
 * returns harness: { setCable(name, { mode, grip?, passed? }) } with mode hidden | stowed | carryA |
 * pluggedA | routing | done (grip: product-frame point the connector is held at).
 * `copy({ part, mode, materials })` (optional, static): a free-standing copy of a part for stock
 * locations (a supermarket). → { object, grasp: { point, yaw } }: the object's origin is the point
 * it rests on, oriented as in `mode` ('kit' | 'asm'); grasp is the tool point in the object frame;
 * partFrame (Matrix4, optional) is the part's own frame in the object frame (so a copy can be put
 * exactly where the product's part goes).
 */
export const ASSEMBLY_API = ['origin', 'grip', 'pose', 'object', 'setPart', 'screws', 'screwSeat', 'setScrew'];
const ProductDef = z.object({
  type: camelId,
  summary: z.string().min(10).max(200),
  params: zodObject,
  stages: z.array(camelId).min(1),
  refs: z.array(camelId).default([]),
  parts: z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/)).default([]),
  features: z.record(camelId, z.object({ values: z.array(z.string().min(1)).min(2) })).default({}),
  copy: fn('copy').optional(),
  cables: z.array(z.string().min(1)).default([]),
  cableRoute: fn('cableRoute').optional(),
  routines: z.record(camelId, z.object({ summary: z.string().min(5).max(200), args: zodObject })).default({}),
  facts: z.record(camelId, z.object({ values: z.array(z.string().min(1)).min(1) })).default({}),
  payloads: z.array(camelId).default([]),
  /** Model files in lib/assets/ it is built from (a GLB product): a list, or assets(params) → list. Preloaded with preloadComponentAssets. */
  assets: z.union([z.array(z.string().regex(/^[\w.-]+\.glb$/, 'a .glb file name in lib/assets/')), fn('assets')]).default([]),
  build: fn('build'),
}).refine((d) => !d.cables.length || d.cableRoute, { message: 'a product with cables needs cableRoute(name)', path: ['cableRoute'] });

/**
 * A station shell: the furniture every station of a kind shares (floor slab, fence, station
 * conveyor, lifts, sign, HMI, stack light), as one preset with its own params. A station in
 * factory.json names a shell and lists only its own machines; the compiler expands the shell
 * without knowing a component by name (rule 6).
 * build(params, ctx) → { equipment: [{ id, type, params, position, rotationY }],
 *                        station: { conveyor, ports?, signals? } }   (station-local metres)
 */
const ShellDef = z.object({
  type: camelId,
  summary: z.string().min(10).max(200),
  params: zodObject,
  build: fn('build'),
});
const ShellEquipment = z.object({
  id: camelId,
  type: camelId,
  params: z.record(z.string(), z.unknown()).default({}),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotationY: z.number().default(0),
});
const ShellResult = z.object({
  equipment: z.array(ShellEquipment).min(1),
  station: z.object({ conveyor: camelId }).passthrough(),
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

export const CABLE_MODES = ['hidden', 'stowed', 'carryA', 'pluggedA', 'routing', 'done'];

function cableRouteOf(def, type, name) {
  if (!def.cables.includes(name)) throw new RegistryError(`Product "${type}" has no cable "${name}" (cables: ${def.cables.join(', ') || 'none'})`);
  return def.cableRoute(name);
}

export function createRegistry() {
  const components = new Map();
  const ops = new Map();
  const products = new Map();
  const shells = new Map();

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
   * What a component instance will expose, without building any geometry:
   * { type, params, footprint, ports, motions, anchors }. Used by buildComponent and by the
   * timing calculator (dry runs of ops need motion ranges and port positions only).
   */
  function componentSpec(type, params = {}, userCtx = {}) {
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
    const motionsParsed = Motions.safeParse(typeof def.motions === 'function' ? def.motions(p, ctx) : def.motions);
    if (!motionsParsed.success) throw new RegistryError(`"${type}" motions: ${motionsParsed.error.issues[0].message}`);
    const anchorsParsed = z.array(camelId).safeParse(typeof def.anchors === 'function' ? def.anchors(p, ctx) : def.anchors);
    if (!anchorsParsed.success) throw new RegistryError(`"${type}" anchors: ${anchorsParsed.error.issues[0].message}`);
    return { type, params: p, footprint, ports: portsParsed.data, motions: motionsParsed.data, anchors: anchorsParsed.data, ctx };
  }

  /**
   * Builds one component instance. `params` are validated and completed with defaults.
   * ctx: { materials, ...line conventions (defaults from DEFAULT_BUILD_CONTEXT) }. Returns
   * { type, params, footprint, ports, root, motions, state, set(name, value), dispose() }.
   */
  function buildComponent(type, params = {}, userCtx = {}) {
    const def = getComponent(type);
    const { params: p, footprint, ports, motions, anchors, ctx } = componentSpec(type, params, userCtx);
    const missingAssets = def.assets.filter((name) => !isAssetLoaded(name));
    if (missingAssets.length) throw new RegistryError(`"${type}" needs its model loaded first (${missingAssets.join(', ')}): await preloadComponentAssets(registry) from lib/core/assets.js`);
    const built = def.build({ ...ctx, params: p });
    if (!built?.root?.isObject3D) throw new RegistryError(`"${type}".build() must return { root, motions }`);

    const declaredByKind = { motions, displays: def.displays, anchors: Object.fromEntries(anchors.map((a) => [a, true])) };
    for (const kind of ['motions', 'displays', 'anchors']) {
      const declared = Object.keys(declaredByKind[kind]);
      const provided = Object.keys(built[kind] ?? {});
      const missing = declared.filter((m) => !provided.includes(m));
      const extra = provided.filter((m) => !declared.includes(m));
      if (missing.length || extra.length) {
        throw new RegistryError(`"${type}" ${kind} mismatch (missing: ${missing.join(', ') || '-'}; undeclared: ${extra.join(', ') || '-'})`);
      }
    }

    for (const name of anchors) {
      if (!built.anchors[name]?.isObject3D) throw new RegistryError(`"${type}" anchor "${name}" must be an Object3D`);
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
      anchors,
      state,
      /** A named frame that moves with the motions (see `anchors` in the component contract). */
      anchor(name) {
        if (!anchors.includes(name)) throw new RegistryError(`"${type}" has no anchor "${name}"`);
        return built.anchors[name];
      },
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
      /** Frees geometry and the materials this instance made itself (shared ones stay: the library's, and cached model assets'). */
      dispose() {
        built.root.removeFromParent();
        built.root.traverse((o) => {
          if (!o.geometry?.userData.shared) o.geometry?.dispose();
          for (const m of [o.material].flat()) {
            if (m && !shared.has(m) && !m.userData.shared) {
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

  function getProductDef(type) {
    const def = products.get(type);
    if (!def) throw new RegistryError(`Unknown product type "${type}"`);
    return def;
  }

  /**
   * Builds one product unit at its first stage. Returns
   * { type, params, stages, stage, root, setStage(stage), ref(name), api, dispose() }.
   */
  function buildProduct(type, params = {}, userCtx = {}) {
    const def = getProductDef(type);
    const ctx = { ...DEFAULT_BUILD_CONTEXT, ...userCtx };
    const parsed = def.params.safeParse(params);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new RegistryError(`Invalid params for product "${type}": ${issues}`);
    }
    const needs = productAssets(def, parsed.data).filter((name) => !isAssetLoaded(name));
    if (needs.length) throw new RegistryError(`Product "${type}" needs its model loaded first (${needs.join(', ')}): await loadAsset() / preloadComponentAssets(registry) from lib/core/assets.js`);
    const built = def.build({ ...ctx, params: parsed.data });
    if (!built?.root?.isObject3D || typeof built.setStage !== 'function') {
      throw new RegistryError(`Product "${type}".build() must return { root, setStage, refs }`);
    }
    const provided = Object.keys(built.refs ?? {});
    const missing = def.refs.filter((r) => !provided.includes(r));
    const extra = provided.filter((r) => !def.refs.includes(r));
    if (missing.length || extra.length) {
      throw new RegistryError(`Product "${type}" refs mismatch (missing: ${missing.join(', ') || '-'}; undeclared: ${extra.join(', ') || '-'})`);
    }
    const featureNames = Object.keys(def.features);
    const builtFeatures = Object.keys(built.features ?? {});
    if (featureNames.some((f) => !builtFeatures.includes(f)) || builtFeatures.some((f) => !featureNames.includes(f))) {
      throw new RegistryError(`Product "${type}" features mismatch (declared: ${featureNames.join(', ') || '-'}; built: ${builtFeatures.join(', ') || '-'})`);
    }
    for (const name of def.payloads) {
      if (!built.payloads?.[name]?.isObject3D) throw new RegistryError(`Product "${type}" payload "${name}" must be an Object3D in build().payloads`);
    }
    const factNames = Object.keys(def.facts);
    const builtFacts = Object.keys(built.facts ?? {});
    if (factNames.some((f) => !builtFacts.includes(f)) || builtFacts.some((f) => !factNames.includes(f))) {
      throw new RegistryError(`Product "${type}" facts mismatch (declared: ${factNames.join(', ') || '-'}; built: ${builtFacts.join(', ') || '-'})`);
    }
    const routineNames = Object.keys(def.routines);
    const builtRoutines = Object.keys(built.routines ?? {});
    if (routineNames.some((r) => !builtRoutines.includes(r)) || builtRoutines.some((r) => !routineNames.includes(r))) {
      throw new RegistryError(`Product "${type}" routines mismatch (declared: ${routineNames.join(', ') || '-'}; built: ${builtRoutines.join(', ') || '-'})`);
    }
    if (def.cables.length && typeof built.harness?.setCable !== 'function') {
      throw new RegistryError(`Product "${type}" has cables, so build() must return harness { setCable }`);
    }
    if (def.parts.length) {
      const missingApi = ASSEMBLY_API.filter((k) => typeof built.assembly?.[k] !== 'function');
      if (missingApi.length) throw new RegistryError(`Product "${type}" has parts, so build() must return assembly { ${missingApi.join(', ')} }`);
    }
    built.root.userData.product = type;
    const instance = {
      type,
      params: parsed.data,
      stages: def.stages,
      parts: def.parts,
      refs: def.refs,
      stage: null,
      /** Generic assembly interface (products with parts only), see ASSEMBLY_API. */
      assembly: built.assembly ?? null,
      root: built.root,
      api: built.api ?? {},
      setStage(stage) {
        if (!def.stages.includes(stage)) throw new RegistryError(`Product "${type}" has no stage "${stage}" (stages: ${def.stages.join(', ')})`);
        built.setStage(stage);
        instance.stage = stage;
        instance.featureState = {};
      },
      features: def.features,
      featureState: {},
      routines: def.routines,
      payloads: def.payloads,
      /** A part that can be taken off the unit as an item of its own (see `payloads`). */
      payload(name) {
        if (!def.payloads.includes(name)) throw new RegistryError(`Product "${type}" has no payload "${name}" (payloads: ${def.payloads.join(', ') || 'none'})`);
        return built.payloads[name];
      },
      /** Facts a station can decide on: { name: () → value } (see `facts`). */
      facts: Object.fromEntries(Object.keys(def.facts).map((name) => [name, () => built.facts[name]()])),
      /** A routine run: args validated (defaults filled) → { start, update, end } (see `routines`). */
      routine(name, args = {}) {
        const spec = def.routines[name];
        if (!spec) throw new RegistryError(`Product "${type}" has no routine "${name}" (routines: ${Object.keys(def.routines).join(', ') || 'none'})`);
        const parsed = spec.args.safeParse(args);
        if (!parsed.success) throw new RegistryError(`Product "${type}" routine "${name}": ${parsed.error.issues.map((i) => `${i.path.join('.') || '(args)'}: ${i.message}`).join('; ')}`);
        return built.routines[name](parsed.data);
      },
      cables: def.cables,
      /** Static route of a cable (product frame), see `cables`. */
      cableRoute: (name) => cableRouteOf(def, type, name),
      /** Cable state: where its ends are and how far it is laid. */
      setCable(name, state) {
        cableRouteOf(def, type, name);
        if (!CABLE_MODES.includes(state?.mode)) throw new RegistryError(`Product "${type}" cable mode must be ${CABLE_MODES.join(' | ')}, got "${state?.mode}"`);
        built.harness.setCable(name, state);
      },
      /** Switch one visual detail (see `features`); a stage change resets them all. */
      setFeature(name, value) {
        const spec = def.features[name];
        if (!spec) throw new RegistryError(`Product "${type}" has no feature "${name}" (features: ${Object.keys(def.features).join(', ') || 'none'})`);
        if (!spec.values.includes(value)) throw new RegistryError(`Product "${type}" feature "${name}" takes ${spec.values.join(' | ')}, got "${value}"`);
        built.features[name](value);
        instance.featureState[name] = value;
      },
      /** A named point in the product frame (a fresh Vector3). */
      ref(name) {
        if (!def.refs.includes(name)) throw new RegistryError(`Product "${type}" has no ref "${name}"`);
        return built.refs[name]();
      },
      dispose() {
        built.root.removeFromParent();
        built.dispose?.();
      },
    };
    instance.setStage(def.stages[0]);
    return instance;
  }

  /**
   * Expands a shell preset: params validated and completed with defaults; every piece of
   * equipment must be a known component type. Returns { type, params, equipment, station }.
   */
  function expandShell(type, params = {}, userCtx = {}) {
    const def = shells.get(type);
    if (!def) throw new RegistryError(`Unknown shell type "${type}" (shells: ${[...shells.keys()].join(', ') || 'none'})`);
    const parsed = def.params.safeParse(params);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new RegistryError(`Invalid params for shell "${type}": ${issues}`);
    }
    const out = ShellResult.safeParse(def.build(parsed.data, { ...DEFAULT_BUILD_CONTEXT, ...userCtx }));
    if (!out.success) throw new RegistryError(`Shell "${type}".build(): ${out.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    for (const e of out.data.equipment) getComponent(e.type);
    if (!out.data.equipment.some((e) => e.id === out.data.station.conveyor)) {
      throw new RegistryError(`Shell "${type}": its station conveyor "${out.data.station.conveyor}" is not in its equipment`);
    }
    return { type, params: parsed.data, equipment: out.data.equipment, station: out.data.station };
  }

  /** A free-standing copy of a product part for a stock location (see `copy` in ProductDef). */
  function partCopy(type, part, mode = 'kit', userCtx = {}) {
    const def = getProductDef(type);
    if (!def.copy) throw new RegistryError(`Product "${type}" has no part copies`);
    if (!def.parts.includes(part)) throw new RegistryError(`Product "${type}" has no part "${part}" (parts: ${def.parts.join(', ')})`);
    if (mode !== 'kit' && mode !== 'asm') throw new RegistryError(`part copy mode must be "kit" or "asm", got "${mode}"`);
    const copy = def.copy({ ...DEFAULT_BUILD_CONTEXT, ...userCtx, part, mode });
    if (!copy?.object?.isObject3D || !copy.grasp?.point?.isVector3) throw new RegistryError(`Product "${type}".copy() must return { object, grasp: { point, yaw } }`);
    copy.object.userData.grasp = { point: copy.grasp.point.clone(), yaw: copy.grasp.yaw ?? 0 };
    copy.object.userData.partCopy = { product: type, part, mode };
    copy.object.userData.partFrame = copy.partFrame?.clone() ?? new THREE.Matrix4();
    return copy;
  }

  return {
    partCopy,
    defineComponent: (def) => define(components, 'component', ComponentDef, 'type', def),
    defineOp: (def) => define(ops, 'op', OpDef, 'op', def),
    defineProduct: (def) => define(products, 'product', ProductDef, 'type', def),
    defineShell: (def) => define(shells, 'shell', ShellDef, 'type', def),
    getShell: (type) => shells.get(type) ?? null,
    shells: () => [...shells.values()],
    expandShell,
    getComponent,
    componentSpec,
    getOp: (op) => ops.get(op) ?? null,
    getProduct: (type) => products.get(type) ?? null,
    buildProduct,
    components: () => [...components.values()],
    ops: () => [...ops.values()],
    products: () => [...products.values()],
    buildComponent,
  };
}

/**
 * Editable fields of a params schema, for the gallery sliders, catalog.json and the tests:
 * [{ key, kind: 'number' | 'integer' | 'boolean' | 'enum' | 'string' | 'numberList', min, max, step, default, options, label }]
 * (numberList keeps its default in the min / max samples: a list has no single extreme.)
 */
export function paramFields(paramsSchema) {
  const json = z.toJSONSchema(paramsSchema);
  return Object.entries(json.properties ?? {}).map(([key, prop]) => {
    const field = { key, label: prop.description ?? key, default: prop.default };
    if (prop.enum) return { ...field, kind: 'enum', options: prop.enum };
    if (prop.type === 'boolean') return { ...field, kind: 'boolean' };
    if (prop.type === 'string') return { ...field, kind: 'string', maxLength: prop.maxLength, pattern: prop.pattern };
    if (prop.type === 'array' && ['number', 'integer'].includes(prop.items?.type)) {
      return { ...field, kind: 'numberList', minItems: prop.minItems, maxItems: prop.maxItems, min: prop.items.minimum, max: prop.items.maximum };
    }
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

/** The model files a product needs for these params (its `assets`: a list or a function of the params). */
export function productAssets(def, params) {
  return typeof def.assets === 'function' ? def.assets(params) : def.assets ?? [];
}

/** The app-wide registry. lib/components/index.js fills it. */
export const registry = createRegistry();
export const { defineComponent, defineOp, defineProduct, defineShell } = registry;
