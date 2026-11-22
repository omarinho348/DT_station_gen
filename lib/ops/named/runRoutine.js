import { z } from 'zod';
import { defineOp } from '../../registry.js';
import { common, id, seconds, stateOf } from '../args.js';
import { checkCalls, checkRoutine, routineCall, runInstant } from '../routines.js';

// The product does something by itself for a fixed time: a printer under test homes, probes,
// heats, prints (its firmware); the station only says when and for how long. The routine's
// status values (temperatures, progress, measurements) feed the HMI as it runs. `before` /
// `after` are instant routine calls at the start / end of the step (e.g. a line on the LCD).
defineOp({
  op: 'runRoutine',
  summary: 'Let the product run one of its routines (test firmware: homing, probing, heating, printing…) for a fixed time.',
  args: z.object({
    item: id.default('product'),
    routine: id,
    args: z.record(z.string(), z.unknown()).default({}),
    seconds: seconds(600),
    before: z.array(routineCall).max(4).default([]),
    after: z.array(routineCall).max(4).default([]),
    ...common,
  }),
  expand(cycle, a) {
    checkRoutine(cycle, a.item, a.routine, a.args);
    checkCalls(cycle, [...a.before, ...a.after]);
    let handler = null;
    cycle.queue(stateOf(cycle, a), a.label ?? `${a.item}: ${a.routine}`, a.seconds, a.status, {
      onStart: () => {
        runInstant(cycle, a.before);
        handler = cycle.productItem(a.item).routine(a.routine, a.args);
        handler.start?.();
      },
      onUpdate: (progress, previous) => {
        const status = handler.update?.(progress, previous);
        if (status) cycle.setStatus(status);
      },
      onEnd: () => {
        const status = handler.end?.();
        if (status) cycle.setStatus(status);
        runInstant(cycle, a.after);
      },
    });
  },
});
