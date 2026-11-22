import { z } from 'zod';
import { defineOp } from '../../registry.js';
import { trapezoidDuration, trapezoidTravel } from '../../core/motion.js';
import { wrapValue } from '../OpCycle.js';
import { common, id, stateOf } from '../args.js';
import { vec3 } from '../sequences.js';

// Conveys an item with the line's trapezoid profile between two places: ports of the conveyor
// (by name), or ports of any machine with an offset (a cross transfer pushing a carrier onto a
// place on a reject lane). Every belt / roller / wheel motion of the conveyor that declares its
// surface `travel` scrolls with the item. Distances run along the floor (conveyors move units
// horizontally; a small step up or down on the way does not lengthen the move). The item's origin
// is its underside, so at a port it rests exactly on the surface.
const place = z.union([
  id.describe('A port of the conveyor'),
  z.object({ machine: id, port: id, offset: vec3.default([0, 0, 0]) }).strict(),
]);

defineOp({
  op: 'transfer',
  summary: 'Convey an item between two places (conveyor ports, or ports of other machines) with the trapezoid profile; the belts scroll with it.',
  args: z.object({
    conveyor: id,
    to: place.describe('Destination'),
    from: place.optional().describe('Start (default: the port the item is at)'),
    item: id.default('product'),
    speed: z.number().positive().max(5).optional().describe('m/s (default: line conveyor speed)'),
    ramp: z.number().min(0).max(5).optional().describe('s (default: line conveyor ramp)'),
    ...common,
  }),
  expand(cycle, a) {
    cycle.item(a.item);
    cycle.machine(a.conveyor);
    const ep = (p) => (typeof p === 'string' ? { machine: a.conveyor, port: p, offset: [0, 0, 0] } : p);
    const where = cycle.locationOf(a.item);
    const from = a.from !== undefined ? ep(a.from) : where?.port ? { machine: where.machine, port: where.port, offset: [0, 0, 0] } : null;
    if (!from) cycle.fail(`where is "${a.item}"? It is not at a port; give "from"`);
    const to = ep(a.to);
    const start = cycle.portPoint(from);
    const end = cycle.portPoint(to);
    const delta = end.clone().sub(start);
    const distance = Math.hypot(delta.x, delta.z);
    const sign = delta.dot(cycle.axisOf(a.conveyor)) >= 0 ? 1 : -1; // surfaces run along the conveyor's +X
    const speed = a.speed ?? cycle.conventions.conveyor.speed;
    const ramp = a.ramp ?? cycle.conventions.conveyor.ramp;
    const duration = trapezoidDuration(distance, speed, ramp);

    const belts = Object.entries(cycle.specOf(a.conveyor).motions ?? {}).filter(([, spec]) => spec.travel);
    for (const [motion, spec] of belts) {
      const planned = cycle.planned(a.conveyor, motion);
      if (typeof planned === 'number') cycle.plan(a.conveyor, motion, wrapValue(planned + beltAmount(spec, sign * distance), spec.range));
    }

    let object = null;
    let p0 = null;
    let p1 = null;
    const label = a.label ?? `Transport to ${typeof a.to === 'string' ? a.to : a.to.port}`;
    cycle.queue(stateOf(cycle, a), label, duration, { conveyor: 'RUNNING', ...a.status }, {
      onStart: () => {
        object = cycle.item(a.item);
        cycle.detach(object); // riding the surface, not held by anything
        object.parent?.updateWorldMatrix(true, false);
        const toParent = (world) => (object.parent ? object.parent.worldToLocal(world) : world);
        p0 = toParent(cycle.portPoint(from));
        p1 = toParent(cycle.portPoint(to));
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
    cycle.locate(a.item, { machine: to.machine, port: to.port });
  },
});

/** Range units a belt motion advances for `metres` of surface travel. */
function beltAmount(spec, metres) {
  return (metres / spec.travel) * (spec.range[1] - spec.range[0]);
}

