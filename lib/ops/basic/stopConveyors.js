import { z } from 'zod';
import { defineOp } from '../../registry.js';
import { stoppingTravel } from '../../core/motion.js';
import { wrapValue } from '../OpCycle.js';
import { common, id, stateOf } from '../args.js';
import { beltAmount } from './transfer.js';

// Running belts come to a stop: they decelerate from the belt speed over the ramp time, their
// surfaces scrolling the stopping distance (after accumulate with stopping: false).
defineOp({
  op: 'stopConveyors',
  summary: 'Running belts decelerate to a stop over the ramp time (their surfaces scroll the stopping distance).',
  args: z.object({
    conveyors: z.array(id).min(1).max(6),
    speed: z.number().positive().max(5).optional().describe('Belt speed they stop from, m/s (default: line conveyor speed)'),
    ramp: z.number().min(0.01).max(5).optional().describe('Stopping time, s (default: line conveyor ramp)'),
    ...common,
  }),
  expand(cycle, a) {
    const speed = a.speed ?? cycle.conventions.conveyor.speed;
    const ramp = a.ramp ?? cycle.conventions.conveyor.ramp;
    const belts = a.conveyors.flatMap((c) => {
      cycle.machine(c);
      return Object.entries(cycle.specOf(c).motions ?? {}).filter(([, spec]) => spec.travel).map(([motion, spec]) => ({ c, motion, spec }));
    });
    if (!belts.length) cycle.fail(`none of ${a.conveyors.join(', ')} has a moving surface`);
    for (const b of belts) {
      const planned = cycle.planned(b.c, b.motion);
      if (typeof planned === 'number') cycle.plan(b.c, b.motion, wrapValue(planned + beltAmount(b.spec, stoppingTravel(1, speed, ramp)), b.spec.range));
    }
    cycle.queue(stateOf(cycle, a), a.label ?? 'Conveyors stopping', ramp, { conveyor: 'STOPPING', ...a.status }, {
      onUpdate: (progress, previous) => {
        const metres = stoppingTravel(progress, speed, ramp) - stoppingTravel(previous, speed, ramp);
        for (const b of belts) cycle.drive(b.c, b.motion, cycle.machine(b.c).state[b.motion] + beltAmount(b.spec, metres));
      },
    });
  },
});
