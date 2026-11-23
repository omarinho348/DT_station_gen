// Process controller of one station, for any station written as data (lib/station/stationSpec.js).
// Generic port of the reference AssemblyCycle: a timed step queue plus the station's typed ports.
//
//   ports.input.take()     → a unit to work on, or null (then the station waits)
//   ports.input.available() → is a unit waiting? (looked at before the `prepare` ops, nothing taken)
//   ports.output.ready()   → may the finished unit leave now? (false = back-pressure)
//   ports.output.put(u)    ← the unit as it reaches the output port
//
// Stand-alone, a station feeds itself (a new unit at the stage it expects rises from the return
// line at the input port) and retires its output down to the return line. A line replaces the
// ports to chain stations (connectPorts); nothing else in the station changes.
//
// Each unit: intake ops → process ops → 'Process complete' → (wait for room) → output ops → put.
// All three phases are plain op lists expanded on one OpCycle per unit, so the dry plan
// (planStation) has exactly the steps the twin plays. A process that leaves the unit at another
// output port of the station (a reject lane) hands it over there instead of running the output; a
// process that leaves the unit on one of the station's stacks (a case palletized) is done with it there.
import { Box3, Matrix4, Vector3 } from 'three';
import { OpCycle, OpError, dryRun } from '../ops/index.js';
import { StepSequencer } from '../core/StepSequencer.js';
import { smoother } from '../core/motion.js';
import { CONVENTIONS } from '../core/conventions.js';
import { StationError, parseStation, portMismatch, resolvePorts, stationPhases } from './stationSpec.js';
import { buildConnections, connectionProblems } from './connections.js';
import { createBatch, planIndexing } from './indexing.js';
import { batchOffsets, memberNames } from './batchSpec.js';
import { sensorProblems } from './sensorSpec.js';

const DISPLAY_REFRESH_SECONDS = 0.1;

export const STATION_STATES = Object.freeze({
  IDLE: 'IDLE', INFEED: 'INFEED', OUTPUT: 'OUTPUT', WAITING: 'WAITING', HOLDING: 'HOLDING', ALARM: 'ALARM',
});

const BEACON_MODES = ['off', 'run', 'wait', 'alarm'];

export class StationCycle {
  /**
   * @param {object} o
   * @param {object} o.registry     registry with components, ops and products
   * @param {object} o.station      station data (stationSpec.js)
   * @param {object} o.equipment    { id: component instance } (already placed under `root`)
   * @param {object} o.root         the station's frame (Object3D); units are kept under it
   * @param {object} [o.product]    { type, params } of the product (stand-alone feed, dry checks)
   * @param {Function} [o.createProduct] ({ serial, stage }) → product instance (default: from `product`)
   * @param {object} [o.ctx]        build context for products (materials…)
   * @param {Function} [o.facts]    (unit) → { name: value | () => value } for `decide` (serial is always there)
   * @param {object} [o.conventions]
   * @param {Function} [o.onUpdate] (cycle) after every update
   */
  constructor({ registry, station, equipment, root, product = null, createProduct = null, ctx = {}, facts = null, conventions = CONVENTIONS, onUpdate = null }) {
    this.registry = registry;
    this.station = parseStation(station);
    this.equipment = equipment;
    this.root = root;
    // The station's own unit type wins over the line product (cases packed upstream).
    if (this.station.unit) product = this.station.unit;
    this.productDef = product;
    this.ctx = ctx;
    this.extraFacts = facts;
    this.conventions = conventions;
    this.onUpdate = onUpdate;
    this.createProductFn = createProduct ?? (product ? ({ serial, stage }) => {
      const unit = registry.buildProduct(product.type, { ...product.params, serial }, ctx);
      if (stage) unit.setStage(stage);
      return unit;
    } : null);

    // Where every machine stands (a reset puts back the ones ops carried away).
    this.placements = new Map(Object.values(equipment).map((m) => [m, { position: m.root.position.clone(), quaternion: m.root.quaternion.clone() }]));
    this.portSpecs = resolvePorts(this.station, equipment);
    this.stock = this.buildStock();
    this.stackItems = Object.fromEntries(Object.keys(this.station.stacks).map((name) => [name, []]));
    this.made = new Set(); // items made during the process (spawn), kept until cleared
    this.checkStacks();
    // An indexing station plans per machine-cycle phase (IndexingCycle.js), not intake → process → output.
    this.phases = this.station.indexing ? null : stationPhases(this.station, equipment, this.portSpecs, conventions);
    this.checkSignals();
    // Everything is checked before anything plays: a bad op fails here, not mid-cycle.
    this.timing = planStation(registry, this.station, { equipment, product: product?.type ?? null, conventions });
    // Pipes and hoses between machines, redrawn when an end moves (refresh).
    this.connections = this.station.connections.length
      ? buildConnections({ connections: this.station.connections, equipment, root, materials: ctx.materials })
      : null;

    this.speed = 1;
    this.running = false;
    this.error = null;
    this.owned = new Set();
    this.kept = {}; // stand-alone: units left at extra output ports (reject lane), per port
    this.fromLift = new WeakSet();
    this.displayTimer = 0;
    this.sequencer = new StepSequencer({
      plan: () => this.planNext(),
      onStepStart: (step) => {
        this.status.state = step.state;
        this.status.step = step.label;
        Object.assign(this.status, step.status);
      },
    });
    this.ports = {};
    for (const p of Object.values(this.portSpecs)) {
      if (p.direction === 'work') continue;
      this.ports[p.name] = { ...p, station: this.station.id };
    }
    this.useStandalonePorts();
    // Machines that only exist when a port is connected stay hidden stand-alone (a line shows them).
    for (const p of Object.values(this.portSpecs)) for (const m of p.connected ?? []) this.equipment[m].root.visible = false;
    this.reset();
  }

