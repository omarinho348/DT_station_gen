// A production line: stations chained through their typed ports by transfers. Generic port of the
// reference PrinterAssemblyLine.js. Stations are the same StationCycles that run stand-alone,
// unchanged; the line only replaces their ports:
//
//   first.input    ← new units released from the return line (runSize per run)
//   a.output       → transfer conveyor → b.input        (a conveyor edge)
//   a.output       → b.input, where the ports meet      (a direct edge: handed over where it stands)
//   last.output    → down the lift to the return line   (the station's stand-alone default)
//   unconnected extra outputs (a reject lane) keep their stand-alone default too
//
// Each transfer holds one unit, or up to its `capacity` queued along it (a buffer). While it is
// full the upstream output port is not ready and that station holds at its cycle boundary
// (back-pressure); a downstream station waits at its input until a unit has arrived at the end of
// the transfer.
//
// Graph shapes (Phase 6 step 6): an output port feeding several edges (parallel copies, a split)
// hands each unit to the first of them with room, taking turns; an input fed by several edges (a
// merge) takes the unit that has waited longest; a station's other output ports (a reject lane) may
// feed a station of their own. Every station nothing feeds is a source: the run's units are released
// through all of them together. Units keep their identity (the same
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
import { endpoint, layoutLine, runExtent } from './layout.js';
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
      stations: this.stations.map((s) => ({ id: s.id, extent: s.extent, ports: portPlaces(s.cycle), depth: s.depth, group: s.group })),
      edges: this.spec.edges.map((e) => ({ ...e, direct: e.transport.kind === 'direct' })),
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
      return { id: data.id, root, equipment, cycle, extent: conveyorExtent(cycle, equipment), depth: depthOf(root), group: data.copyOf ?? data.id };
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
    // Every edge: a transfer conveyor, or a direct hand-over where the ports meet.
    this.transfers = this.spec.edges.map((edge, index) => {
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
      if (edge.transport.kind === 'direct') {
        const gap = this.toLine(up, up.cycle.portInStation(from.port)).distanceTo(this.toLine(down, down.cycle.portInStation(to.port)));
        if (gap > 1e-6) throw new LineError(`${where}: a direct edge needs the ports to meet; they are ${gap.toFixed(3)} m apart`);
        return { index, edge, from, to, up, down, direct: true, capacity: 1, conveyor: null, distance: 0, duration: 0, belts: [], unit: null, elapsed: 0, staged: true, queue: [] };
      }
      const t = this.layout.transfers.find((x) => x.edge === index);

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
      conveyor.root.position.set(t.centre, 0, t.z ?? 0);
      conveyor.root.rotation.y = -(t.angle ?? 0); // a transfer between ports not in line runs at an angle
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
        // A buffer: up to `capacity` units queued along the transfer, `pitch` apart.
        capacity: edge.transport.capacity ?? 1, pitch: distance / (edge.transport.capacity ?? 1), queue: [],
      };
    });
  }

  toLine(station, point) {
    return this.root.worldToLocal(station.root.localToWorld(point.clone()));
  }

  /** Replaces the ports the line connects; hides equipment that served them stand-alone. */
  wire() {
    // Sources: every station nothing feeds. The run's units are released through all of them.
    const fed = new Set(this.spec.edges.map((e) => endpoint(e.to).station));
    for (const source of this.stations.filter((s) => !fed.has(s.id))) {
      // One numbering for the whole line: serials stay unique with several sources (quality and
      // labels go by serial).
      source.cycle.serialSource = () => { this.serials += 1; return this.serials; };
      const port = source.cycle.ports.input;
      if (!port) continue;
      const standaloneTake = port.take;
      const standaloneAvailable = port.available;
      Object.assign(port, {
        take: () => {
          if (this.released >= this.spec.runSize) return null;
          const unit = standaloneTake();
          if (unit) this.released += 1;
          return unit;
        },
        available: () => this.released < this.spec.runSize && (standaloneAvailable?.() ?? true),
        waiting: 'Run complete · all carriers released',
      });
    }
    this.connected = new Set();
    const groupBy = (key) => {
      const groups = new Map();
      for (const t of this.transfers) {
        const k = key(t);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(t);
      }
      return [...groups.values()];
    };
    const show = (station, port) => {
      this.connected.add(`${station.id}.${port.name}`);
      for (const m of port.standalone) station.equipment[m].root.visible = false;
      for (const m of port.connected ?? []) station.equipment[m].root.visible = true;
    };
    // Outputs: each unit to the first edge with room, taking turns (parallel copies share the work).
    for (const list of groupBy((t) => `${t.up.id}.${t.from.port}`)) {
      const { up, from } = list[0];
      const out = up.cycle.ports[from.port];
      let turn = 0;
      const withRoom = () => {
        for (let k = 0; k < list.length; k += 1) {
          const t = list[(turn + k) % list.length];
          if (this.hasRoom(t)) return t;
        }
        return null;
      };
      out.ready = () => withRoom() !== null;
      // Nothing handed over and nothing in the next station, on some edge.
      out.downstreamEmpty = () => list.some((t) => this.isEmpty(t) && !t.down.cycle.unit);
      out.put = (unit) => {
        const t = withRoom();
        turn = (list.indexOf(t) + 1) % list.length;
        if (t.direct) Object.assign(t, { unit, stagedAt: this.clock });
        else if (t.capacity > 1) this.enqueue(t, unit);
        else this.beginTransfer(t, unit);
      };
      show(up, out);
    }
    // Inputs: the unit that has waited longest, from whichever edge it came.
    for (const list of groupBy((t) => `${t.down.id}.${t.to.port}`)) {
      const { down, to } = list[0];
      const into = down.cycle.ports[to.port];
      const oldest = () => {
        let best = null;
        for (const t of list) if (this.isStaged(t) && (!best || this.stagedAt(t) < this.stagedAt(best))) best = t;
        return best;
      };
      into.take = () => {
        const t = oldest();
        return t ? this.takeStaged(t) : null;
      };
      into.available = () => oldest() !== null;
      into.waiting = `Waiting for ${[...new Set(list.map((t) => t.up.cycle.station.code ?? t.up.id))].join(' / ')}`;
      show(down, into);
    }
  }

  /** Room for one more unit at the start of the transfer. */
  hasRoom(t) {
    if (t.capacity <= 1) return t.unit === null;
    const last = t.queue.at(-1);
    return t.queue.length < t.capacity && (!last || last.s >= t.pitch - 1e-9);
  }

  isEmpty(t) {
    return t.capacity <= 1 ? t.unit === null : t.queue.length === 0;
  }

  /** A unit waits at the end of the transfer for the next station. */
  isStaged(t) {
    if (t.capacity <= 1) return Boolean(t.unit && t.staged);
    const head = t.queue[0];
    return Boolean(head && head.s >= t.distance - 1e-9 && head.elapsed >= head.duration);
  }

  stagedAt(t) {
    return (t.capacity <= 1 ? t.stagedAt : t.queue[0]?.stagedAt) ?? 0;
  }

  beginTransfer(t, unit) {
    this.root.attach(unit.root);
    unit.root.position.copy(t.fromPos);
    Object.assign(t, { unit, elapsed: 0, staged: false });
  }

  takeStaged(t) {
    if (t.capacity > 1) return this.dequeue(t);
    if (!t.unit || !t.staged) return null;
    const { unit } = t;
    if (t.direct) { // handed over where it stands
      t.unit = null;
      return unit;
    }
    unit.root.position.copy(t.toPos);
    Object.assign(t, { unit: null, elapsed: 0, staged: false });
    return unit; // the station adopts it (re-parents it into its own frame)
  }

  advanceTransfer(t, time) {
    if (t.capacity > 1) { this.advanceBuffer(t, time); return; }
    if (!t.unit || t.staged || t.direct) return;
    const { speed, ramp } = this.conventions.conveyor;
    const before = trapezoidTravel(Math.min(t.elapsed, t.duration), t.distance, speed, ramp);
    t.elapsed = Math.min(t.elapsed + time, t.duration);
    const now = trapezoidTravel(t.elapsed, t.distance, speed, ramp);
    t.unit.root.position.lerpVectors(t.fromPos, t.toPos, t.distance > 0 ? now / t.distance : 1);
    for (const [motion, spec] of t.belts) {
      const amount = ((now - before) / spec.travel) * (spec.range[1] - spec.range[0]);
      t.conveyor.set(motion, wrapValue(t.conveyor.state[motion] + amount, spec.range));
    }
    if (t.elapsed >= t.duration && !t.staged) Object.assign(t, { staged: true, stagedAt: this.clock });
  }

  // ---- Buffers: several units queued along one transfer ------------------------------------------

  /** A unit enters the buffer at its start and runs to its place in the queue. */
  enqueue(t, unit) {
    this.root.attach(unit.root);
    unit.root.position.copy(t.fromPos);
    t.queue.push({ unit, s: 0, s0: 0, target: -1, elapsed: 0, duration: 0, stagedAt: 0 });
    this.retarget(t);
  }

  /** Every queued unit runs, from where it is, to its place: the head to the end, the others a pitch apart behind it. */
  retarget(t) {
    const { speed, ramp } = this.conventions.conveyor;
    t.queue.forEach((q, i) => {
      const target = Math.max(0, t.distance - i * t.pitch);
      if (Math.abs(target - q.target) < 1e-12) return; // already going there (or there)
      const span = Math.abs(target - q.s);
      Object.assign(q, { s0: q.s, target, elapsed: 0, duration: span < 1e-12 ? 0 : trapezoidDuration(span, speed, ramp) });
      if (q.duration === 0 && i === 0 && target >= t.distance - 1e-9) q.stagedAt = this.clock;
    });
  }

  dequeue(t) {
    if (!this.isStaged(t)) return null;
    const [head] = t.queue.splice(0, 1);
    head.unit.root.position.copy(t.toPos);
    this.retarget(t);
    return head.unit; // the station adopts it
  }

  advanceBuffer(t, time) {
    const { speed, ramp } = this.conventions.conveyor;
    let moved = 0;
    t.queue.forEach((q, i) => {
      if (q.elapsed >= q.duration) return;
      const before = q.s;
      q.elapsed = Math.min(q.elapsed + time, q.duration);
      const span = q.target - q.s0;
      q.s = q.elapsed >= q.duration ? q.target : q.s0 + Math.sign(span) * trapezoidTravel(q.elapsed, Math.abs(span), speed, ramp);
      if (q.elapsed >= q.duration && i === 0 && q.target >= t.distance - 1e-9) q.stagedAt = this.clock;
      q.unit.root.position.lerpVectors(t.fromPos, t.toPos, t.distance > 0 ? q.s / t.distance : 1);
      moved = Math.max(moved, q.s - before);
    });
    for (const [motion, spec] of t.belts) {
      const amount = (moved / spec.travel) * (spec.range[1] - spec.range[0]);
      t.conveyor.set(motion, wrapValue(t.conveyor.state[motion] + amount, spec.range));
    }
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
      for (const q of t.queue) { q.unit.root.removeFromParent(); q.unit.dispose(); }
      Object.assign(t, { unit: null, elapsed: 0, staged: Boolean(t.direct), stagedAt: 0, queue: [] });
    }
    this.clock = 0;
    // Count from zero before the stations reset: a station that starts with units already in it
    // (an indexing station's preloaded batch) takes them through the counted input.
    this.released = 0;
    this.serials = 0;
    this.stations.forEach((s) => s.cycle.reset());
    this.state = LINE_STATES.IDLE;
    this.emit();
  }

  setSpeed(speed) {
    this.speed = speed;
    this.stations.forEach((s) => s.cycle.setSpeed(speed));
  }

  update(delta) {
    // Stations first (flow order), then what carries units between them: transfer stations and the
    // transfer conveyors (as the reference lines: a unit a station took frees its feeder this frame).
    this.stations.forEach((s) => { if (s.cycle.station.role !== 'transfer') s.cycle.update(delta); });
    this.stations.forEach((s) => { if (s.cycle.station.role === 'transfer') s.cycle.update(delta); });
    if (this.state === LINE_STATES.RUNNING) {
      const time = delta * this.speed;
      this.clock += time;
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
    this.transfers.forEach((t) => t.conveyor?.dispose());
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
      transfers: this.transfers.map((t) => {
        if (t.capacity > 1) return `${t.queue.length}/${t.capacity} queued`;
        return t.unit ? `${t.unit.api?.label ?? 'unit'} ${t.staged ? 'waiting' : 'moving'}` : 'empty';
      }),
      stations: Object.fromEntries(this.stations.map((s) => [s.id, `${s.cycle.status.state.replace(/_/g, ' ')} · ${s.cycle.status.step}`])),
    };
  }

  /** Dry timing: each station's cycle (intake + process + output) and each transfer's travel. */
  get timing() {
    const stations = Object.fromEntries(this.stations.map((s) => [s.id, s.cycle.timing]));
    const bottleneck = this.stations.reduce((a, b) => (b.cycle.timing.cycleTime > a.cycle.timing.cycleTime ? b : a));
    return {
      stations,
      transfers: this.transfers.filter((t) => !t.direct).map((t) => ({ from: t.edge.from, to: t.edge.to, distance: t.distance, duration: t.duration })),
      bottleneck: { station: bottleneck.id, cycleTime: bottleneck.cycle.timing.cycleTime },
    };
  }
}

