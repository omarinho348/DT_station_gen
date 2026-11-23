import { z } from 'zod';
import { defineOp } from '../../registry.js';
import { common, id, seconds, stateOf } from '../args.js';

// A machine does its work for a fixed time, shown only by its state and a progress bar: the
// process of a placeholder machine (a generic machine stands in for one nobody can build yet),
// or of any machine that offers a `state` (with `run` and `idle`) and a `progress` motion. The
// line keeps its timing; the twin shows the machine busy, then idle again.
defineOp({
  op: 'operate',
  summary: 'A machine works for a fixed time: its state shows run and its progress fills, then it is idle again (placeholder machines).',
  args: z.object({
    machine: id,
    seconds: seconds(3600),
    ...common,
  }),
  expand(cycle, a) {
    cycle.checkValue(a.machine, 'state', 'run');
    cycle.checkValue(a.machine, 'state', 'idle');
    if (!cycle.hasMotion(a.machine, 'progress')) cycle.fail(`machine "${a.machine}" has no motion "progress"`);
    cycle.queue(stateOf(cycle, a), a.label ?? `${a.machine} working`, a.seconds, a.status, {
      onStart: () => {
        cycle.drive(a.machine, 'state', 'run');
        cycle.drive(a.machine, 'progress', 0);
      },
      onUpdate: (progress) => cycle.drive(a.machine, 'progress', progress),
      onEnd: () => {
        cycle.drive(a.machine, 'progress', 0);
        cycle.drive(a.machine, 'state', 'idle');
      },
    });
    cycle.plan(a.machine, 'state', 'idle');
    cycle.plan(a.machine, 'progress', 0);
  },
});