  get id() {
    return this.station.id;
  }

  // ---- Stock (part copies at machine ports) ------------------------------------------------------

  buildStock() {
    const stock = {};
    for (const [name, s] of Object.entries(this.station.stock)) {
      if (!this.productDef) throw new StationError(`station "${this.station.id}" stock "${name}": the station has no product to copy parts of`);
      const machine = this.equipment[s.at.machine];
      if (!machine) throw new StationError(`station "${this.station.id}" stock "${name}": unknown machine "${s.at.machine}"`);
      if (!machine.ports?.[s.at.port]) throw new StationError(`station "${this.station.id}" stock "${name}": machine "${s.at.machine}" has no port "${s.at.port}" (ports: ${Object.keys(machine.ports ?? {}).join(', ') || 'none'})`);
      const { object } = this.registry.partCopy(this.productDef.type, s.part, s.mode, this.ctx);
      object.name = `Stock ${name}`;
      this.root.add(object);
      stock[name] = object;
    }
    return stock;
  }

  // ---- Stacks (cases on a pallet) and items made during the process ------------------------------

  checkStacks() {
    for (const [name, s] of Object.entries(this.station.stacks)) {
      const machine = this.equipment[s.machine];
      if (!machine) throw new StationError(`station "${this.station.id}" stack "${name}": unknown machine "${s.machine}"`);
      if (!machine.ports?.[s.port]) throw new StationError(`station "${this.station.id}" stack "${name}": machine "${s.machine}" has no port "${s.port}"`);
    }
  }

  stackCapacity(name) {
    const s = this.station.stacks[name];
    return s.columns.length * s.rows.length * s.layers;
  }

  /** World point where the next item on a stack goes (its origin): column, then row, then layer. */
  stackSlotPoint(name) {
    const s = this.station.stacks[name];
    const index = this.stackItems[name].length;
    if (index >= this.stackCapacity(name)) throw new OpError(`stack "${name}" is full (${index} items); dispatch it first`);
    const column = index % s.columns.length;
    const row = Math.floor(index / s.columns.length) % s.rows.length;
    const layer = Math.floor(index / (s.columns.length * s.rows.length));
    const machine = this.equipment[s.machine];
    const local = new Vector3(...machine.ports[s.port].position).add(new Vector3(s.columns[column], layer * s.layerHeight + s.gap, s.rows[row]));
    machine.root.updateWorldMatrix(true, false);
    return machine.root.localToWorld(local);
  }

  stackApi() {
    return {
      specs: this.station.stacks,
      slot: (name) => this.stackItems[name].length,
      slotPoint: (name) => this.stackSlotPoint(name),
      place: (name, object) => {
        if (object.parent !== this.root) this.root.attach(object);
        this.stackItems[name].push(object);
        this.status[`${name}Count`] = this.stackItems[name].length;
      },
      /** Everything on the stack is put onto its machine (the pallet), to travel with it; returns the machine's root. */
      gather: (name) => {
        const root = this.equipment[this.station.stacks[name].machine].root;
        for (const object of this.stackItems[name]) root.attach(object);
        return root;
      },
      clear: (name) => {
        for (const object of this.stackItems[name]) this.disposeTree(object);
        this.stackItems[name] = [];
        this.status[`${name}Count`] = 0;
        this.status[`${name}Shipped`] += 1;
      },
    };
  }

