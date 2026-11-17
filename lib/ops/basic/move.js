import { z } from 'zod';
import { defineOp } from '../../registry.js';
import { checkTiming, common, id, stateOf, timing } from '../args.js';

// Moves one or more axes of a machine together (a robot's tool point, a slide, a door).
// Values are in each motion's own unit (metres, radians, 0–1). Periodic axes take the short way.
defineOp({
  op: 'move',
  summary: 'Move one or more axes of a machine together to target values (to) or by amounts (by).',
  args: checkTiming(z.object({
    machine: id,
    to: z.record(id, z.number()).default({}).describe('Absolute targets per motion'),
    by: z.record(id, z.number()).default({}).describe('Relative amounts per motion'),
    ...timing,
    ...common,
  })),
  expand(cycle, a) {
    cycle.queueMotions({ ...a, state: stateOf(cycle, a), label: a.label ?? `Moving ${a.machine}`, status: a.status });
  },
});
