// A production line: stations chained through their typed ports by transfers. Generic port of the
// reference PrinterAssemblyLine.js. Stations are the same StationCycles that run stand-alone,
// unchanged; the line only replaces their ports:
//
//   first.input    ← new units released from the return line (runSize per run)
//   a.output       → transfer conveyor → b.input        (one per graph edge)
//   last.output    → down the lift to the return line   (the station's stand-alone default)
//   unconnected extra outputs (a reject lane) keep their stand-alone default too
//
// Each transfer holds one unit. While it is occupied the upstream output port is not ready and
// that station holds at its cycle boundary (back-pressure); a downstream station waits at its
// input until a unit has arrived at the end of the transfer. Units keep their identity (the same
// Object3D) from the first station to the last. Equipment that only serves a port when nothing is
// connected to it (return-line lifts) is hidden once the port is connected.
//
// A station either lists its equipment by catalog type (the IR played directly) or brings its own
// `build({ registry, ctx }) → { root, equipment }` (a compiled station, generated/<line>/<id>.js);
// everything after building is the same.
//
// Nothing here knows a catalog component by name (rule 6): types come from the line data.
import * as THREE from 'three';
import { paramFields } from '../registry.js';
import { trapezoidDuration, trapezoidTravel } from '../core/motion.js';
import { CONVENTIONS } from '../core/conventions.js';
import { wrapValue } from '../ops/index.js';
import { StationCycle } from '../station/StationCycle.js';
import { IndexingCycle } from '../station/IndexingCycle.js';
import { portMismatch } from '../station/stationSpec.js';
import { endpoint, layoutLine } from './layout.js';
import { LineError, parseLine } from './lineSpec.js';

export const LINE_STATES = Object.freeze({ IDLE: 'IDLE', RUNNING: 'RUNNING', FINISHED: 'FINISHED' });

export class Line {
  /**
   * @param {object} o
   * @param {object} o.registry   registry with components, ops and products
   * @param {object} o.line       line data (lineSpec.js)
   * @param {object} [o.ctx]      build context (materials…)
   * @param {object} [o.conventions]
   * @param {Function} [o.facts]  (unit) → facts for `decide` (passed to every station)
   * @param {Function} [o.onUpdate] (line) after every update
   */
  constructor({ registry, line, ctx = {}, conventions = CONVENTIONS, facts = null, onUpdate = null }) {
    this.registry = registry;
    this.spec = parseLine(line);
    this.ctx = ctx;
    this.conventions = conventions;
    this.onUpdate = onUpdate;
    this.speed = 1;
    this.state = LINE_STATES.IDLE;
    this.released = 0;
    this.root = new THREE.Group();
    this.root.name = `line ${this.spec.id}`;

    this.buildStations(facts);
    this.layout = layoutLine({
      stations: this.stations.map((s) => ({ id: s.id, extent: s.extent })),
      edges: this.spec.edges,
      transferLength: this.spec.transferLength ?? conventions.transferLength,
    });
    for (const s of this.stations) {
      s.root.position.fromArray(this.layout.stations[s.id].position);
      s.root.rotation.y = this.layout.stations[s.id].rotationY;
    }
    this.root.updateMatrixWorld(true);
    this.buildTransfers();
    this.wire();
    this.reset();
  }

  // ---- Build -------------------------------------------------------------------------------------

  buildStations(facts) {
    const ids = new Set();
    this.stations = this.spec.stations.map((data) => {
      if (ids.has(data.id)) throw new LineError(`line "${this.spec.id}": station id "${data.id}" is used twice`);
      ids.add(data.id);
      const { equipment: list, build, ...stationData } = data;
      const { root, equipment } = build ? this.buildCompiled(data.id, build) : this.buildEquipment(data, list);
      this.root.add(root);
      const Cycle = stationData.indexing ? IndexingCycle : StationCycle; // batches at positions, or one unit
      const cycle = new Cycle({
        registry: this.registry, station: stationData, equipment, root, product: this.spec.product,
        ctx: this.ctx, facts, conventions: this.conventions,
      });
      return { id: data.id, root, equipment, cycle, extent: conveyorExtent(cycle, equipment) };
    });
    this.byId = new Map(this.stations.map((s) => [s.id, s]));
  }

  /** Equipment from catalog types, each placed in the station frame. */
  buildEquipment(data, list) {
    const root = new THREE.Group();
    root.name = [data.code, data.title ?? data.id].filter(Boolean).join(' ');
    const equipment = {};
    for (const e of list) {
      if (equipment[e.id]) throw new LineError(`station "${data.id}": equipment id "${e.id}" is used twice`);
      const inst = this.registry.buildComponent(e.type, e.params, e.beltHeight !== undefined ? { ...this.ctx, beltHeight: e.beltHeight } : this.ctx);
      inst.root.position.fromArray(e.position);
      inst.root.rotation.y = e.rotationY;
      root.add(inst.root);
      equipment[e.id] = inst;
    }
    return { root, equipment };
  }

