// Process controller of one station, for any station written as data (lib/station/stationSpec.js).
// Generic port of the reference AssemblyCycle: a timed step queue plus the station's typed ports.
//
//   ports.input.take()     → a unit to work on, or null (then the station waits)
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
// output port of the station (a reject lane) hands it over there instead of running the output.
import { Vector3 } from 'three';
import { OpCycle, OpError, dryRun } from '../ops/index.js';
import { StepSequencer } from '../core/StepSequencer.js';
import { smoother } from '../core/motion.js';
import { CONVENTIONS } from '../core/conventions.js';
import { StationError, parseStation, portMismatch, resolvePorts, stationPhases } from './stationSpec.js';

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

    this.portSpecs = resolvePorts(this.station, equipment);
    this.phases = stationPhases(this.station, equipment, this.portSpecs, conventions);
    this.checkSignals();
    // Everything is checked before anything plays: a bad op fails here, not mid-cycle.
    this.timing = planStation(registry, this.station, { equipment, product: product?.type ?? null, conventions });

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
    this.reset();
  }

  get id() {
    return this.station.id;
  }

  // ---- Ports -------------------------------------------------------------------------------------

  /** Stand-alone: the input makes new units, outputs retire (or keep) what they get. */
  useStandalonePorts() {
    Object.assign(this.ports.input, { take: () => this.createIncoming(), waiting: 'Waiting for carrier' });
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

  /** A new unit at the stage this station expects, at the input port (below it, on the return line). */
  createIncoming() {
    if (!this.createProductFn) return null;
    const unit = this.createProductFn({ serial: this.nextSerial(), stage: this.station.inputStage });
    unit.root.position.copy(this.portInStation('input'));
    if (this.station.feed.fromLift) {
      unit.root.position.y -= this.conventions.lift.drop;
      this.fromLift.add(unit);
    }
    this.root.add(unit.root);
    return unit;
  }

  /** Stand-alone output: the carrier is lowered to the return line and leaves the cell. */
  retire(unit) {
    this.adopt(unit);
    const startY = unit.root.position.y;
    const { drop, duration } = this.conventions.lift;
    this.sequencer.queue(STATION_STATES.OUTPUT, 'Carrier lowering to return line', duration, { conveyor: 'LIFT' }, {
      onUpdate: (progress) => { unit.root.position.y = startY - drop * smoother(progress); },
      onEnd: () => this.discard(unit),
    });
  }

  /** Stand-alone extra output (e.g. a reject lane): the unit stays there; the oldest of 3 is cleared. */
  keep(port, unit) {
    this.adopt(unit);
    const list = (this.kept[port] ??= []);
    list.push(unit);
    while (list.length > 3) this.discard(list.shift());
  }

  adopt(unit) {
    this.owned.add(unit);
    if (unit.root.parent !== this.root) this.root.attach(unit.root);
  }

  /** The station no longer owns this unit (a line took it). */
  release(unit) {
    this.owned.delete(unit);
  }

  discard(unit) {
    this.owned.delete(unit);
    unit.root.removeFromParent();
    unit.dispose();
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
    this.owned.forEach((unit) => { unit.root.removeFromParent(); unit.dispose(); });
    this.owned.clear();
    this.kept = {};
    this.unit = null;
    this.phase = 'empty';
    this.ops = null;
    this.serialCounter = 0;
    // Every machine back to its start pose, then the station's home values.
    for (const machine of Object.values(this.equipment)) {
      for (const [name, spec] of Object.entries(machine.motions ?? {})) {
        machine.set(name, spec.default ?? (spec.range ? spec.range[0] : spec.values[0]));
      }
    }
    for (const [id, values] of Object.entries(this.station.home)) {
      for (const [motion, value] of Object.entries(values)) this.equipment[id].set(motion, value);
    }
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
    this.updateBeacon();
    if (showDisplay) this.updateDisplay();
    this.onUpdate?.(this);
  }

  // ---- Planning ----------------------------------------------------------------------------------

  planNext() {
    if (this.phase === 'empty') return this.planIntake();
    if (this.phase === 'intake') return this.planProcess();
    if (this.phase === 'worked') return this.planOutput();
    // 'output' / 'left': the last steps are still running; nothing to add.
  }

  hold(state, label) {
    this.sequencer.queue(state, label, this.conventions.holdSeconds, { conveyor: 'STOPPED' });
  }

  planIntake() {
    const unit = this.ports.input.take();
    if (!unit) {
      this.hold(STATION_STATES.WAITING, this.ports.input.waiting ?? 'Waiting for unit');
      return;
    }
    this.adopt(unit);
    this.unit = unit;
    this.status.unit = unitLabel(unit);
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
    const unit = this.unit;
    this.ops.expand(this.phases.process, 'process');
    const exit = this.exitPort();
    this.ops.queue(this.station.workState, 'Process complete', 0, {}, {
      onEnd: () => {
        this.status.cycles += 1;
        if (exit) this.handOver(unit, exit);
      },
    });
    this.phase = exit ? 'left' : 'worked';
  }

  planOutput() {
    if (!this.ports.output.ready()) {
      this.hold(STATION_STATES.HOLDING, 'Holding · downstream busy');
      return;
    }
    const unit = this.unit;
    this.ops.expand(this.phases.output, 'output');
    this.afterLastStep(() => {
      this.status.completed += 1;
      this.handOver(unit, 'output');
    });
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
      at: { product: { machine: input.machine, port: input.port } },
      conventions: this.conventions,
    });
  }

  factsFor(unit) {
    return { serial: unit.params?.serial ?? unit.serial ?? 0, ...(unit.facts ?? {}), ...(this.extraFacts?.(unit) ?? {}) };
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

  updateDisplay() {
    this.displayTimer = 0;
    const { display } = this.station.signals;
    if (display) this.equipment[display.machine].show(display.screen, this.screen());
  }

  dispose() {
    this.reset();
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
export function planStation(registry, stationData, { equipment, product = null, ctx = {}, conventions = CONVENTIONS } = {}) {
  const station = parseStation(stationData);
  const specs = Object.fromEntries(Object.entries(equipment).map(([id, e]) => [
    id, e.motions ? e : registry.componentSpec(e.type, e.params ?? {}, ctx),
  ]));
  const ports = resolvePorts(station, specs);
  const phases = stationPhases(station, specs, ports, conventions);
  const input = ports.input;
  const wrap = (fn) => {
    try {
      return fn();
    } catch (error) {
      if (error instanceof OpError) throw new StationError(`station "${station.id}" › ${error.message}`);
      throw error;
    }
  };
  const { cycle } = wrap(() => dryRun(registry, [], {
    equipment: specs, product, workState: station.workState, conventions,
    at: { product: { machine: input.machine, port: input.port } },
  }));
  const result = { station: station.id };
  let from = 0;
  for (const phase of ['intake', 'process', 'output']) {
    wrap(() => cycle.expand(phases[phase], phase));
    if (phase === 'process') cycle.queue(station.workState, 'Process complete', 0);
    const steps = cycle.steps.slice(from);
    from = cycle.steps.length;
    result[phase] = { duration: steps.reduce((sum, s) => sum + s.duration, 0), steps };
  }
  result.cycleTime = result.intake.duration + result.process.duration + result.output.duration;
  result.steps = cycle.steps;
  return result;
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
  to.waiting = `Waiting for ${from.station}`;
  return link;
}
