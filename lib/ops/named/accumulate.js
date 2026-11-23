import * as THREE from 'three';
import { z } from 'zod';
import { defineOp } from '../../registry.js';
import { rampedDuration, rampedTravel, smoother, smoothMin, stoppingTravel } from '../../core/motion.js';
import { wrapValue } from '../OpCycle.js';
import { common, id, stateOf } from '../args.js';
import { vec3 } from '../sequences.js';
import { beltAmount } from '../basic/transfer.js';

// Accumulating conveyors: the belts start and run, every item rides along until it comes to rest
// at its own stop place (cans queued against an end stop, a case against a swing stop), easing in
// over the last `blend` metres; then the belts stop. Several items on several conveyors move in the
// same step, as the reference case packer's infeed ("Jerry cans & empty case arriving", then
// "Conveyors stopping"). The run lasts until the item with the longest way is in place.
//
// Items start where the plan has them (a port, a batch member's place in its batch), so the dry
// plan and the twin agree on the time. `alongside` moves other machines during the first seconds of
// the run (a stop swinging back across the belt while the case is still far upstream).
//
// `stopping: false` leaves the belts' stop to a following stopConveyors op, so a station can hand the
// unit over as soon as everything rests (a row former's batch arriving at the next station's
// infeed). `unitTo`: the unit (a batch whose members were moved) counts as standing there from then on.
const place = z.object({ machine: id, port: id, offset: vec3.default([0, 0, 0]) }).strict();

defineOp({
  op: 'accumulate',
  summary: 'Run accumulating conveyors: each item rides until it rests at its own stop place (eased in), then the belts stop. Several items and conveyors in one step.',
  args: z.object({
    items: z.array(z.object({
      item: id,
      conveyor: id.describe('Conveyor it rides on (its belts run)'),
      to: place.describe('Where it comes to rest'),
    })).min(1).max(12),
    speed: z.number().positive().max(5).optional().describe('Belt speed, m/s (default: line conveyor speed)'),
    ramp: z.number().min(0.01).max(5).optional().describe('Start and stop ramp, s (default: line conveyor ramp)'),
    blend: z.number().min(0.001).max(0.5).default(0.06).describe('Distance over which an item eases into its stop (m)'),
    alongside: z.array(z.object({
      machine: id,
      to: z.record(id, z.number()),
      seconds: z.number().positive().max(30).describe('Done this long after the belts start'),
    })).max(4).default([]),
    stopping: z.union([z.literal(false), z.object({
      label: z.string().min(1).max(80).default('Conveyors stopping'),
      state: z.string().regex(/^[A-Z][A-Z0-9_]*$/).optional(),
      status: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
    })]).default({ label: 'Conveyors stopping' }).describe('The step in which the belts stop under the items (false: a stopConveyors op follows)'),
    unitTo: place.optional().describe('Where the unit counts as standing once its items rest (a batch moved member by member)'),
    ...common,
  }),
  expand(cycle, a) {
    const speed = a.speed ?? cycle.conventions.conveyor.speed;
    const ramp = a.ramp ?? cycle.conventions.conveyor.ramp;
    const plans = a.items.map((it) => {
      cycle.item(it.item);
      cycle.machine(it.conveyor);
      const start = cycle.plannedPoint(it.item);
      if (!start) cycle.fail(`where is "${it.item}"? It must stand at a port (or in a batch at one) to ride a conveyor`);
      const end = cycle.portPoint(it.to);
      return { ...it, travel: Math.hypot(end.x - start.x, end.z - start.z) };
    });
    const travel = Math.max(...plans.map((p) => p.travel)) + a.blend;
    const duration = rampedDuration(travel, speed, ramp);
    const stopRun = a.stopping ? stoppingTravel(1, speed, ramp) : 0;

    // Every belt of every conveyor runs the whole way (under items already at rest too).
    const belts = [...new Set(a.items.map((it) => it.conveyor))].flatMap((c) => Object.entries(cycle.specOf(c).motions ?? {})
      .filter(([, spec]) => spec.travel).map(([motion, spec]) => ({ c, motion, spec })));
    for (const b of belts) {
      const planned = cycle.planned(b.c, b.motion);
      if (typeof planned === 'number') cycle.plan(b.c, b.motion, wrapValue(planned + beltAmount(b.spec, travel + stopRun), b.spec.range));
    }
    for (const m of a.alongside) {
      for (const [motion, value] of Object.entries(m.to)) {
        cycle.checkValue(m.machine, motion, value);
        cycle.plan(m.machine, motion, value);
      }
    }
    const scroll = (metres) => {
      for (const b of belts) cycle.drive(b.c, b.motion, cycle.machine(b.c).state[b.motion] + beltAmount(b.spec, metres));
    };

    let live = [];
    let side = [];
    cycle.queue(stateOf(cycle, a), a.label ?? 'Conveyors running', duration, { conveyor: 'RUNNING', ...a.status }, {
      onStart: () => {
        live = plans.map((p) => {
          const object = cycle.item(p.item);
          cycle.detach(object); // riding the belt, not held by anything
          object.parent?.updateWorldMatrix(true, false);
          const p0 = object.position.clone();
          const world = cycle.portPoint(p.to);
          const p1 = object.parent ? object.parent.worldToLocal(world) : world;
          return { object, p0, p1, travel: Math.hypot(p1.x - p0.x, p1.z - p0.z) };
        });
        side = a.alongside.flatMap((m) => Object.entries(m.to).map(([motion, to]) => ({ machine: m.machine, motion, to, from: cycle.machine(m.machine).state[motion], seconds: m.seconds })));
      },
      onUpdate: (progress, previous) => {
        const s = rampedTravel(progress * duration, speed, ramp);
        scroll(s - rampedTravel(previous * duration, speed, ramp));
        for (const l of live) {
          const k = l.travel > 0 ? smoothMin(s, l.travel, a.blend) / l.travel : 1;
          l.object.position.lerpVectors(l.p0, l.p1, THREE.MathUtils.clamp(k, 0, 1));
        }
        for (const m of side) cycle.drive(m.machine, m.motion, m.from + (m.to - m.from) * smoother((progress * duration) / m.seconds));
      },
      onEnd: () => live.forEach((l) => l.object.position.copy(l.p1)),
    });
    for (const p of plans) cycle.locate(p.item, { machine: p.to.machine, port: p.to.port, offset: p.to.offset });
    if (a.unitTo) {
      cycle.portPosition(a.unitTo.machine, a.unitTo.port);
      cycle.locate('product', { machine: a.unitTo.machine, port: a.unitTo.port, offset: a.unitTo.offset });
    }
    if (!a.stopping) return;
    // The belts decelerate under the items, which are already held by their stops.
    cycle.queue(a.stopping.state ?? stateOf(cycle, a), a.stopping.label, ramp, { conveyor: 'STOPPING', ...a.stopping.status }, {
      onUpdate: (progress, previous) => scroll(stoppingTravel(progress, speed, ramp) - stoppingTravel(previous, speed, ramp)),
    });
  },
});
