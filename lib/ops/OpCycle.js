// The interface ops expand into. An op never touches a sequencer, a mesh or a component directly:
// it asks an OpCycle to queue steps, drive motions, carry items and read facts.
//
// Two modes, same expansion code:
//   run  steps go on a StepSequencer; their callbacks drive real component instances.
//   dry  steps are only recorded (no geometry). Used for durations, takt checks and SimPy, so
//        a timing table always adds up from exactly the steps the twin plays.
//
// While expanding, the cycle keeps the PLANNED state: the value every motion will have once the
// steps queued so far have run, and where each item will be. Ops read it to work out distances
// and durations; at run time each step still starts from the instance's actual state.
//
// Named ops aim at points on the product (a part's seat, a screw hole), which are only known once
// the product is in place. They give such targets as functions, resolved when their step starts
// (run mode). Their planned value is UNKNOWN in both modes, so dry and run durations stay equal;
// such steps therefore need a fixed time, not a speed.
import * as THREE from 'three';
import { CONVENTIONS } from '../core/conventions.js';
import { clamp01, smoother, trapezoidTravel } from '../core/motion.js';

export class OpError extends Error {}

const Y_AXIS = new THREE.Vector3(0, 1, 0);

/** Planned value of a motion after a decision whose branches disagree on it. */
export const UNKNOWN = Symbol('unknown');

/** A value of a periodic motion brought back into its range (values already in range stay as they are). */
export function wrapValue(value, [lo, hi]) {
  if (value >= lo && value <= hi) return value;
  const period = hi - lo;
  return lo + ((((value - lo) % period) + period) % period);
}

/** Shortest signed step from `from` to `to` on a periodic motion with range [lo, hi]. */
export function wrapDelta(from, to, [lo, hi]) {
  const period = hi - lo;
  let d = (((to - from) % period) + period) % period;
  if (d > period / 2) d -= period;
  return d;
}

const EASE = {
  smooth: smoother,
  linear: clamp01,
};

export class OpCycle {
  /**
   * @param {object} o
   * @param {object} o.registry      registry with the ops (and components) defined
   * @param {'run'|'dry'} [o.mode]
   * @param {object} o.equipment     { id: component instance } (run) or { id: componentSpec } (dry)
   * @param {object} [o.sequencer]   StepSequencer (run mode)
   * @param {object} [o.product]     the product instance being worked on (run mode)
   * @param {object|string[]} [o.items] { name: Object3D | product instance } (run) or known names (dry)
   * @param {object} [o.facts]       { name: value | () => value }: what `decide` can branch on
   * @param {string} [o.workState]   cycle state used when an op gives none
   * @param {object} [o.state]       dry mode: starting motion values { id: { motion: value } }
   * @param {object} [o.at]          starting item locations { item: { machine, port } }
   * @param {object} [o.conventions] line conventions (conveyor speed and ramp…)
   * @param {object} [o.productSpec] { stages, refs, parts } of the product (default: from `product`)
   * @param {Function} [o.restock] (names | null) → puts stock items back (run mode, `replenish`)
   * @param {Function} [o.setStatus] (patch) → live status values for the HMI (run mode)
   * @param {object} [o.ctx]        build context for items made during the process (materials…)
   * @param {object} [o.stacks]     { specs: { name: spec }, slot(name), place(name, object), clear(name) }
   * @param {Function} [o.onSpawn]  (product instance) → the station keeps items made during the process
   */
  constructor({
    registry, mode = 'run', equipment = {}, sequencer = null, product = null, items = {}, facts = {},
    workState = 'WORKING', state = {}, at = {}, conventions = CONVENTIONS, productSpec = null, restock = null, setStatus = null,
    ctx = {}, stacks = null, onSpawn = null,
  }) {
    if (mode !== 'run' && mode !== 'dry') throw new OpError(`mode must be "run" or "dry", got "${mode}"`);
    if (mode === 'run' && !sequencer) throw new OpError('run mode needs a sequencer');
    this.registry = registry;
    this.mode = mode;
    this.equipment = equipment;
    this.sequencer = sequencer;
    this.product = product;
    this.items = items;
    this.facts = facts;
    this.workState = workState;
    this.initialState = state;
    this.conventions = conventions;
    this.restock = restock;
    this.setStatus = setStatus ?? (() => {});
    this.ctx = ctx;
    this.stacks = stacks;
    this.onSpawn = onSpawn;
    /** Items made during the process: name → product type (known when planned) / instance (once made). */
    this.spawnTypes = new Map();
    this.spawned = new Map();
    this.productSpec = productSpec ?? (product?.stages ? { stages: product.stages, refs: product.refs ?? [], parts: product.parts ?? [], features: product.features ?? {}, cables: product.cables ?? [], cableRoute: product.cableRoute, routines: product.routines ?? {}, payloads: product.payloads ?? [] } : null);
    this.plannedValues = new Map();
    this.plannedAt = new Map(Object.entries(at));
    this.attachments = new Map();
    this.steps = [];
    this.time = 0;
    this.where = [];
  }