  /** Frees an item and everything in it (a carton with its foam and the printer packed in it). */
  disposeTree(object) {
    const frees = [];
    object.traverse((o) => { if (o.userData.dispose && !o.userData.disposed) frees.push(o); });
    for (const o of frees.reverse()) {
      o.userData.disposed = true;
      o.userData.dispose();
    }
    object.removeFromParent();
    for (const unit of this.made) if (unit.root.userData.disposed) this.made.delete(unit);
  }

  /** Puts stock items (all, or the names given) back at their places, visible. */
  restock(names = null) {
    for (const name of names ?? Object.keys(this.stock)) {
      const object = this.stock[name];
      const s = this.station.stock[name];
      const machine = this.equipment[s.at.machine].root;
      const local = new Vector3(...this.equipment[s.at.machine].ports[s.at.port].position).add(new Vector3(...s.at.offset));
      machine.updateWorldMatrix(true, false);
      this.root.updateWorldMatrix(true, false);
      if (object.parent !== this.root) this.root.attach(object);
      const world = machine.matrixWorld.clone().multiply(new Matrix4().makeTranslation(local.x, local.y, local.z));
      this.root.matrixWorld.clone().invert().multiply(world).decompose(object.position, object.quaternion, object.scale);
      object.visible = true;
      object.updateMatrixWorld(true);
    }
  }

  // ---- Ports -------------------------------------------------------------------------------------

  /** Stand-alone: the input makes new units, outputs retire (or keep) what they get. */
  useStandalonePorts() {
    Object.assign(this.ports.input, { take: () => this.createIncoming(), available: () => Boolean(this.createProductFn), waiting: 'Waiting for carrier' });
    for (const port of Object.values(this.ports)) {
      if (port.direction !== 'out') continue;
      port.ready = () => true;
      port.put = port.name === 'output' ? (unit) => this.retire(unit) : (unit) => this.keep(port.name, unit);
    }
  }

  /** Station-frame position of a port (a Vector3). */
  portInStation(name) {
    const p = this.portSpecs[name];
    const machine = this.equipment[p.machine].root;
    machine.updateWorldMatrix(true, false);
    this.root.updateWorldMatrix(true, false);
    const world = machine.localToWorld(new Vector3(...p.position));
    return this.root.worldToLocal(world);
  }

  nextSerial() {
    this.serialCounter += 1;
    return this.serialCounter;
  }

  /**
   * A new unit at the stage this station expects, at the input port (below it, on the return line).
   * A station taking batches (station.batch) gets a whole batch, its members standing as declared.
   */
  createIncoming() {
    if (!this.createProductFn) return null;
    const unit = this.station.batch ? this.createIncomingBatch() : this.createProductFn({ serial: this.nextSerial(), stage: this.station.inputStage });
    unit.root.position.copy(this.portInStation('input'));
    if (this.station.feed.fromLift) {
      unit.root.position.y -= this.conventions.lift.drop;
      this.fromLift.add(unit);
    }
    this.root.add(unit.root);
    return unit;
  }

  createIncomingBatch() {
    const b = this.station.batch;
    const members = Array.from({ length: b.members }, () => this.createProductFn({ serial: this.nextSerial(), stage: this.station.inputStage }));
    this.batchSerial += 1;
    return createBatch({ members, pitch: b.pitch, rows: b.rows, rowPitch: b.rowPitch, rowsFrom: b.rowsFrom, def: this.registry.getProduct(members[0].type), serial: this.batchSerial });
  }

  /**
   * Stand-alone output: the carrier is lowered to the return line and leaves the cell. A station
   * whose units do not come from a return line (feed.fromLift false) just lets the unit go.
   */
  retire(unit) {
    if (!this.station.feed.fromLift) {
      this.discard(unit);
      return;
    }
    this.adopt(unit);
    const startY = unit.root.position.y;
    const { drop, duration } = this.conventions.lift;
    this.sequencer.queue(STATION_STATES.OUTPUT, 'Carrier lowering to return line', duration, { conveyor: 'LIFT' }, {
      onUpdate: (progress) => { unit.root.position.y = startY - drop * smoother(progress); },
      onEnd: () => this.discard(unit),
    });
  }

  /** Stand-alone extra output (e.g. a reject lane): the unit stays there; when its places (`slots`, default 3) are full the oldest is cleared. */
  keep(port, unit) {
    this.adopt(unit);
    const list = (this.kept[port] ??= []);
    list.push(unit);
    while (list.length > (this.ports[port].slots ?? 3)) this.discard(list.shift());
  }

  adopt(unit) {
    this.owned.add(unit);
    if (unit.root.parent !== this.root) this.root.attach(unit.root);
  }

  /** The station no longer owns this unit (a line took it). */
  release(unit) {
    this.owned.delete(unit);
  }

