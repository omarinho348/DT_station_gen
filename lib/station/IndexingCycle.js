// Plays an indexing station (station.indexing, see indexing.js): batches of units at positions
// along one conveyor, moved together one position per machine cycle. Each machine cycle runs the
// phases in order (default: index, exit, then the work positions) and skips a phase that has
// nothing to do, as the reference filling line does:
//
//   index  a new batch is taken in at `enter` (from upstream, or made stand-alone) if that place
//          is free, then the index ops run; indexBatches moves every batch on by one position.
//          Skipped when there is no batch at all; held while the last position is still occupied.
//   exit   the batch at `exit` runs the exit ops (dischargeBatch) and leaves through the output
//          port. Held (re-checked) while downstream is busy.
//   work   the batch at that position runs the position's ops (fill, cap…).
//
// Everything else (ports, signals, HMI status, stock, connections) is StationCycle's.
import { Vector3 } from 'three';
import { OpCycle } from '../ops/index.js';
import { StationCycle, STATION_STATES } from './StationCycle.js';
import { StationError } from './stationSpec.js';
import { createBatch, indexingPhases, indexDistance } from './indexing.js';

export class IndexingCycle extends StationCycle {
  constructor(options) {
    super(options);
    if (!this.station.indexing) throw new StationError(`station "${this.station.id}" has no indexing spec`);
  }

  get spec() {
    return this.station.indexing;
  }

  reset() {
    // Before StationCycle.reset (which frees owned units): forget the batches.
    this.atPosition = new Array(this.station.indexing?.positions.length ?? 0).fill(null);
    this.phaseList = this.station.indexing ? indexingPhases(this.station.indexing) : [];
    this.phaseIndex = 0;
    this.batchCounter = 0;
    super.reset();
    // Batches already waiting when the station starts (stand-alone: new ones; in a line: released by it).
    for (const name of this.station.indexing?.preload ?? []) {
      const batch = this.ports.input?.take();
      if (!batch) break;
      this.adopt(batch);
      batch.root.position.copy(this.positionPoint(name));
      this.atPosition[this.positionIndex(name)] = batch;
    }
    this.countBatches();
  }

  // ---- Positions -----------------------------------------------------------------------------------

  positionIndex(name) {
    return this.spec.positions.findIndex((p) => p.name === name);
  }

  /** Station-frame point of a position: on the conveyor's centre line at belt height. */
  positionPoint(name) {
    const base = this.portInStation('input');
    return new Vector3(this.spec.positions[this.positionIndex(name)].x, base.y, base.z);
  }

  batchAt(name) {
    return this.atPosition[this.positionIndex(name)];
  }

  countBatches() {
    this.status.batchesOnLine = this.atPosition.filter(Boolean).length;
  }

  /** What indexBatches / dischargeBatch need (the OpCycle's `indexer`). */
  indexerApi() {
    return {
      indexDistance: indexDistance(this.spec),
      batchRoots: () => this.atPosition.filter(Boolean).map((b) => b.root),
      indexed: () => {
        for (let i = this.atPosition.length - 1; i > 0; i -= 1) this.atPosition[i] = this.atPosition[i - 1];
        this.atPosition[0] = null;
      },
    };
  }

  // ---- Stand-alone feed and output -------------------------------------------------------------------

  /** A new batch of units at the input stage (stand-alone feed), placed at `enter` by the caller. */
  createIncoming() {
    if (!this.createProductFn) return null;
    this.batchCounter += 1;
    const members = Array.from({ length: this.spec.members }, () => this.createProductFn({ serial: this.nextSerial(), stage: this.station.inputStage }));
    this.drawSupply('units', members.length);
    const def = this.registry.getProduct(members[0].type);
    return createBatch({ members, pitch: this.spec.pitch, def, serial: this.batchCounter });
  }

  /** Stand-alone output: the discharged batch leaves the cell. */
  retire(batch) {
    this.discard(batch);
  }

  // ---- Planning: one phase of the machine cycle at a time ---------------------------------------------

  planNext() {
    const n = this.phaseList.length;
    for (let attempt = 0; attempt < n; attempt += 1) {
      const phase = this.phaseList[this.phaseIndex];
      const result = this.planPhase(phase);
      if (result === 'hold') return; // retried next time, same phase
      this.phaseIndex = (this.phaseIndex + 1) % n;
      if (result === 'planned') return;
    }
    this.hold(STATION_STATES.WAITING, this.ports.input.waiting ?? 'Waiting for units');
  }

  phaseCycle(batch) {
    return new OpCycle({
      registry: this.registry,
      sequencer: this.sequencer,
      equipment: this.equipment,
      product: batch,
      facts: batch ? this.factsFor(batch) : {},
      workState: this.station.workState,
      conventions: this.conventions,
      items: this.stock,
      restock: (names) => this.restock(names),
      setStatus: (patch) => Object.assign(this.status, patch),
      ctx: this.ctx,
      stacks: this.stackApi(),
      onSpawn: (made) => this.made.add(made),
      indexer: this.indexerApi(),
    });
  }

  /** Plans one phase. Returns 'planned', 'skip' (nothing to do) or 'hold' (blocked; held and retried). */
  planPhase(phase) {
    if (phase.kind === 'index') return this.planIndex(phase);
    const batch = this.batchAt(phase.at);
    if (!batch) return 'skip';
    if (phase.kind === 'exit') {
      if (!this.ports.output.ready()) {
        this.hold(STATION_STATES.HOLDING, 'Holding · downstream busy');
        return 'hold';
      }
      this.phaseCycle(batch).expand(phase.ops, 'exit');
      this.afterLastStep(() => {
        this.atPosition[this.positionIndex(phase.at)] = null;
        this.status.completed += 1;
        this.countBatches();
        this.release(batch);
        this.ports.output.put(batch);
      });
      return 'planned';
    }
    this.status.unit = batch.label;
    this.phaseCycle(batch).expand(phase.ops, phase.at);
    return 'planned';
  }

  planIndex(phase) {
    // Back-pressure at the cycle boundary: wait while the next station is still busy with a batch.
    if (this.spec.startWhen === 'downstreamEmpty' && !(this.ports.output.downstreamEmpty?.() ?? true) && this.atPosition.some(Boolean)) {
      this.hold(STATION_STATES.HOLDING, 'Holding · downstream busy');
      return 'hold';
    }
    const last = this.atPosition.length - 1;
    if (this.atPosition[last]) {
      this.hold(STATION_STATES.HOLDING, `Holding · batch at ${this.spec.positions[last].name}`);
      return 'hold';
    }
    const enter = this.positionIndex(this.spec.enter);
    if (!this.atPosition[enter]) {
      const batch = this.ports.input.take();
      if (batch) {
        this.adopt(batch);
        batch.root.position.copy(this.positionPoint(this.spec.enter));
        this.atPosition[enter] = batch;
        this.status.unit = batch.label;
      }
    }
    if (!this.atPosition.some(Boolean)) return 'skip';
    this.status.cycles += 1;
    this.phaseCycle(null).expand(phase.ops, 'index');
    this.afterLastStep(() => this.countBatches());
    return 'planned';
  }
}