  /** A compiled station (generated/<line>/<station>.js) builds its own equipment. */
  buildCompiled(id, build) {
    const built = build({ registry: this.registry, ctx: this.ctx });
    if (!built?.root?.isObject3D || !built.equipment || !Object.keys(built.equipment).length) {
      throw new LineError(`station "${id}": its build() must return { root, equipment } with at least one machine`);
    }
    return built;
  }

  buildTransfers() {
    this.transfers = this.layout.transfers.map((t, index) => {
      const edge = this.spec.edges.find((e) => endpoint(e.from).station === t.from && endpoint(e.to).station === t.to);
      const from = endpoint(edge.from);
      const to = endpoint(edge.to);
      const up = this.byId.get(from.station);
      const down = this.byId.get(to.station);
      const out = up.cycle.ports[from.port];
      const into = down.cycle.ports[to.port];
      const where = `edge ${edge.from} → ${edge.to}`;
      if (!out) throw new LineError(`${where}: station "${from.station}" has no port "${from.port}" (ports: ${Object.keys(up.cycle.ports).join(', ')})`);
      if (!into) throw new LineError(`${where}: station "${to.station}" has no port "${to.port}" (ports: ${Object.keys(down.cycle.ports).join(', ')})`);
      const reason = portMismatch(out, into);
      if (reason) throw new LineError(`${where}: ${reason}`);
      if (edge.carries && edge.carries !== out.carries) throw new LineError(`${where}: the edge says ${edge.carries} but the ports carry ${out.carries}`);

      // The transfer conveyor fills the gap between the two station conveyors.
      const { type, params } = edge.transport;
      let def;
      try {
        def = this.registry.getComponent(type);
      } catch {
        throw new LineError(`${where}: unknown transport type "${type}"`);
      }
      const hasLength = paramFields(def.params).some((f) => f.key === 'length');
      const conveyor = this.registry.buildComponent(type, hasLength && params.length === undefined ? { ...params, length: t.length } : params, this.ctx);
      conveyor.root.position.set(t.centre, 0, 0);
      this.root.add(conveyor.root);
      const carried = Object.values(conveyor.ports ?? {}).map((p) => p.carries);
      if (carried.length && !carried.includes(out.carries)) throw new LineError(`${where}: transport "${type}" carries ${carried.join(' / ')}, not ${out.carries}`);

      // Unit path in the line frame: upstream port → downstream port.
      const fromPos = this.toLine(up, up.cycle.portInStation(from.port));
      const toPos = this.toLine(down, down.cycle.portInStation(to.port));
      const distance = fromPos.distanceTo(toPos);
      const { speed, ramp } = this.conventions.conveyor;
      return {
        index, edge, from, to, up, down, conveyor, fromPos, toPos, distance,
        duration: trapezoidDuration(distance, speed, ramp),
        belts: Object.entries(conveyor.motions ?? {}).filter(([, spec]) => spec.travel),
        unit: null, elapsed: 0, staged: false,
      };
    });
  }

  toLine(station, point) {
    return this.root.worldToLocal(station.root.localToWorld(point.clone()));
  }

  /** Replaces the ports the line connects; hides equipment that served them stand-alone. */
  wire() {
    const first = this.byId.get(this.layout.order[0]);
    const standaloneTake = first.cycle.ports.input.take;
    Object.assign(first.cycle.ports.input, {
      take: () => {
        if (this.released >= this.spec.runSize) return null;
        const unit = standaloneTake();
        if (unit) this.released += 1;
        return unit;
      },
      waiting: 'Run complete · all carriers released',
    });
    this.connected = new Set();
    for (const t of this.transfers) {
      const out = t.up.cycle.ports[t.from.port];
      const into = t.down.cycle.ports[t.to.port];
      out.ready = () => t.unit === null;
      out.put = (unit) => this.beginTransfer(t, unit);
      into.take = () => this.takeStaged(t);
      into.waiting = `Waiting for ${t.up.cycle.station.code ?? t.up.id}`;
      for (const [station, port] of [[t.up, out], [t.down, into]]) {
        this.connected.add(`${station.id}.${port.name}`);
        for (const m of port.standalone) station.equipment[m].root.visible = false;
      }
    }
  }

  beginTransfer(t, unit) {
    this.root.attach(unit.root);
    unit.root.position.copy(t.fromPos);
    Object.assign(t, { unit, elapsed: 0, staged: false });
  }

  takeStaged(t) {
    if (!t.unit || !t.staged) return null;
    const { unit } = t;
    unit.root.position.copy(t.toPos);
    Object.assign(t, { unit: null, elapsed: 0, staged: false });
    return unit; // the station adopts it (re-parents it into its own frame)
  }