  get dry() {
    return this.mode === 'dry';
  }

  get productStages() {
    return this.productSpec?.stages ?? null;
  }

  // ---- Expansion -------------------------------------------------------------------------------

  /** Expands a list of ops `[{ op, ...args }]` into steps, in order. Returns the cycle. */
  expand(ops, scope = null) {
    if (!Array.isArray(ops)) this.fail('ops must be a list');
    if (scope) this.where.push(scope);
    ops.forEach((entry, i) => this.expandOne(entry, i));
    if (scope) this.where.pop();
    return this;
  }

  expandOne(entry, index) {
    const { op, ...args } = entry ?? {};
    this.where.push(`op #${index + 1}${op ? ` (${op})` : ''}`);
    const def = typeof op === 'string' ? this.registry.getOp(op) : null;
    if (!def) {
      const known = this.registry.ops().map((d) => d.op).join(', ');
      this.fail(typeof op === 'string' ? `unknown op "${op}" (ops: ${known})` : 'missing "op"');
    }
    const parsed = def.args.safeParse(args);
    if (!parsed.success) {
      this.fail(parsed.error.issues.map((i) => `${i.path.join('.') || '(args)'}: ${i.message}`).join('; '));
    }
    def.expand(this, parsed.data);
    this.where.pop();
  }

  fail(message) {
    throw new OpError(this.where.length ? `${this.where.join(' › ')}: ${message}` : message);
  }

  /** Queues one step. Run mode: on the sequencer. Both modes: recorded in `steps`. */
  queue(state, label, duration, status = {}, callbacks = {}) {
    if (!(duration >= 0) || !Number.isFinite(duration)) this.fail(`step "${label}" has an invalid duration ${duration}`);
    this.steps.push({ state, label, duration });
    this.time += duration;
    if (!this.dry) this.sequencer.queue(state, label, duration, status, callbacks);
  }

  /** A dry copy with the same planned state, for looking ahead (decision branches). */
  fork() {
    const f = new OpCycle({
      registry: this.registry, mode: 'dry', equipment: this.equipment, items: this.dry ? this.items : Object.keys(this.items),
      workState: this.workState, conventions: this.conventions, productSpec: this.productSpec,
    });
    f.readActual = (id, motion) => this.planned(id, motion);
    f.spawnTypes = new Map(this.spawnTypes);
    f.stacks = this.stacks ? { specs: this.stacks.specs } : null;
    f.facts = this.dry ? this.facts : {};
    f.ctx = this.ctx;
    f.plannedValues = new Map(this.plannedValues);
    f.plannedAt = new Map(this.plannedAt);
    f.where = [...this.where];
    return f;
  }

  // ---- Equipment and motions ---------------------------------------------------------------------

  /** The component instance (run) or spec (dry) with id `id`. */
  machine(id) {
    const entry = this.equipment[id];
    if (!entry) this.fail(`unknown machine "${id}" (machines: ${Object.keys(this.equipment).join(', ') || 'none'})`);
    return entry;
  }

  specOf(id) {
    return this.machine(id);
  }

  motionSpec(id, motion) {
    const spec = this.specOf(id).motions?.[motion];
    if (!spec) this.fail(`machine "${id}" has no motion "${motion}" (motions: ${Object.keys(this.specOf(id).motions ?? {}).join(', ') || 'none'})`);
    return spec;
  }

  hasMotion(id, motion) {
    return Boolean(this.specOf(id).motions?.[motion]);
  }

  /** Throws a clear error unless `value` is allowed for the motion (wrapping motions take any number). */
  checkValue(id, motion, value) {
    const spec = this.motionSpec(id, motion);
    if (spec.values) {
      if (!spec.values.includes(value)) this.fail(`machine "${id}".${motion} takes ${spec.values.join(' | ')}, got "${value}"`);
      return;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) this.fail(`machine "${id}".${motion} takes a number, got ${value}`);
    const [lo, hi] = spec.range;
    if (!spec.wrap && (value < lo - 1e-9 || value > hi + 1e-9)) {
      this.fail(`machine "${id}".${motion} must stay in [${round(lo)}, ${round(hi)}], got ${round(value)}`);
    }
  }