  /** Frees a unit; one that holds other things (a case with its cans) is freed with what it holds. */
  discard(unit) {
    this.owned.delete(unit);
    if (unit.root.userData.dispose) {
      this.disposeTree(unit.root);
      return;
    }
    unit.root.removeFromParent();
    unit.dispose();
  }

  /**
   * The unit is now `next` (an item the station made, e.g. the case the units were packed into;
   * swapUnit op). The old unit is used up: members packed into the new one now belong to it (freed
   * with it), anything still in the old unit is freed.
   */
  swapUnit(next, old) {
    this.made.delete(next);
    next.root.userData.dispose ??= () => next.dispose();
    for (const m of old.members ?? []) {
      if (m.root.parent !== old.root) m.root.userData.dispose ??= () => m.dispose();
    }
    if (next.label === undefined && old.label !== undefined) next.label = old.label;
    this.owned.delete(old);
    old.dispose();
    this.adopt(next);
    this.unit = next;
    this.status.unit = unitLabel(next);
  }

  // ---- Lifecycle ---------------------------------------------------------------------------------

  start() {
    if (this.running || this.error) return;
    this.running = true;
    if (this.status.state === STATION_STATES.IDLE) this.status.step = 'Starting';
    this.refresh(true);
  }

  stop() {
    this.running = false;
    this.refresh(true);
  }

  reset() {
    this.running = false;
    this.error = null;
    this.sequencer.clear();
    for (const unit of [...(this.owned ?? [])]) this.discard(unit);
    this.owned.clear();
    for (const made of [...(this.made ?? [])]) this.disposeTree(made.root);
    this.made?.clear();
    // Units left on stacks belong to the station: freed with the stack.
    for (const name of Object.keys(this.stackItems ?? {})) {
      for (const object of this.stackItems[name]) this.disposeTree(object);
      this.stackItems[name] = [];
    }
    // Machines an op carried away (a pallet hauled to a wrapper) go back to where they stood.
    for (const [machine, at] of this.placements ?? []) {
      machine.root.position.copy(at.position);
      machine.root.quaternion.copy(at.quaternion);
      machine.root.updateMatrixWorld(true);
    }
    this.kept = {};
    this.unit = null;
    this.phase = 'empty';
    this.ops = null;
    this.serialCounter = 0;
    this.batchSerial = 0;
    // Every machine back to its start pose, then the station's home values.
    for (const machine of Object.values(this.equipment)) {
      for (const [name, spec] of Object.entries(machine.motions ?? {})) {
        machine.set(name, spec.default ?? (spec.range ? spec.range[0] : spec.values[0]));
      }
    }
    for (const [id, values] of Object.entries(this.station.home)) {
      for (const [motion, value] of Object.entries(values)) this.equipment[id].set(motion, value);
    }
    this.restock();
    this.status = {
      state: STATION_STATES.IDLE,
      step: 'Ready',
      conveyor: 'STOPPED',
      unit: '—',
      completed: 0,
      cycles: 0,
      speed: this.speed,
      alarm: 'OFF',
      ...this.station.status,
    };
    for (const p of Object.values(this.ports)) if (p.direction === 'out' && p.name !== 'output') this.status[`${p.name}Count`] = 0;
    // Stacks: items on them, spots, and how many were shipped.
    for (const name of Object.keys(this.station.stacks)) Object.assign(this.status, { [`${name}Count`]: 0, [`${name}Capacity`]: this.stackCapacity(name), [`${name}Shipped`]: 0 });
    this.refresh(true);
  }

  setSpeed(speed) {
    this.speed = speed;
    this.status.speed = speed;
  }

  update(delta) {
    if (this.running) {
      try {
        this.sequencer.advance(delta * this.speed);
      } catch (error) {
        this.fault(error);
      }
    }
    this.displayTimer += delta;
    this.refresh(this.displayTimer >= DISPLAY_REFRESH_SECONDS);
  }

  /** A run-time error (e.g. out of reach): the station stops in ALARM and says why. */
  fault(error) {
    if (!(error instanceof OpError) && !(error instanceof StationError)) throw error;
    this.error = error;
    this.running = false;
    this.sequencer.clear();
    this.status.state = STATION_STATES.ALARM;
    this.status.step = error.message.slice(0, 60);
    this.status.alarm = 'ON';
  }

  refresh(showDisplay) {
    this.connections?.update();
    this.updateSensors();
    this.updateBeacon();
    if (showDisplay) this.updateDisplay();
    this.onUpdate?.(this);
  }

  // ---- Planning ----------------------------------------------------------------------------------

  planNext() {
    if (this.phase === 'empty' && this.station.prepare.length) return this.planPrepare();
    if (this.phase === 'empty' || this.phase === 'prepared') return this.planIntake();
    if (this.phase === 'intake') return this.planProcess();
    if (this.phase === 'worked') return this.planOutput();
    // 'output' / 'left': the last steps are still running; nothing to add.
  }

