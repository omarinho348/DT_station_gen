import { z } from 'zod';
import { defineOp } from '../../registry.js';
import { common, seconds, stateOf } from '../args.js';

// Nothing moves for a time (curing, settling, a process the twin shows only as time).
defineOp({
  op: 'wait',
  summary: 'Wait for a fixed time (curing, settling, or a process shown only as time).',
  args: z.object({
    seconds: seconds(600),
    ...common,
  }),
  expand(cycle, a) {
    cycle.queue(stateOf(cycle, a), a.label ?? `Waiting ${a.seconds} s`, a.seconds, a.status);
  },
});