  readActual(id, motion) {
    if (!this.dry) return this.machine(id).state[motion];
    const spec = this.motionSpec(id, motion);
    return this.initialState[id]?.[motion] ?? spec.default ?? (spec.range ? spec.range[0] : spec.values[0]);
  }

  /** The value `motion` will have once the steps queued so far have run (or UNKNOWN). */
  planned(id, motion) {
    const key = `${id}.${motion}`;
    if (this.plannedValues.has(key)) return this.plannedValues.get(key);
    this.motionSpec(id, motion);
    return this.readActual(id, motion);
  }

  plan(id, motion, value) {
    this.plannedValues.set(`${id}.${motion}`, value);
  }

  /** Run mode: sets a motion now and moves everything attached to that machine with it. */
  drive(id, motion, value) {
    const spec = this.motionSpec(id, motion);
    const v = spec.wrap ? wrapValue(value, spec.range) : value;
    this.machine(id).set(motion, v);
    this.refreshAttached(id);
  }

  /**
   * Queues one step that moves several range motions of one machine together.
   *   to: { motion: absolute target }   (periodic motions take the short way)
   *   by: { motion: relative amount }   (periodic motions may go round many times)
   * Duration: `seconds`, or the largest change / `speed` (+ `ramp` for a trapezoid profile).
   * A `to` target may be a function, resolved when the step starts (see the header).
   * `ease`: { motion: (progress) => 0…1 } overrides the profile for single motions.
   * `onStart` / `onUpdate(progress)` / `onEnd` run alongside (run mode).
   * `alongside`: [{ machine, to }] absolute moves of other machines in the same step, same ease.
   */
  queueMotions({ machine, to = {}, by = {}, alongside = [], seconds, speed, ramp, profile = 'smooth', ease: easeFor = {}, state, label, status = {}, onStart, onUpdate, onEnd }) {
    this.machine(machine);
    const moves = [];
    for (const [motion, target] of Object.entries(to)) {
      const spec = this.motionSpec(machine, motion);
      if (!spec.range) this.fail(`machine "${machine}".${motion} is a switch (${spec.values.join(' | ')}); use toolOn`);
      if (typeof target === 'function') {
        if (seconds === undefined) this.fail(`machine "${machine}".${motion}: a target worked out at run time needs a fixed time (seconds), not a speed`);
        moves.push({ machine, motion, spec, kind: 'to', target, delta: 0, lazy: true });
        this.plan(machine, motion, UNKNOWN);
        continue;
      }
      this.checkValue(machine, motion, target);
      const from = this.planned(machine, motion);
      const span = spec.range[1] - spec.range[0];
      // From an unknown value the move is planned at its worst case: the whole range.
      const delta = from === UNKNOWN ? (spec.wrap ? span / 2 : span) : spec.wrap ? wrapDelta(from, target, spec.range) : target - from;
      moves.push({ machine, motion, spec, kind: 'to', target, delta });
      this.plan(machine, motion, spec.wrap ? wrapValue(target, spec.range) : target);
    }
    for (const other of alongside) {
      if (other.machine === machine) this.fail(`"alongside" names the step's own machine "${machine}"; put those motions in "to"`);
      this.machine(other.machine);
      for (const [motion, target] of Object.entries(other.to ?? {})) {
        const spec = this.motionSpec(other.machine, motion);
        if (!spec.range) this.fail(`machine "${other.machine}".${motion} is a switch (${spec.values.join(' | ')}); use toolOn`);
        this.checkValue(other.machine, motion, target);
        const from = this.planned(other.machine, motion);
        const span = spec.range[1] - spec.range[0];
        const delta = from === UNKNOWN ? (spec.wrap ? span / 2 : span) : spec.wrap ? wrapDelta(from, target, spec.range) : target - from;
        moves.push({ machine: other.machine, motion, spec, kind: 'to', target, delta });
        this.plan(other.machine, motion, spec.wrap ? wrapValue(target, spec.range) : target);
      }
    }
    for (const [motion, amount] of Object.entries(by)) {
      if (motion in to) this.fail(`motion "${motion}" is in both "to" and "by"`);
      const spec = this.motionSpec(machine, motion);
      if (!spec.range) this.fail(`machine "${machine}".${motion} is a switch (${spec.values.join(' | ')}); use toolOn`);
      const from = this.planned(machine, motion);
      if (from === UNKNOWN) {
        if (!spec.wrap) this.fail(`machine "${machine}".${motion}: a relative move needs a known start (it depends on an earlier decision)`);
      } else {
        if (!spec.wrap) this.checkValue(machine, motion, from + amount);
        this.plan(machine, motion, spec.wrap ? wrapValue(from + amount, spec.range) : from + amount);
      }
      moves.push({ machine, motion, spec, kind: 'by', delta: amount });
    }
    if (!moves.length) this.fail('nothing to move (give "to" or "by")');

    const longest = Math.max(...moves.map((m) => Math.abs(m.delta)));
    let duration;
    if (seconds !== undefined) duration = seconds;
    else if (profile === 'trapezoid') duration = longest / speed + (ramp ?? this.conventions.conveyor.ramp);
    else duration = longest / speed;
    const rampTime = ramp ?? this.conventions.conveyor.ramp;
    const ease = profile === 'trapezoid'
      ? (p) => (longest > 0 ? trapezoidTravel(p * duration, longest, speed, rampTime) / longest : p)
      : EASE[profile];

    let live = [];
    const stepLabel = label ?? `Moving ${machine}`;
    this.queue(state ?? this.workState, stepLabel, duration, status, {
      onStart: () => {
        // Start from where the machine actually is; aim at the planned (or now resolved) target.
        live = moves.map((m) => {
          const from = this.machine(m.machine).state[m.motion];
          let target = m.target;
          if (m.lazy) {
            target = m.target();
            if (!Number.isFinite(target)) throw new OpError(`step "${stepLabel}": machine "${machine}".${m.motion} target is ${target}`);
            const [lo, hi] = m.spec.range;
            if (m.spec.wrap) target = wrapValue(target, m.spec.range);
            else if (target < lo - 1e-9 || target > hi + 1e-9) {
              throw new OpError(`step "${stepLabel}": machine "${machine}" cannot reach ${m.motion} = ${round(target)} (range [${round(lo)}, ${round(hi)}])`);
            }
          }
          const delta = m.kind === 'by' ? m.delta : m.spec.wrap ? wrapDelta(from, target, m.spec.range) : target - from;
          return { ...m, target, from, delta, ease: easeFor[m.motion] ?? ease };
        });
        onStart?.();
      },
      onUpdate: (progress) => {
        for (const m of live) {
          const value = progress >= 1 && m.kind === 'to' ? m.target : m.from + m.delta * m.ease(progress);
          this.drive(m.machine, m.motion, value);
        }
        onUpdate?.(progress);
      },
      onEnd,
    });
    return duration;
  }