  hold(state, label) {
    this.sequencer.queue(state, label, this.conventions.holdSeconds, { conveyor: 'STOPPED' });
  }

  /** The `prepare` ops, once a unit is waiting (it is taken in after them). */
  planPrepare() {
    if (!(this.ports.input.available?.() ?? true)) {
      this.hold(STATION_STATES.WAITING, this.ports.input.waiting ?? 'Waiting for unit');
      return;
    }
    this.prepareCycle().expand(this.station.prepare, 'prepare');
    this.phase = 'prepared';
  }

  /** The OpCycle the prepare ops are expanded on: no unit yet. */
  prepareCycle() {
    return new OpCycle({
      registry: this.registry, sequencer: this.sequencer, equipment: this.equipment, workState: this.station.workState,
      conventions: this.conventions, items: this.stock, restock: (names) => this.restock(names),
      setStatus: (patch) => Object.assign(this.status, patch), ctx: this.ctx,
    });
  }

  planIntake() {
    const unit = this.ports.input.take();
    if (!unit) {
      this.hold(STATION_STATES.WAITING, this.ports.input.waiting ?? 'Waiting for unit');
      return;
    }
    this.adopt(unit);
    // A batch handed over where it stands is planned from where its members really are.
    if (unit.isBatch && unit.rebase) unit.rebase(this.portInStation('input'));
    this.unit = unit;
    this.status.unit = unitLabel(unit);
    this.status.alarm = 'OFF'; // an alarm raised for the last unit (a reject) is cleared by the next
    this.ops = this.unitCycle(unit);
    if (this.fromLift.has(unit)) {
      this.fromLift.delete(unit);
      const { drop, duration } = this.conventions.lift;
      const topY = unit.root.position.y + drop;
      this.sequencer.queue(STATION_STATES.INFEED, 'Carrier rising from return line', duration, { conveyor: 'LIFT' }, {
        onUpdate: (progress) => { unit.root.position.y = topY - drop * (1 - smoother(progress)); },
      });
    }
    this.ops.expand(this.phases.intake, 'intake');
    this.phase = 'intake';
  }

  planProcess() {
    this.ops.expand(this.phases.process, 'process');
    const exit = this.exitPort();
    const stacked = exit ? null : this.ops.locationOf('product')?.stack ?? null;
    this.ops.queue(this.station.workState, 'Process complete', 0, {}, {
      onEnd: () => {
        this.status.cycles += 1;
        if (exit) this.handOver(this.unit, exit); // the unit may have changed during the process (swapUnit)
        else if (stacked) this.leaveOnStack(this.unit);
      },
    });
    this.phase = exit || stacked ? 'left' : 'worked';
  }

  /** The unit stays on a stack of the station (it owns it from now on): this unit is done. */
  leaveOnStack(unit) {
    unit.root.userData.dispose ??= () => unit.dispose(); // freed with the stack
    this.status.completed += 1;
    this.unit = null;
    this.ops = null;
    this.phase = 'empty';
    this.status.unit = '—';
    this.release(unit);
  }

  planOutput() {
    if (!this.ports.output.ready()) {
      this.hold(STATION_STATES.HOLDING, 'Holding · downstream busy');
      return;
    }
    const unit = this.unit;
    const out = this.portSpecs.output;
    const leave = () => {
      this.status.completed += 1;
      this.handOver(unit, 'output');
    };
    // The unit is handed over as it reaches the output port; steps after that (a shutter closing
    // behind it) still play, as in the reference.
    let handed = false;
    this.ops.where.push('output');
    this.phases.output.forEach((op, index) => {
      this.ops.expandOne(op, index);
      const at = this.ops.locationOf('product');
      if (!handed && at?.machine === out.machine && at.port === out.port) {
        this.afterLastStep(leave);
        handed = true;
      }
    });
    this.ops.where.pop();
    if (!handed) this.afterLastStep(leave);
    this.phase = 'output';
  }

  /** The unit leaves through `port`: the station forgets it and the port takes it. */
  handOver(unit, port) {
    if (port !== 'output') this.status[`${port}Count`] += 1;
    this.unit = null;
    this.ops = null;
    this.phase = 'empty';
    this.status.unit = '—';
    this.release(unit);
    this.ports[port].put(unit);
  }

  /** An extra output port the process left the unit at (planned location), or null. */
  exitPort() {
    const at = this.ops.locationOf('product');
    if (!at?.port) return null;
    const port = Object.values(this.ports).find((p) => p.direction === 'out' && p.name !== 'output' && p.machine === at.machine && p.port === at.port);
    return port?.name ?? null;
  }

