import { z } from 'zod';
import { defineOp } from '../../registry.js';
import { checkTiming, common, id, stateOf, timing } from '../args.js';

// Turns one axis: to an angle (the short way round on periodic axes), by an amount, which on a
// periodic axis may be many turns (a spindle, a bit, a turntable indexing), or by whole `turns`
// on an axis that declares its angle per range.
defineOp({
  op: 'rotate',
  summary: 'Turn one axis to a value (short way on periodic axes), by a relative amount, or by whole turns.',
  args: checkTiming(z.object({
    machine: id,
    motion: id,
    to: z.number().optional().describe('Target, in the motion unit'),
    by: z.number().optional().describe('Relative amount, in the motion unit'),
    turns: z.number().optional().describe('Whole turns (axes that declare an angle)'),
    ...timing,
    ...common,
  })).refine((a) => [a.to, a.by, a.turns].filter((v) => v !== undefined).length === 1, { message: 'give one of to, by or turns', path: ['to'] }),
  expand(cycle, a) {
    let by = a.by;
    if (a.turns !== undefined) {
      const spec = cycle.motionSpec(a.machine, a.motion);
      if (!spec.angle) cycle.fail(`machine "${a.machine}".${a.motion} declares no angle, so it cannot turn by whole turns`);
      by = ((a.turns * 2 * Math.PI) / spec.angle) * (spec.range[1] - spec.range[0]);
    }
    cycle.queueMotions({
      ...a,
      to: a.to !== undefined ? { [a.motion]: a.to } : {},
      by: by !== undefined ? { [a.motion]: by } : {},
      state: stateOf(cycle, a),
      label: a.label ?? `Turning ${a.machine}`,
    });
  },
});