  // ---- Items, attachments, facts -----------------------------------------------------------------

  /** Names an item can have: 'product', station items, payloads of the product, items made so far. */
  knownItems() {
    const station = Array.isArray(this.items) ? this.items : Object.keys(this.items);
    return ['product', ...station, ...(this.productSpec?.payloads ?? []), ...this.spawnTypes.keys()];
  }

  /**
   * Checks an item name; run mode returns its Object3D. 'product' is the unit being worked on; a
   * payload name is that part of it (taken off as an item of its own); an item made during the
   * process (spawn) is known once planned and exists once its step has started (null before).
   */
  item(name) {
    if (!this.knownItems().includes(name)) this.fail(`unknown item "${name}" (items: ${this.knownItems().join(', ')})`);
    if (this.dry) return null;
    const target = this.resolveItem(name);
    if (!target) {
      if (this.spawnTypes.has(name)) return null; // made later in the cycle
      this.fail(name === 'product' ? 'no product at this station' : `item "${name}" is not there`);
    }
    return target.isObject3D ? target : target.root;
  }

  resolveItem(name) {
    if (name === 'product') return this.product;
    if (this.spawned.has(name)) return this.spawned.get(name);
    if (!Array.isArray(this.items) && this.items[name]) return this.items[name];
    if (this.product?.payloads?.includes(name)) return this.product.payload(name);
    return null;
  }

  /** The product instance behind an item (something with stages), or a clear error. */
  productItem(name) {
    this.item(name);
    if (this.dry) return null;
    const target = this.resolveItem(name);
    if (!target && this.spawnTypes.has(name)) return null; // made later in the cycle
    if (!target || typeof target.setStage !== 'function') this.fail(`item "${name}" is not a product with stages`);
    return target;
  }

