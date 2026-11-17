import { z } from 'zod';
import { defineOp } from '../../registry.js';
import { trapezoidDuration, trapezoidTravel } from '../../core/motion.js';
import { wrapValue } from '../OpCycle.js';
import { common, id, stateOf } from '../args.js';

// Conveys an item between two ports of a conveyor with the line's trapezoid profile. Every belt
// or roller motion of the conveyor that declares its surface `travel` scrolls with the item.
// The item's origin is its underside, so at a port it rests exactly on the belt.
defineOp({
  op: 'transfer',
  summary: 'Convey an item between two ports of a conveyor (trapezoid profile); the belts scroll with it.',
  args: z.object({
    conveyor: id,
    to: id.describe('Destination port'),
    from: id.optional().describe('Start port (default: where the item is)'),
    item: id.default('product'),
    speed: z.number().positive().max(5).optional().describe('m/s (default: line conveyor speed)'),
    ramp: z.number().min(0).max(5).optional().describe('s (default: line conveyor ramp)'),
    ...common,
  }),
  expand(cycle, a) {
    cycle.item(a.item);
    const where = cycle.locationOf(a.item);
    const fromPort = a.from ?? (where?.machine === a.conveyor && where.port ? where.port : null);
    if (!fromPort) cycle.fail(`where is "${a.item}"? It is not at a port of "${a.conveyor}"; give "from"`);
    const start = cycle.portPosition(a.conveyor, fromPort);
    const end = cycle.portPosition(a.conveyor, a.to);
    const distance = start.distanceTo(end);
    const sign = end.x >= start.x ? 1 : -1; // belts run along the conveyor's +X
    const speed = a.speed ?? cycle.conventions.conveyor.speed;
    const ramp = a.ramp ?? cycle.conventions.conveyor.ramp;
    const duration = trapezoidDuration(distance, speed, ramp);

    const belts = Object.entries(cycle.specOf(a.conveyor).motions ?? {}).filter(([, spec]) => spec.travel);
    for (const [motion, spec] of belts) {
      const from = cycle.planned(a.conveyor, motion);
      if (typeof from === 'number') cycle.plan(a.conveyor, motion, wrapValue(from + beltAmount(spec, sign * distance), spec.range));
    }

    let object = null;
    let p0 = null;
    let p1 = null;
    cycle.queue(stateOf(cycle, a), a.label ?? `Transport to ${a.to}`, duration, { conveyor: 'RUNNING', ...a.status }, {
      onStart: () => {
        object = cycle.item(a.item);
        cycle.detach(object); // riding the belt, not held by anything
        const conveyor = cycle.machine(a.conveyor).root;
        conveyor.updateWorldMatrix(true, false);
        object.parent?.updateWorldMatrix(true, false);
        const toParent = (v) => {
          const world = conveyor.localToWorld(v.clone());
          return object.parent ? object.parent.worldToLocal(world) : world;
        };
        p0 = toParent(start);
        p1 = toParent(end);
      },
      onUpdate: (progress, previous) => {
        const now = trapezoidTravel(progress * duration, distance, speed, ramp);
        const before = trapezoidTravel(previous * duration, distance, speed, ramp);
        object.position.lerpVectors(p0, p1, distance > 0 ? now / distance : 1);
        for (const [motion, spec] of belts) {
          cycle.drive(a.conveyor, motion, cycle.machine(a.conveyor).state[motion] + beltAmount(spec, sign * (now - before)));
        }
      },
    });
    cycle.locate(a.item, { machine: a.conveyor, port: a.to });
  },
});

/** Range units a belt motion advances for `metres` of surface travel. */
function beltAmount(spec, metres) {
  return (metres / spec.travel) * (spec.range[1] - spec.range[0]);
}
