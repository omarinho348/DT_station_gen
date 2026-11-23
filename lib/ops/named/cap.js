// Screws caps onto the product (a container, or every container of a batch) with a capping machine:
// head down until the caps meet the threads, tighten (the chucks turn and screw down by the thread
// lead, slowing as torque builds), torque reached (the caps pass to the containers), head up, fresh
// caps fed into the chucks. Port of the reference OilFillingCycle.planCapping, step for step and
// time for time by default.
//
// Generic: motions by role, never a component by name.
//   machine   headTravel (0 raised … 1 caps at the seat), spin (periodic chuck turn with an angle),
//             caps (loaded | empty), capFeed (0 up in the sleeve … 1 seated)
//   product   feature `cap` (its own cap shown), stage `capped` at hand-over
import { z } from 'zod';
import { defineOp } from '../../registry.js';
import { smoother } from '../../core/motion.js';
import { common, id, stateOf } from '../args.js';

const TIMING = { inPosition: 0.4, descend: 1.3, engage: 0.15, tighten: 1.2, torque: 0.25, retract: 1.3, feed: 0.7 };
const easeOut = (t) => 1 - (1 - t) * (1 - t);

defineOp({
  op: 'cap',
  summary: 'Screw caps onto the product (every container of a batch) with a capping machine: descend, tighten, hand the caps over, retract, feed new caps.',
  needs: { machineOp: 'cap' },
  args: z.object({
    machine: id,
    item: id.default('product'),
    units: z.string().min(1).max(20).default('Cans').describe('What is capped, for the step texts ("Cans in position")'),
    turns: z.number().min(0.5).max(10).default(3).describe('Tightening turns'),
    engageAt: z.number().min(0).max(1).default(0.95).describe('headTravel where the caps meet the threads (1 − thread lead / stroke; reference 1 − 0.012 / 0.26)'),
    timing: z.object(Object.fromEntries(Object.entries(TIMING).map(([k, v]) => [k, z.number().min(0).max(60).default(v)]))).default(TIMING),
    ...common,
  }),
  expand(cycle, a) {
    const m = a.machine;
    cycle.checkValue(m, 'headTravel', 0);
    cycle.checkValue(m, 'headTravel', a.engageAt);
    cycle.checkValue(m, 'caps', 'loaded');
    cycle.checkValue(m, 'caps', 'empty');
    cycle.checkValue(m, 'capFeed', 0);
    const spin = cycle.motionSpec(m, 'spin');
    if (!spin.wrap || !spin.angle) cycle.fail(`machine "${m}".spin must be periodic with an angle to turn the chucks`);
    const spec = cycle.itemSpec(a.item);
    if (spec && !spec.features?.cap) cycle.fail(`item "${a.item}" has no feature "cap"`);
    if (spec && !spec.stages?.includes('capped')) cycle.fail(`item "${a.item}" has no stage "capped"`);
    const state = stateOf(cycle, a);
    const t = a.timing;
    const turnBy = -((a.turns * 2 * Math.PI) / spin.angle) * (spin.range[1] - spin.range[0]);

    cycle.queue(state, `${a.units} in position`, t.inPosition, { cappingHead: 'RAISED', ...a.status });
    cycle.queueMotions({ machine: m, to: { headTravel: a.engageAt }, seconds: t.descend, state, label: 'Capping head descending', status: { cappingHead: 'DESCENDING' } });
    cycle.queue(state, 'Caps engaging threads', t.engage, { cappingHead: 'ENGAGED' });
    // The chucks slow down as torque builds; the caps screw down by the thread lead.
    cycle.queueMotions({
      machine: m, to: { headTravel: 1 }, by: { spin: turnBy }, seconds: t.tighten, ease: { headTravel: easeOut, spin: easeOut },
      state, label: 'Tightening caps', status: { cappingHead: 'TIGHTENING' },
    });
    cycle.queue(state, 'Torque reached', t.torque, { cappingHead: 'TORQUE OK' }, {
      onEnd: () => {
        // Hand-over: the chucks let go and the containers carry their own caps.
        cycle.drive(m, 'caps', 'empty');
        cycle.productItem(a.item).setStage('capped');
      },
    });
    cycle.plan(m, 'caps', 'empty');
    cycle.queueMotions({ machine: m, to: { headTravel: 0 }, seconds: t.retract, state, label: 'Capping head retracting', status: { cappingHead: 'RETRACTING' } });
    // Fresh caps slide down into the chucks (the chucks turned whole turns, so back to 0 is seamless).
    cycle.queue(state, 'Feeding new caps', t.feed, { cappingHead: 'RAISED' }, {
      onStart: () => {
        cycle.drive(m, 'spin', 0);
        cycle.drive(m, 'capFeed', 0);
        cycle.drive(m, 'caps', 'loaded');
      },
      onUpdate: (progress) => cycle.drive(m, 'capFeed', smoother(progress)),
      onEnd: () => cycle.drive(m, 'capFeed', 1),
    });
    cycle.plan(m, 'spin', 0);
    cycle.plan(m, 'caps', 'loaded');
    cycle.plan(m, 'capFeed', 1);
  },
});
