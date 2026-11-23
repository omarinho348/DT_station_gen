import * as THREE from 'three';
import { z } from 'zod';
import { defineOp } from '../../registry.js';
import { trapezoidDuration, trapezoidTravel } from '../../core/motion.js';
import { UNKNOWN, wrapValue } from '../OpCycle.js';
import { checkRoutine } from '../routines.js';
import { common, id, stateOf } from '../args.js';
import { vec3 } from '../sequences.js';

// Conveys an item with the line's trapezoid profile between two places: ports of the conveyor
// (by name), or ports of any machine with an offset (a cross transfer pushing a carrier onto a
// place on a reject lane). Every belt / roller / wheel motion of the conveyor that declares its
// surface `travel` scrolls with the item. Distances run along the floor (conveyors move units
// horizontally; a small step up or down on the way does not lengthen the move). The item's origin
// is its underside, so at a port it rests exactly on the surface.
//
// `also`: other conveyors whose surfaces run with it (a case crossing from one belt onto the next).
// `passes`: a fixed machine the item passes on its way (a taping head over the belt): while the
// item's body crosses that machine's port, the item's routine runs with progress = how far it has
// crossed (0 = its leading face at the port, 1 = its trailing face past it), and the machine's
// surface motions (tape feed, wipe rollers) turn with the travel.
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
    also: z.array(id).max(4).default([]).describe('Other conveyors whose surfaces run with it'),
    passes: z.object({
      machine: id,
      port: id.default('work'),
      routine: id.describe('Item routine driven by how far it has crossed the port'),
      args: z.record(z.string(), z.unknown()).default({}),
    }).optional().describe('A fixed machine the item passes (a taping head)'),
    speed: z.number().positive().max(5).optional().describe('m/s (default: line conveyor speed)'),
    ramp: z.number().min(0).max(5).optional().describe('s (default: line conveyor ramp)'),
    ...common,
  }),
  expand(cycle, a) {
    cycle.item(a.item);
    cycle.machine(a.conveyor);
    const ep = (p) => (typeof p === 'string' ? { machine: a.conveyor, port: p, offset: [0, 0, 0] } : p);
    const where = cycle.locationOf(a.item);
    const from = a.from !== undefined ? ep(a.from) : where?.port ? { machine: where.machine, port: where.port, offset: where.offset ?? [0, 0, 0] } : null;
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

    if (a.also.includes(a.conveyor)) cycle.fail(`"also" names the conveyor "${a.conveyor}" itself`);
    const belts = [a.conveyor, ...a.also].flatMap((c) => {
      cycle.machine(c);
      const s = delta.dot(cycle.axisOf(c)) >= 0 ? 1 : -1;
      return Object.entries(cycle.specOf(c).motions ?? {}).filter(([, spec]) => spec.travel).map(([motion, spec]) => ({ c, motion, spec, sign: s }));
    });
    for (const b of belts) {
      const planned = cycle.planned(b.c, b.motion);
      if (typeof planned === 'number') cycle.plan(b.c, b.motion, wrapValue(planned + beltAmount(b.spec, b.sign * distance), b.spec.range));
    }
    const pass = a.passes ? passing(cycle, a) : null;

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
        pass?.start(object, start, end);
      },
      onUpdate: (progress, previous) => {
        const now = trapezoidTravel(progress * duration, distance, speed, ramp);
        const before = trapezoidTravel(previous * duration, distance, speed, ramp);
        object.position.lerpVectors(p0, p1, distance > 0 ? now / distance : 1);
        for (const b of belts) cycle.drive(b.c, b.motion, cycle.machine(b.c).state[b.motion] + beltAmount(b.spec, b.sign * (now - before)));
        pass?.update(distance > 0 ? now / distance : 1, now - before);
      },
      onEnd: () => pass?.end(),
    });
    cycle.locate(a.item, { machine: to.machine, port: to.port, ...(to.offset.some((v) => v !== 0) ? { offset: to.offset } : {}) });
  },
});

/**
 * The `passes` part of a transfer: checks (dry and run) and, when played, the item routine driven
 * by how far the item's body has crossed the machine's port, and the machine's surfaces turning.
 */
function passing(cycle, a) {
  const { machine, port, routine, args } = a.passes;
  cycle.portPosition(machine, port);
  checkRoutine(cycle, a.item, routine, args);
  const surfaces = Object.entries(cycle.specOf(machine).motions ?? {}).filter(([, spec]) => spec.travel);
  for (const [motion] of surfaces) cycle.plan(machine, motion, UNKNOWN);
  let handler = null;
  let geo = null;
  let done = false;
  const crossed = (k) => {
    const centre = geo.from.clone().lerp(geo.to, k).add(geo.centreOffset);
    return THREE.MathUtils.clamp((centre.sub(geo.port).dot(geo.dir) + geo.length / 2) / geo.length, 0, 1);
  };
  return {
    start(object, from, to) {
      // The body's extent along the way and its centre's offset from the item origin (world).
      object.updateWorldMatrix(true, true);
      const box = visibleBox(object); // hidden parts (an unlaid tape strip) do not count
      const origin = new THREE.Vector3().setFromMatrixPosition(object.matrixWorld);
      const dir = to.clone().sub(from).setY(0).normalize();
      const size = box.getSize(new THREE.Vector3());
      geo = {
        from, to, dir,
        port: cycle.portPoint({ machine, port }),
        length: Math.max(Math.abs(size.x * dir.x) + Math.abs(size.z * dir.z), 1e-6),
        centreOffset: box.getCenter(new THREE.Vector3()).sub(origin).setY(0),
      };
      handler = cycle.productItem(a.item).routine(routine, args);
      handler.start?.();
      done = false;
    },
    update(k, travelled) {
      const p = crossed(k);
      if (p > 0 && !done) {
        const status = handler.update?.(p, 0);
        if (status) cycle.setStatus(status);
        for (const [motion, spec] of surfaces) cycle.drive(machine, motion, cycle.machine(machine).state[motion] + beltAmount(spec, Math.abs(travelled)));
      }
      if (p >= 1 && !done) {
        done = true;
        const status = handler.end?.();
        if (status) cycle.setStatus(status);
      }
    },
    end() {
      if (!done && crossed(1) >= 1) this.update(1, 0);
    },
  };
}

/** World box of the meshes of `object` that are shown (every ancestor up to it visible). */
function visibleBox(object) {
  const box = new THREE.Box3();
  const walk = (o) => {
    if (!o.visible) return;
    if (o.isMesh) box.union(new THREE.Box3().setFromObject(o, false));
    for (const c of o.children) walk(c);
  };
  walk(object);
  return box.isEmpty() ? new THREE.Box3().setFromObject(object) : box;
}

/** Range units a belt motion advances for `metres` of surface travel. */
export function beltAmount(spec, metres) {
  return (metres / spec.travel) * (spec.range[1] - spec.range[0]);
}

