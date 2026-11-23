// Fills the product (a container, or every container of a batch) through a filling machine's
// nozzles: head down into the necks, valves open (the jets fall from the tips), dispense (a fast
// bulk fill, then a slow top-off), valves close (the jet tails drop away), drip, head up. Port of
// the reference OilFillingCycle.planFilling, step for step and time for time by default.
//
// Generic: it drives motions by role and reads points by name, never a component by name.
//   machine   headTravel (0 raised … 1 tips in the necks), jetStart / jetEnd (m below the tips),
//             anchor `tip` (the nozzle tips)
//   product   routine `fill` (raises the liquid level), ref `liquidSurface` (where a jet lands),
//             stage `filled` at the end
//   supply    optional: a machine whose level motion drops by `draw` per fill (the supply tank)
import { z } from 'zod';
import { defineOp } from '../../registry.js';
import { common, id, stateOf } from '../args.js';
import { checkRoutine } from '../routines.js';
import { UNKNOWN } from '../OpCycle.js';

const TIMING = { inPosition: 0.4, descend: 1.5, engage: 0.3, valveOpen: 0.35, dispense: 5, valveClose: 0.35, drip: 0.3, retract: 1.4, after: 0.3 };

const easeOut = (t) => 1 - (1 - t) * (1 - t);
/** Two-stage fill: fast bulk fill to 85 %, then a slow top-off as the valve throttles (reference). */
export const fillCurve = (t) => (t < 0.75 ? 0.85 * (t / 0.75) : 0.85 + 0.15 * easeOut((t - 0.75) / 0.25));

defineOp({
  op: 'fill',
  summary: 'Fill the product (every container of a batch) through a filling machine: head down, valves open, dispense, valves close, head up.',
  needs: { machineOp: 'fill' },
  args: z.object({
    machine: id,
    item: id.default('product'),
    units: z.string().min(1).max(20).default('Cans').describe('What is filled, for the step texts ("Cans in position")'),
    liquid: z.string().min(1).max(20).default('oil').describe('What is dispensed, for the step texts ("Dispensing oil")'),
    timing: z.object(Object.fromEntries(Object.entries(TIMING).map(([k, v]) => [k, z.number().min(0).max(60).default(v)]))).default(TIMING),
    supply: z.object({
      machine: id,
      motion: id.default('level'),
      draw: z.number().min(0).max(1).default(0.04).describe('Level drop per fill'),
      refillBelow: z.number().min(0).max(1).default(0.35),
      refillTo: z.number().min(0).max(1).default(0.88),
    }).optional().describe('A supply whose level drops with every fill (refilled at once below refillBelow)'),
    ...common,
  }),
  expand(cycle, a) {
    const m = a.machine;
    cycle.checkValue(m, 'headTravel', 0);
    cycle.checkValue(m, 'headTravel', 1);
    cycle.motionSpec(m, 'jetStart');
    cycle.motionSpec(m, 'jetEnd');
    cycle.checkAnchor(m, 'tip');
    checkRoutine(cycle, a.item, 'fill', {});
    const spec = cycle.itemSpec(a.item);
    if (spec && !spec.refs?.includes('liquidSurface')) cycle.fail(`item "${a.item}" has no ref "liquidSurface" (where the jets land)`);
    if (spec && !spec.stages?.includes('filled')) cycle.fail(`item "${a.item}" has no stage "filled"`);
    if (a.supply) cycle.motionSpec(a.supply.machine, a.supply.motion);
    const state = stateOf(cycle, a);
    const t = a.timing;
    const product = () => cycle.productItem(a.item);

    // How far a jet falls: from the nozzle tips to the liquid surface (live, as the level rises).
    const drop = () => {
      const tip = cycle.machine(m).anchor('tip');
      tip.updateWorldMatrix(true, false);
      const p = product();
      p.root.updateWorldMatrix(true, false);
      const surface = p.root.localToWorld(p.ref('liquidSurface'));
      return Math.max(0, tip.getWorldPosition(surface.clone()).y - surface.y);
    };
    const jets = (start, end) => {
      cycle.drive(m, 'jetStart', start);
      cycle.drive(m, 'jetEnd', Math.max(start, end));
    };

    cycle.queue(state, `${a.units} in position`, t.inPosition, { fillingHead: 'RAISED', ...a.status });
    cycle.queueMotions({ machine: m, to: { headTravel: 1 }, seconds: t.descend, state, label: 'Filling head descending', status: { fillingHead: 'DESCENDING' } });
    cycle.queue(state, 'Nozzles engaged', t.engage, { fillingHead: 'LOWERED' });
    // The oil front accelerates under gravity from the tips down to the surface.
    cycle.queue(state, 'Valves opening', t.valveOpen, { valves: 'OPEN' }, {
      onUpdate: (progress) => jets(0, drop() * progress * progress),
    });
    let fill = null;
    cycle.queue(state, `Dispensing ${a.liquid}`, t.dispense, { valves: 'OPEN' }, {
      onStart: () => {
        fill = product().routine('fill', {});
        fill.start?.();
      },
      onUpdate: (progress) => {
        fill.update?.(fillCurve(progress));
        jets(0, drop());
      },
      onEnd: () => fill.end?.(),
    });
    // The last of the jet drops away from the closed nozzles.
    cycle.queue(state, 'Valves closing', t.valveClose, { valves: 'CLOSED' }, {
      onUpdate: (progress) => {
        const d = drop();
        jets(d * progress * progress, d);
      },
      onEnd: () => jets(0, 0),
    });
    cycle.plan(m, 'jetStart', 0);
    cycle.plan(m, 'jetEnd', 0);
    cycle.queue(state, 'Drip settle', t.drip);
    cycle.queueMotions({ machine: m, to: { headTravel: 0 }, seconds: t.retract, state, label: 'Filling head retracting', status: { fillingHead: 'RETRACTING' } });
    cycle.queue(state, 'Fill complete', t.after, { fillingHead: 'RAISED' }, {
      onEnd: () => {
        product().setStage('filled');
        if (a.supply) {
          const s = a.supply;
          const level = cycle.machine(s.machine).state[s.motion] - s.draw;
          cycle.drive(s.machine, s.motion, level < s.refillBelow ? s.refillTo : Math.max(0, level));
        }
      },
    });
    if (a.supply) cycle.plan(a.supply.machine, a.supply.motion, UNKNOWN);
  },
});