  afterLastStep(fn) {
    const steps = this.sequencer.steps;
    const last = steps[steps.length - 1];
    if (!last) { fn(); return; }
    const before = last.onEnd;
    last.onEnd = () => { before?.(); fn(); };
  }

  /** The OpCycle a unit's three phases are expanded on (run mode). */
  unitCycle(unit) {
    const input = this.portSpecs.input;
    return new OpCycle({
      registry: this.registry,
      sequencer: this.sequencer,
      equipment: this.equipment,
      product: unit,
      facts: this.factsFor(unit),
      workState: this.station.workState,
      at: { product: { machine: input.machine, port: input.port, ...(input.offset ? { offset: input.offset } : {}) } },
      conventions: this.conventions,
      items: this.stock,
      restock: (names) => this.restock(names),
      setStatus: (patch) => Object.assign(this.status, patch),
      ctx: this.ctx,
      stacks: this.stackApi(),
      onSpawn: (made) => this.made.add(made),
      onSwap: (next, old) => this.swapUnit(next, old),
    });
  }

  factsFor(unit) {
    // A bay port with `slots` offers <port>Slot: the place the next unit there goes to (in turn).
    const bays = Object.fromEntries(Object.values(this.ports)
      .filter((p) => p.direction === 'out' && p.slots)
      .map((p) => [`${p.name}Slot`, () => this.status[`${p.name}Count`] % p.slots]));
    // A stack offers <stack>Slot (spots filled so far) and <stack>Fills (yes when the next item fills it).
    const stacks = Object.fromEntries(Object.keys(this.station.stacks).flatMap((name) => [
      [`${name}Slot`, () => this.stackItems[name].length],
      [`${name}Fills`, () => (this.stackItems[name].length + 1 >= this.stackCapacity(name) ? 'yes' : 'no')],
    ]));
    return { serial: unit.params?.serial ?? unit.serial ?? 0, label: unitLabel(unit), ...bays, ...stacks, ...(unit.facts ?? {}), ...(this.extraFacts?.(unit) ?? {}) };
  }

  // ---- Signals -----------------------------------------------------------------------------------

  checkSignals() {
    const { beacon, display } = this.station.signals;
    const where = `station "${this.station.id}" signals`;
    if (beacon) {
      const spec = this.equipment[beacon.machine]?.motions?.[beacon.motion];
      if (!spec?.values || !BEACON_MODES.every((m) => spec.values.includes(m))) {
        throw new StationError(`${where}.beacon: "${beacon.machine}.${beacon.motion}" must be a motion with values ${BEACON_MODES.join(' | ')}`);
      }
    }
    if (display && !this.equipment[display.machine]?.displays?.[display.screen]) {
      throw new StationError(`${where}.display: machine "${display.machine}" has no display "${display.screen}"`);
    }
    const { dashboard } = this.station.signals;
    if (dashboard && !this.equipment[dashboard.machine]?.displays?.[dashboard.screen]) {
      throw new StationError(`${where}.dashboard: machine "${dashboard.machine}" has no display "${dashboard.screen}"`);
    }
  }

  beaconMode() {
    const { state, alarm } = this.status;
    if (this.error || alarm === 'ON') return 'alarm';
    if (!this.running) return 'off';
    if (state === STATION_STATES.WAITING || state === STATION_STATES.HOLDING) return 'wait';
    return 'run';
  }

  updateBeacon() {
    const light = this.station.signals.beacon;
    if (!light) return;
    const machine = this.equipment[light.machine];
    const mode = this.beaconMode();
    if (machine.state[light.motion] !== mode) machine.set(light.motion, mode);
  }

