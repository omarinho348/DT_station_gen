import { z } from 'zod';
import { defineOp } from '../../registry.js';
import { checkTiming, common, id, stateOf, timing } from '../args.js';
import { checkCalls, checkRoutine, routineAlong, routineCall, runInstant } from '../routines.js';

// Moves one or more axes of a machine together (a robot's tool point, a slide, a door).
// Values are in each motion's own unit (metres, radians, 0–1). Periodic axes take the short way.
// `before` / `after`: instant product routine calls at the start / end of the move (a test
// connector docks, and the printer's screen changes as it does).
defineOp({
  op: 'move',
  summary: 'Move one or more axes of a machine together to target values (to) or by amounts (by).',
  args: checkTiming(z.object({
    machine: id,
    to: z.record(id, z.number()).default({}).describe('Absolute targets per motion'),
    by: z.record(id, z.number()).default({}).describe('Relative amounts per motion'),
    ...timing,
    switches: z.record(id, z.string()).default({}).describe('Value motions of the same machine switched at the start (lights on)'),
    before: z.array(routineCall).max(4).default([]).describe('Product routines run at the start'),
    after: z.array(routineCall).max(4).default([]).describe('Product routines run at the end'),
    routine: routineCall.optional().describe('A product routine driven by the move\'s progress (tape laid as the head runs)'),
    ...common,
  })),
  expand(cycle, a) {
    checkCalls(cycle, [...a.before, ...a.after]);
    if (a.routine) {
      if (!a.routine.routine) cycle.fail('"routine" needs a routine name');
      checkRoutine(cycle, a.routine.item, a.routine.routine, a.routine.args);
    }
    const along = a.routine ? routineAlong(cycle, a.routine) : null;
    for (const [motion, value] of Object.entries(a.switches)) cycle.checkValue(a.machine, motion, value);
    const start = () => {
      for (const [motion, value] of Object.entries(a.switches)) cycle.drive(a.machine, motion, value);
      runInstant(cycle, a.before);
      along?.onStart();
    };
    for (const [motion, value] of Object.entries(a.switches)) cycle.plan(a.machine, motion, value);
    cycle.queueMotions({
      ...a,
      state: stateOf(cycle, a),
      label: a.label ?? `Moving ${a.machine}`,
      status: a.status,
      onStart: start,
      onUpdate: along ? (p) => along.onUpdate(p) : undefined,
      onEnd: () => {
        along?.onEnd();
        runInstant(cycle, a.after);
      },
    });
  },
});