  /** What is known about a product item without building it: { refs, features, routines, … } or null. */
  itemSpec(name) {
    if (name === 'product') return this.productSpec;
    const type = this.spawnTypes.get(name);
    return type ? this.registry.getProduct(type) : null;
  }

  /** Planning: an item of a catalog product type will be made under this name. */
  declareSpawn(name, type) {
    if (name === 'product') this.fail('"product" is the unit being worked on; give the new item another name');
    if (!this.registry.getProduct(type)) this.fail(`unknown product type "${type}" (products: ${this.registry.products().map((p) => p.type).join(', ')})`);
    this.spawnTypes.set(name, type);
  }

  /** Run mode: the item made under this name (the station keeps it). */
  spawnItem(name, instance) {
    this.spawned.set(name, instance);
    this.onSpawn?.(instance);
  }

  /** A stack of the station (cases on a pallet): its spec, or a clear error. */
  stackSpec(name) {
    const spec = this.stacks?.specs?.[name];
    if (!spec) this.fail(`unknown stack "${name}" (stacks: ${Object.keys(this.stacks?.specs ?? {}).join(', ') || 'none'})`);
    return spec;
  }

  checkAnchor(id, anchor) {
    const anchors = this.specOf(id).anchors ?? [];
    if (!anchors.includes(anchor)) this.fail(`machine "${id}" has no anchor "${anchor}" (anchors: ${anchors.join(', ') || 'none'})`);
  }

  /** Run mode: `object` keeps its pose relative to the machine's anchor from now on. */
  attach(object, id, anchor) {
    const frame = this.machine(id).anchor(anchor);
    frame.updateWorldMatrix(true, false);
    object.updateWorldMatrix(true, false);
    const offset = frame.matrixWorld.clone().invert().multiply(object.matrixWorld);
    this.attachments.set(object, { machine: id, frame, offset });
  }

  detach(object) {
    this.attachments.delete(object);
  }

  /** The pose of an attached item relative to its anchor (a Matrix4; run mode). */
  attachmentOffset(object) {
    return this.attachments.get(object)?.offset.clone() ?? null;
  }

  /** Changes how an attached item sits on its anchor (e.g. a part turned while carried). */
  setAttachmentOffset(object, offset) {
    const a = this.attachments.get(object);
    if (!a) throw new OpError('setAttachmentOffset: the item is not attached');
    a.offset.copy(offset);
    this.refreshAttached(a.machine);
  }

  /** Transform of a machine's anchor in the machine's own frame (run mode). */
  anchorInMachine(id, anchor) {
    const root = this.machine(id).root;
    const frame = this.machine(id).anchor(anchor);
    frame.updateWorldMatrix(true, false);
    return root.matrixWorld.clone().invert().multiply(frame.matrixWorld);
  }

  // ---- Frames (run mode) ---------------------------------------------------------------------

  /** Transform from `owner`'s frame (an Object3D) to machine `id`'s own frame. */
  machineFrom(id, owner) {
    const root = this.machine(id).root;
    owner.updateWorldMatrix(true, false);
    root.updateWorldMatrix(true, false);
    return root.matrixWorld.clone().invert().multiply(owner.matrixWorld);
  }

  /** A point given in `owner`'s frame, in machine `id`'s frame. */
  toMachine(id, owner, point) {
    return point.clone().applyMatrix4(this.machineFrom(id, owner));
  }

  /** A direction given in `owner`'s frame, in machine `id`'s frame. */
  directionToMachine(id, owner, direction) {
    return direction.clone().transformDirection(this.machineFrom(id, owner)).multiplyScalar(direction.length());
  }

  /** Turn about Y of `owner` seen from machine `id` (radians; both are upright). */
  yawToMachine(id, owner) {
    const x = new THREE.Vector3(1, 0, 0).transformDirection(this.machineFrom(id, owner));
    return Math.atan2(-x.z, x.x);
  }

  // ---- Product parts ---------------------------------------------------------------------------

  /** Checks a part name of the product; run mode returns the product's assembly interface. */
  assembly(part) {
    const parts = this.productSpec?.parts ?? [];
    if (!parts.length) this.fail('the product has no parts to assemble');
    if (part !== undefined && !parts.includes(part)) this.fail(`the product has no part "${part}" (parts: ${parts.join(', ')})`);
    if (this.dry) return null;
    if (!this.product?.assembly) this.fail('the product has no assembly interface');
    return this.product.assembly;
  }

