// The two ops of an indexing station (lib/station/indexing.js), played by IndexingCycle through the
// OpCycle's `indexer` hook. They move whole batches; the belts of the conveyors named scroll with
// them (every motion with a surface `travel`). Smooth (quintic) motion over a fixed time, as the
// reference filling line's index and discharge.
import { z } from 'zod';
import { defineOp } from '../../registry.js';
import { smoother } from '../../core/motion.js';
import { common, id, seconds, stateOf } from '../args.js';
import { beltAmount } from '../basic/transfer.js';

const belts = (cycle, conveyors) => conveyors.flatMap((c) => {
  cycle.machine(c);
  return Object.entries(cycle.specOf(c).motions ?? {}).filter(([, spec]) => spec.travel).map(([motion, spec]) => ({ c, motion, spec }));
});

/** One timed step that moves batches by `distance()` metres along +X and scrolls the belts. */
function queueBatchMove(cycle, a, label, { start, distance, end }) {
  const surfaces = belts(cycle, a.conveyors);
  let moving = [];
  let d = 0;
  cycle.queue(stateOf(cycle, a), a.label ?? label, a.seconds, { conveyor: 'RUNNING', ...a.status }, {
    onStart: () => {
      moving = start().map((root) => ({ root, x0: root.position.x }));
      d = distance();
    },
    onUpdate: (progress, previous) => {
      const k = smoother(progress);
      for (const m of moving) m.root.position.x = m.x0 + d * k;
      const travel = d * (k - smoother(previous));
      for (const { c, motion, spec } of surfaces) cycle.drive(c, motion, cycle.machine(c).state[motion] + beltAmount(spec, travel));
    },
    onEnd: () => end?.(),
  });
}

const needIndexer = (cycle, op) => {
  if (!cycle.dry && !cycle.indexer) cycle.fail(`${op} only works in an indexing station (station.indexing)`);
};

defineOp({
  op: 'indexBatches',
  summary: 'Indexing station: move every batch on by one position (the belts of the given conveyors scroll with them).',
  args: z.object({
    seconds: seconds(60),
    conveyors: z.array(id).min(1).describe('Conveyors whose belts carry the batches'),
    ...common,
  }),
  expand(cycle, a) {
    needIndexer(cycle, 'indexBatches');
    if (cycle.dry) {
      belts(cycle, a.conveyors);
      cycle.queue(stateOf(cycle, a), a.label ?? 'Indexing', a.seconds, { conveyor: 'RUNNING', ...a.status });
      return;
    }
    const ix = cycle.indexer;
    queueBatchMove(cycle, a, 'Indexing', { start: () => ix.batchRoots(), distance: () => ix.indexDistance, end: () => ix.indexed() });
  },
});

defineOp({
  op: 'dischargeBatch',
  summary: 'Indexing station: carry the batch at the exit position `distance` m on along +X (out of the station).',
  args: z.object({
    seconds: seconds(60),
    distance: z.number().positive().max(10).describe('How far it is carried (m)'),
    conveyors: z.array(id).min(1).describe('Conveyors whose belts carry it'),
    ...common,
  }),
  expand(cycle, a) {
    needIndexer(cycle, 'dischargeBatch');
    if (cycle.dry) {
      belts(cycle, a.conveyors);
      cycle.queue(stateOf(cycle, a), a.label ?? 'Discharging', a.seconds, { conveyor: 'RUNNING', ...a.status });
      return;
    }
    queueBatchMove(cycle, a, 'Discharging', { start: () => [cycle.item('product')], distance: () => a.distance });
  },
});