  /** The HMI screen for the current status (title, state, step, rows, bar). */
  screen() {
    const { display } = this.station.signals;
    const s = this.status;
    const title = [this.station.code, this.station.title.toUpperCase()].filter(Boolean).join(' · ');
    const fill = (text) => text.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (_, key) => String(s[key] ?? '—'));
    let bar = null;
    if (display?.bar) {
      const total = Number(s[display.bar.total]);
      const value = Number(s[display.bar.value]);
      bar = { fraction: total > 0 && Number.isFinite(value) ? Math.min(1, Math.max(0, value / total)) : 0, label: cut(fill(display.bar.label), 60) };
    }
    return {
      title: cut(title, 48),
      state: cut(String(s.state), 24),
      step: cut(String(s.step ?? ''), 60),
      rows: (display?.rows ?? []).map(([label, key]) => [label, typeof s[key] === 'number' ? s[key] : cut(String(s[key] ?? '—'), 24)]),
      bar,
    };
  }

  /** The dashboard content for the current status (title, step, gauges, grid, footer). */
  dashboardData() {
    const d = this.station.signals.dashboard;
    const s = this.status;
    const fill = (text) => text.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (_, key) => String(s[key] ?? '—'));
    const values = d.grid ? s[d.grid.values] : null;
    return {
      title: cut(fill(d.title), 48),
      step: cut(String(s.step ?? ''), 60),
      gauges: d.gauges.map((g) => ({ label: g.label, value: Number.isFinite(Number(s[g.value])) ? Number(s[g.value]) : 0, target: g.target, unit: g.unit, color: g.color })),
      grid: d.grid ? { label: d.grid.label, cols: d.grid.cols, values: Array.isArray(values) ? values.slice(0, 25) : [], range: d.grid.range } : null,
      checks: d.checks.map((c) => {
        const state = fill(c.state);
        return { label: c.label, value: cut(fill(c.value), 12), state: ['pending', 'pass', 'fail'].includes(state) ? state : 'pending' };
      }),
      verdict: d.verdict && ['PASS', 'REJECT'].includes(s[d.verdict]) ? s[d.verdict] : null,
      footer: cut(fill(d.footer), 80),
    };
  }

  updateDisplay() {
    this.displayTimer = 0;
    const { display, dashboard } = this.station.signals;
    if (display) this.equipment[display.machine].show(display.screen, this.screen());
    if (dashboard) this.equipment[dashboard.machine].show(dashboard.screen, this.dashboardData());
  }

  /** Presence sensors: blocked while a unit's body spans the sensor's X (and is near it across). */
  updateSensors() {
    if (!this.station.sensors.length) return;
    this.root.updateWorldMatrix(true, false);
    const units = [];
    const seen = new Set();
    for (const unit of [...this.owned, ...this.made]) {
      for (const u of unit.members ?? [unit]) {
        if (!seen.has(u.root) && u.root.parent) units.push(u.root);
        seen.add(u.root);
      }
    }
    const spans = units.map((root) => {
      root.updateWorldMatrix(true, false);
      const at = new Vector3().setFromMatrixPosition(root.matrixWorld);
      // The unit's extent along X, measured once relative to its origin (units do not turn on the belt).
      if (!root.userData.sensorSpan) {
        const box = new Box3().setFromObject(root);
        root.userData.sensorSpan = [box.min.x - at.x, box.max.x - at.x];
      }
      return { at, span: root.userData.sensorSpan };
    });
    for (const s of this.station.sensors) {
      const machine = this.equipment[s.machine];
      machine.root.updateWorldMatrix(true, false);
      const p = new Vector3().setFromMatrixPosition(machine.root.matrixWorld);
      const hit = spans.some(({ at, span }) => p.x >= at.x + span[0] && p.x <= at.x + span[1] && Math.abs(p.z - at.z) <= s.across);
      const value = hit ? s.blocked : s.clear;
      if (machine.state[s.motion] !== value) machine.set(s.motion, value);
    }
  }

  dispose() {
    this.reset();
    Object.values(this.stock).forEach((object) => object.removeFromParent());
    this.connections?.dispose();
  }
}