  /** Items attached to a machine (run mode). */
  attachedTo(id) {
    return [...this.attachments].filter(([, a]) => a.machine === id).map(([object]) => object);
  }

  refreshAttached(id) {
    for (const [object, a] of this.attachments) {
      if (a.machine !== id) continue;
      a.frame.updateWorldMatrix(true, false);
      const world = a.frame.matrixWorld.clone().multiply(a.offset);
      let local = world;
      if (object.parent) {
        object.parent.updateWorldMatrix(true, false);
        local = object.parent.matrixWorld.clone().invert().multiply(world);
      }
      local.decompose(object.position, object.quaternion, object.scale);
      object.updateMatrixWorld(true);
    }
  }

  /** Where an item will be once the queued steps have run: { machine, port } or { machine, anchor }. */
  locationOf(item) {
    return this.plannedAt.get(item);
  }

  locate(item, where) {
    this.plannedAt.set(item, where);
  }

  /** A fact `decide` can branch on. Dry mode: UNKNOWN (all branches are looked at) unless given. */
  fact(name) {
    if (this.dry) return name in this.facts ? (typeof this.facts[name] === 'function' ? UNKNOWN : this.facts[name]) : UNKNOWN;
    if (!(name in this.facts)) this.fail(`unknown fact "${name}" (facts: ${Object.keys(this.facts).join(', ') || 'none'})`);
    const v = this.facts[name];
    return typeof v === 'function' ? v() : v;
  }

  /**
   * A place { machine, port, offset } in a common frame: the world (run mode) or the station frame
   * from each machine's placement (dry mode: spec.placement { position, rotationY }). Distances and
   * horizontal directions are the same in both, so dry durations equal played ones.
   */
  portPoint({ machine, port, offset = [0, 0, 0] }) {
    const local = this.portPosition(machine, port).add(new THREE.Vector3(...offset));
    if (!this.dry) {
      const root = this.machine(machine).root;
      root.updateWorldMatrix(true, false);
      return root.localToWorld(local);
    }
    const p = this.specOf(machine).placement ?? { position: [0, 0, 0], rotationY: 0 };
    return local.applyAxisAngle(Y_AXIS, p.rotationY ?? 0).add(new THREE.Vector3(...(p.position ?? [0, 0, 0])));
  }

  /** A machine's own +X direction in that common frame. */
  axisOf(machine) {
    if (!this.dry) {
      const root = this.machine(machine).root;
      root.updateWorldMatrix(true, false);
      return new THREE.Vector3(1, 0, 0).transformDirection(root.matrixWorld);
    }
    return new THREE.Vector3(1, 0, 0).applyAxisAngle(Y_AXIS, this.specOf(machine).placement?.rotationY ?? 0);
  }

  /** A port position in the machine's own frame, as a Vector3. */
  portPosition(id, port) {
    const ports = this.specOf(id).ports ?? {};
    if (!ports[port]) this.fail(`machine "${id}" has no port "${port}" (ports: ${Object.keys(ports).join(', ') || 'none'})`);
    return new THREE.Vector3(...ports[port].position);
  }
}

function round(v) {
  return Math.round(v * 1000) / 1000;
}

/**
 * Durations without geometry: expands `ops` on a dry cycle and returns { duration, steps, cycle }.
 * `equipment` maps ids to { type, params } (specs are made from the registry) or to ready specs.
 */
export function dryRun(registry, ops, { equipment = {}, ctx = {}, product = null, ...options } = {}) {
  const specs = Object.fromEntries(Object.entries(equipment).map(([id, e]) => [
    id, e.motions ? e : registry.componentSpec(e.type, e.params ?? {}, ctx),
  ]));
  // `product`: a product type; its stages, refs and parts are checked without building it.
  let productSpec = options.productSpec ?? null;
  if (product) {
    const def = registry.getProduct(product);
    if (!def) throw new OpError(`unknown product type "${product}"`);
    productSpec = { stages: def.stages, refs: def.refs, parts: def.parts, features: def.features, cables: def.cables, cableRoute: def.cableRoute, routines: def.routines, payloads: def.payloads };
  }
  const cycle = new OpCycle({ registry, mode: 'dry', equipment: specs, ...options, productSpec });
  cycle.expand(ops);
  return { duration: cycle.time, steps: cycle.steps, cycle };
}
