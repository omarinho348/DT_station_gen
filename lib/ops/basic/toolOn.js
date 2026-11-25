import { z } from 'zod';
import { defineOp } from '../../registry.js';
import { common, id, seconds, stateOf } from '../args.js';

// Switches a tool or signal (lights, laser, vacuum, a test lamp) to a value, optionally for a time
// and then to another value.
defineOp({
  op: 'toolOn',
  summary: 'Switch a tool or signal to a value, optionally hold it for a time, then switch to another value.',
  args: z.object({
    machine: id,
    motion: id.describe('An on/off (or multi-value) motion'),
    value: z.string().describe('Value while on'),
    then: z.string().optional().describe('Value after the time is up'),
    seconds: seconds(600).default(0),
    ...common,
  }),
  needs: { valueMotion: true },
  expand(cycle, a) {
    cycle.checkValue(a.machine, a.motion, a.value);
    if (a.then !== undefined) cycle.checkValue(a.machine, a.motion, a.then);
    cycle.queue(stateOf(cycle, a), a.label ?? `${a.machine} ${a.motion} ${a.value}`, a.seconds, a.status, {
      onStart: () => cycle.drive(a.machine, a.motion, a.value),
      onEnd: () => { if (a.then !== undefined) cycle.drive(a.machine, a.motion, a.then); },
    });
    cycle.plan(a.machine, a.motion, a.then ?? a.value);
  },
});