function cut(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function unitLabel(unit) {
  const serial = unit.params?.serial ?? unit.serial;
  return unit.label ?? unit.api?.label ?? (serial !== undefined ? `#${String(serial).padStart(4, '0')}` : 'unit');
}

/**
 * Dry plan of one unit through a station, from the catalog alone (no geometry):
 * { intake, process, output } each { duration, steps }, `cycleTime` (their sum, the station's
 * share of the line takt) and every step in order. `equipment`: { id: { type, params } } or specs.
 * Stand-alone lift moves and waits are not part of it (a line replaces them with transfers).
 */
export function planStation(registry, stationData, { equipment, product = null, ctx = {}, conventions = CONVENTIONS, facts = {} } = {}) {
  const station = parseStation(stationData);
  // Specs with their placement in the station (from built instances, or the IR's position /
  // rotationY), so moves between machines can be measured without geometry.
  const specs = Object.fromEntries(Object.entries(equipment).map(([id, e]) => {
    const spec = e.motions ? e : registry.componentSpec(e.type, e.params ?? {}, ctx);
    const placement = e.placement ?? (e.root
      ? { position: e.root.position.toArray(), rotationY: e.root.rotation.y }
      : { position: e.position ?? [0, 0, 0], rotationY: e.rotationY ?? 0 });
    return [id, { ...spec, placement }];
  }));
  const ports = resolvePorts(station, specs);
  const wrap = (fn) => {
    try {
      return fn();
    } catch (error) {
      if (error instanceof OpError) throw new StationError(`station "${station.id}" › ${error.message}`);
      throw error;
    }
  };
  if (station.indexing) {
    const productSpec = product ? registry.getProduct(product) : null;
    const newCycle = () => new OpCycle({
      registry, mode: 'dry', equipment: specs, workState: station.workState, conventions, facts, productSpec,
      items: Object.keys(station.stock), stacks: { specs: station.stacks },
    });
    const plan = planIndexing(station, newCycle, wrap);
    const problems = [...connectionProblems(station.connections, specs), ...sensorProblems(station.sensors, specs)];
    if (problems.length) throw new StationError(`station "${station.id}" ${problems.join('; ')}`);
    return plan;
  }
  const phases = stationPhases(station, specs, ports, conventions);
  const input = ports.input;
  for (const [name, s] of Object.entries(station.stock)) {
    const where = `station "${station.id}" stock "${name}"`;
    if (!specs[s.at.machine]) throw new StationError(`${where}: unknown machine "${s.at.machine}"`);
    if (!specs[s.at.machine].ports?.[s.at.port]) throw new StationError(`${where}: machine "${s.at.machine}" has no port "${s.at.port}"`);
    const def = product ? registry.getProduct(product) : null;
    if (def && !def.parts.includes(s.part)) throw new StationError(`${where}: the product has no part "${s.part}"`);
  }
  const connectionIssues = [...connectionProblems(station.connections, specs), ...sensorProblems(station.sensors, specs)];
  if (connectionIssues.length) throw new StationError(`station "${station.id}" ${connectionIssues.join('; ')}`);
  const batchSpec = station.batch && product ? batchProductSpec(registry.getProduct(product), station.batch) : null;
  const { cycle } = wrap(() => dryRun(registry, [], {
    equipment: specs, product: batchSpec ? null : product, productSpec: batchSpec, workState: station.workState, conventions, items: Object.keys(station.stock), facts,
    stacks: { specs: station.stacks },
    at: { product: { machine: input.machine, port: input.port, ...(input.offset ? { offset: input.offset } : {}) } },
  }));
  // The prepare ops play before the unit is taken in: part of the intake time.
  const prepared = station.prepare.length
    ? wrap(() => dryRun(registry, station.prepare, { equipment: specs, workState: station.workState, conventions, items: Object.keys(station.stock), facts })).steps
    : [];
  const result = { station: station.id };
  let from = 0;
  result.exit = null;
  for (const phase of ['intake', 'process', 'output']) {
    // A process that leaves the unit at another output port (a reject lane) hands it over there:
    // no output phase, as when it plays.
    if (phase === 'output' && (result.exit || result.stacked)) {
      result.output = { duration: 0, steps: [] };
      continue;
    }
    wrap(() => cycle.expand(phases[phase], phase));
    if (phase === 'process') {
      const at = cycle.locationOf('product');
      const exit = Object.values(ports).find((p) => p.direction === 'out' && p.name !== 'output' && at?.port && p.machine === at.machine && p.port === at.port);
      result.exit = exit?.name ?? null;
      result.stacked = result.exit ? null : at?.stack ?? null; // left on a stack: no output phase
    }
    if (phase === 'process') cycle.queue(station.workState, 'Process complete', 0);
    const steps = [...(phase === 'intake' ? prepared : []), ...cycle.steps.slice(from)];
    from = cycle.steps.length;
    result[phase] = { duration: steps.reduce((sum, s) => sum + s.duration, 0), steps };
  }
  result.cycleTime = result.intake.duration + result.process.duration + result.output.duration;
  result.steps = [...prepared, ...cycle.steps];
  return result;
}

/** What the dry plan knows of a batch of `def` products standing as `batch` says. */
function batchProductSpec(def, batch) {
  return {
    stages: def.stages, refs: def.refs, parts: [], features: def.features, cables: [], routines: def.routines,
    payloads: memberNames(batch.members), memberSpec: def, memberOffsets: batchOffsets(batch),
  };
}

/**
 * Wires an output port of one station to an input port of the next through a one-place hand-over:
 * the upstream port puts a unit, the downstream port takes it. Ports must be typed alike (they
 * carry the same thing). Returns the link { from, to, pending }. Line.js builds transfers on this.
 */
export function connectPorts(from, to) {
  const reason = portMismatch(from, to);
  if (reason) throw new StationError(`cannot connect ${from.station}.${from.name} → ${to.station}.${to.name}: ${reason}`);
  const link = { from, to, pending: null };
  from.ready = () => link.pending === null;
  from.put = (unit) => { link.pending = unit; };
  to.take = () => {
    const unit = link.pending;
    link.pending = null;
    return unit;
  };
  to.available = () => link.pending !== null;
  to.waiting = `Waiting for ${from.station}`;
  return link;
}