/** A station's Z range [min, max] in its own frame, from its equipment (for side lanes and copies). */
function depthOf(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  return box.isEmpty() ? [-1, 1] : [box.min.z, box.max.z];
}

/** A station's port places { name: { x, z } } in its own frame (for the layout). */
function portPlaces(cycle) {
  return Object.fromEntries(Object.keys(cycle.ports).map((name) => {
    const p = cycle.portInStation(name);
    return [name, { x: p.x, z: p.z }];
  }));
}

/**
 * Station-local X range the station's units run along: from the start of the station conveyor (or
 * of the input port's machine, if that starts earlier) to the end of the conveyor (or of the output
 * port's machine: a station whose units leave on an outfeed belt).
 */
function conveyorExtent(cycle, equipment) {
  const id = cycle.station.conveyor;
  const conveyor = equipment[id];
  const turn = ((conveyor.root.rotation.y % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  if (Math.abs(turn) > 1e-9 && Math.abs(turn - 2 * Math.PI) > 1e-9) {
    throw new LineError(`station "${cycle.id}": its conveyor "${id}" must run along the station's +X (rotationY 0)`);
  }
  const span = (m) => {
    const e = equipment[m];
    return Math.abs(e.root.rotation.y) < 1e-9 ? [e.root.position.x + e.footprint.x[0], e.root.position.x + e.footprint.x[1]] : null;
  };
  return runExtent(span(id), span(cycle.portSpecs.input.machine), span(cycle.portSpecs.output.machine));
}
