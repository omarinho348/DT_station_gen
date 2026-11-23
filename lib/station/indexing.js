// Indexing stations: several BATCHES of units at named positions along one conveyor, moved together
// one position per machine cycle (an indexing transfer line: filling and capping lines, rotary
// tables, walking beams). Each machine cycle runs its phases in turn and skips a phase whose
// position is empty:
//
//   index   take a new batch in at the `enter` position (upstream, or stand-alone), then the
//           `index` ops; one of them, indexBatches, moves every batch on by one position
//   exit    the batch at the `exit` position leaves: `exitOps` (dischargeBatch carries it away),
//           then it is handed over through the output port; held while downstream is busy
//   <work>  for each `work` entry, its ops on the batch at its position (fill, cap…)
//
// A batch is a group of N units at a pitch along X that ops treat as THE product: stages, features,
// routines and refs come from the member's catalog definition and act on every member at once
// (createBatch). So the ordinary ops work unchanged on batches.
// This module is data and planning only (no StationCycle import); IndexingCycle.js plays it.
import * as THREE from 'three';
import { IndexingSpec } from './indexingSpec.js';

export { IndexingSpec };

/** The phases of a machine cycle, in order: { name, kind: 'index' | 'exit' | 'work', at?, ops }. */
export function indexingPhases(spec) {
  const byName = {
    index: { name: 'index', kind: 'index', ops: spec.index },
    exit: { name: 'exit', kind: 'exit', at: spec.exit, ops: spec.exitOps },
    ...Object.fromEntries(spec.work.map((w) => [w.at, { name: w.at, kind: 'work', at: w.at, ops: w.ops }])),
  };
  return (spec.order ?? ['index', 'exit', ...spec.work.map((w) => w.at)]).map((name) => byName[name]);
}

/** Distance one index moves every batch (the even position spacing). */
export const indexDistance = (spec) => spec.positions[1].x - spec.positions[0].x;

/**
 * Dry plan of an indexing station (no geometry), shaped like planStation's result so timing tables
 * and takt checks read it the same way: intake = the index phase, process = the work phases,
 * output = the exit phase, cycleTime = one full machine cycle (every position occupied).
 * `newCycle({ product })` gives a dry OpCycle; `indexing.phases` lists each phase's time.
 */
export function planIndexing(station, newCycle, wrap = (fn) => fn()) {
  const phases = indexingPhases(station.indexing);
  const planned = phases.map((phase) => {
    const cycle = newCycle();
    wrap(() => cycle.expand(phase.ops, phase.name));
    return { ...phase, duration: cycle.steps.reduce((sum, s) => sum + s.duration, 0), steps: cycle.steps };
  });
  const sum = (list) => ({ duration: list.reduce((a, p) => a + p.duration, 0), steps: list.flatMap((p) => p.steps) });
  const result = {
    station: station.id,
    intake: sum(planned.filter((p) => p.kind === 'index')),
    process: sum(planned.filter((p) => p.kind === 'work')),
    output: sum(planned.filter((p) => p.kind === 'exit')),
    exit: null,
    indexing: { phases: planned.map(({ name, kind, at, duration }) => ({ name, kind, at, duration })), members: station.indexing.members },
  };
  result.cycleTime = result.intake.duration + result.process.duration + result.output.duration;
  result.steps = planned.flatMap((p) => p.steps);
  return result;
}

/**
 * A batch: `members` (product instances) side by side at `pitch` along X under one group, offering
 * the product interface ops use. Stages, features and routines act on every member; refs are the
 * first member's, in the batch frame; `def` is the member's catalog definition.
 */
export function createBatch({ members, pitch, def, serial }) {
  const root = new THREE.Group();
  const label = `B${String(serial).padStart(4, '0')}`;
  root.name = `Batch ${label}`;
  const n = members.length;
  members.forEach((m, i) => {
    m.root.position.set((i - (n - 1) / 2) * pitch, 0, 0);
    root.add(m.root);
  });
  const first = members[0];
  return {
    isBatch: true,
    type: first.type,
    members,
    label,
    params: { serial },
    root,
    stages: def.stages,
    refs: def.refs,
    features: def.features,
    routines: def.routines,
    payloads: [],
    parts: [],
    cables: [],
    facts: first.facts,
    get stage() { return first.stage; },
    setStage(stage) { members.forEach((m) => m.setStage(stage)); },
    /** The first member's ref, in the batch frame. */
    ref(name) { return first.ref(name).add(first.root.position); },
    setFeature(name, value) { members.forEach((m) => m.setFeature(name, value)); },
    routine(name, args) {
      const handlers = members.map((m) => m.routine(name, args));
      return {
        start: () => handlers.forEach((h) => h.start?.()),
        update: (progress, previous) => handlers.map((h) => h.update?.(progress, previous))[0],
        end: () => handlers.map((h) => h.end?.())[0],
      };
    },
    api: first.api,
    dispose() {
      members.forEach((m) => m.dispose());
      root.removeFromParent();
    },
  };
}