  advanceTransfer(t, time) {
    if (!t.unit || t.staged) return;
    const { speed, ramp } = this.conventions.conveyor;
    const before = trapezoidTravel(Math.min(t.elapsed, t.duration), t.distance, speed, ramp);
    t.elapsed = Math.min(t.elapsed + time, t.duration);
    const now = trapezoidTravel(t.elapsed, t.distance, speed, ramp);
    t.unit.root.position.lerpVectors(t.fromPos, t.toPos, t.distance > 0 ? now / t.distance : 1);
    for (const [motion, spec] of t.belts) {
      const amount = ((now - before) / spec.travel) * (spec.range[1] - spec.range[0]);
      t.conveyor.set(motion, wrapValue(t.conveyor.state[motion] + amount, spec.range));
    }
    if (t.elapsed >= t.duration) t.staged = true;
  }

  // ---- Lifecycle ---------------------------------------------------------------------------------

  start() {
    if (this.state === LINE_STATES.FINISHED) this.reset();
    this.state = LINE_STATES.RUNNING;
    this.stations.forEach((s) => s.cycle.start());
    this.emit();
  }

  stop() {
    if (this.state === LINE_STATES.RUNNING) this.state = LINE_STATES.IDLE;
    this.stations.forEach((s) => s.cycle.stop());
    this.emit();
  }

  reset() {
    for (const t of this.transfers) {
      if (t.unit) { t.unit.root.removeFromParent(); t.unit.dispose(); }
      Object.assign(t, { unit: null, elapsed: 0, staged: false });
    }
    this.stations.forEach((s) => s.cycle.reset());
    this.released = 0;
    this.state = LINE_STATES.IDLE;
    this.emit();
  }

  setSpeed(speed) {
    this.speed = speed;
    this.stations.forEach((s) => s.cycle.setSpeed(speed));
  }

  update(delta) {
    this.stations.forEach((s) => s.cycle.update(delta));
    if (this.state === LINE_STATES.RUNNING) {
      const time = delta * this.speed;
      this.transfers.forEach((t) => this.advanceTransfer(t, time));
      // Finished: every unit of the run has left and every station is back waiting for work.
      if (this.released >= this.spec.runSize && this.exited >= this.spec.runSize
        && this.stations.every((s) => s.cycle.status.state === 'WAITING')) {
        this.state = LINE_STATES.FINISHED;
        this.stations.forEach((s) => s.cycle.stop());
      }
    }
    this.emit();
  }

  emit() {
    this.onUpdate?.(this);
  }

  dispose() {
    this.reset();
    this.transfers.forEach((t) => t.conveyor.dispose());
    this.stations.forEach((s) => Object.values(s.equipment).forEach((e) => e.dispose()));
    this.root.removeFromParent();
  }

  // ---- Status ------------------------------------------------------------------------------------

  /** Units that have left the line: through every output port nothing is connected to. */
  get exited() {
    let n = 0;
    for (const s of this.stations) {
      for (const port of Object.values(s.cycle.ports)) {
        if (port.direction !== 'out' || this.connected.has(`${s.id}.${port.name}`)) continue;
        n += port.name === 'output' ? s.cycle.status.completed : s.cycle.status[`${port.name}Count`] ?? 0;
      }
    }
    return n;
  }

  get status() {
    const exited = this.exited;
    return {
      state: this.state,
      speed: this.speed,
      released: this.released,
      runSize: this.spec.runSize,
      inProcess: this.released - exited,
      exited,
      transfers: this.transfers.map((t) => (t.unit ? `${t.unit.api?.label ?? 'unit'} ${t.staged ? 'waiting' : 'moving'}` : 'empty')),
      stations: Object.fromEntries(this.stations.map((s) => [s.id, `${s.cycle.status.state.replace(/_/g, ' ')} · ${s.cycle.status.step}`])),
    };
  }

  /** Dry timing: each station's cycle (intake + process + output) and each transfer's travel. */
  get timing() {
    const stations = Object.fromEntries(this.stations.map((s) => [s.id, s.cycle.timing]));
    const bottleneck = this.stations.reduce((a, b) => (b.cycle.timing.cycleTime > a.cycle.timing.cycleTime ? b : a));
    return {
      stations,
      transfers: this.transfers.map((t) => ({ from: t.edge.from, to: t.edge.to, distance: t.distance, duration: t.duration })),
      bottleneck: { station: bottleneck.id, cycleTime: bottleneck.cycle.timing.cycleTime },
    };
  }
}

/** Station-local X range of the station conveyor (from its footprint and placement). */
function conveyorExtent(cycle, equipment) {
  const id = cycle.station.conveyor;
  const conveyor = equipment[id];
  const turn = ((conveyor.root.rotation.y % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  if (Math.abs(turn) > 1e-9 && Math.abs(turn - 2 * Math.PI) > 1e-9) {
    throw new LineError(`station "${cycle.id}": its conveyor "${id}" must run along the station's +X (rotationY 0)`);
  }
  const [lo, hi] = conveyor.footprint.x;
  return { start: conveyor.root.position.x + lo, end: conveyor.root.position.x + hi };
}
