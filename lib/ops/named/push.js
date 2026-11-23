import * as THREE from 'three';
import { z } from 'zod';
import { defineOp } from '../../registry.js';
import { OpError } from '../OpCycle.js';
import { smoother } from '../../core/motion.js';
import { common, id, seconds, stateOf } from '../args.js';

// A side pusher shifts items across a conveyor (a row former pushing a pair of cans from the single
// file into a lane), then retracts. Port of the reference LubricantFactory.queuePush.
//
// The machine's roles: a range motion that moves its pushing face along the machine's Z (`motion`,
// pushed out to `to`, back to where it was) and an anchor on that face (`anchor`). Items ride
// the face once it reaches them: each keeps its near side on the face, so items nearer the face
// move first and nothing passes through the plate. Fixed times, so the plan's duration is exact.
// `rest`: where the pushed items' centres end up, as a machine Z (like the face): the plan then knows
// where they stand (members of a batch moved into a lane); playing sets them exactly there at the
// end (they must be within 1 cm of it: labels stand proud of a body).
defineOp({
  op: 'push',
  summary: 'Side pusher: push items across a conveyor with its face (they ride the face once it reaches them), then retract.',
  args: z.object({
    machine: id,
    items: z.array(id).min(1).max(8),
    motion: id.default('face').describe('Range motion moving the pushing face along the machine Z'),
    anchor: id.default('face').describe('Anchor on the pushing face'),
    to: z.number().describe('Motion value pushed out'),
    rest: z.number().optional().describe('Machine Z where the pushed items\' centres end up (planned; checked when played, 1 mm)'),
    seconds: seconds(10).default(0.7),
    retract: z.object({
      seconds: seconds(10).default(0.45),
      label: z.string().min(1).max(80).default('Pusher retracting'),
    }).default({ seconds: 0.45, label: 'Pusher retracting' }),
    ...common,
  }),
  expand(cycle, a) {
    const spec = cycle.motionSpec(a.machine, a.motion);
    if (!spec.range) cycle.fail(`machine "${a.machine}".${a.motion} must be a range motion`);
    cycle.checkValue(a.machine, a.motion, a.to);
    cycle.checkAnchor(a.machine, a.anchor);
    for (const item of a.items) cycle.item(item);
    const back = cycle.planned(a.machine, a.motion);
    if (typeof back !== 'number') cycle.fail(`machine "${a.machine}".${a.motion}: where it starts must be known (it is retracted there)`);
    if (back === a.to) cycle.fail(`machine "${a.machine}".${a.motion} is already at ${a.to}; nothing to push`);

    // Planned places after the push: each item's point with its machine Z set to `rest`.
    const planned = {};
    if (a.rest !== undefined) {
      const unit = cycle.plannedPoint('product');
      for (const item of a.items) {
        const p = cycle.plannedPoint(item);
        if (!p) cycle.fail(`where is "${item}"? Its place must be known to plan where it rests`);
        const local = cycle.pointInMachine(a.machine, p);
        local.z = a.rest;
        planned[item] = cycle.machinePoint(a.machine, local);
        if (unit && item !== 'product' && (cycle.productSpec?.payloads ?? []).includes(item)) {
          cycle.locate(item, { inUnit: [planned[item].x - unit.x, planned[item].z - unit.z] });
        }
      }
    }
    let riders = [];
    let dir = null;
    const faceAlong = () => {
      const f = cycle.machine(a.machine).anchor(a.anchor);
      f.updateWorldMatrix(true, false);
      return new THREE.Vector3().setFromMatrixPosition(f.matrixWorld).dot(dir);
    };
    cycle.queueMotions({
      machine: a.machine,
      to: { [a.motion]: a.to },
      seconds: a.seconds,
      state: stateOf(cycle, a),
      label: a.label ?? `Pushing ${a.items.join(', ')}`,
      status: a.status,
      onStart: () => {
        // Push direction: along the machine's Z, the way the face goes.
        const root = cycle.machine(a.machine).root;
        root.updateWorldMatrix(true, false);
        dir = new THREE.Vector3(0, 0, 1).transformDirection(root.matrixWorld).setY(0).normalize().multiplyScalar(Math.sign(a.to - back));
        riders = a.items.map((name) => {
          const object = cycle.item(name);
          cycle.detach(object);
          object.updateWorldMatrix(true, true);
          const box = new THREE.Box3().setFromObject(object);
          const origin = new THREE.Vector3().setFromMatrixPosition(object.matrixWorld);
          // How far its near side (the one the face meets) is behind its origin, along the push.
          const corners = [[box.min.x, box.min.z], [box.min.x, box.max.z], [box.max.x, box.min.z], [box.max.x, box.max.z]];
          const near = origin.dot(dir) - Math.min(...corners.map(([x, cz]) => x * dir.x + cz * dir.z));
          return { object, near, start: origin.dot(dir) };
        });
      },
      onUpdate: () => {
        const f = faceAlong();
        for (const r of riders) {
          const object = r.object;
          object.updateWorldMatrix(true, false);
          const at = new THREE.Vector3().setFromMatrixPosition(object.matrixWorld);
          const s = at.dot(dir);
          const wanted = Math.max(r.start, f + r.near);
          if (Math.abs(wanted - s) < 1e-12) continue;
          const world = at.addScaledVector(dir, wanted - s);
          object.position.copy(object.parent ? object.parent.worldToLocal(world) : world);
          object.updateMatrixWorld(true);
        }
      },
      onEnd: () => {
        if (a.rest === undefined) return;
        for (const [i, r] of riders.entries()) {
          r.object.updateWorldMatrix(true, false);
          const at = cycle.pointInMachine(a.machine, new THREE.Vector3().setFromMatrixPosition(r.object.matrixWorld));
          // Within a centimetre (labels standing proud of the body), it is set exactly onto its
          // rest line, as the reference sets the cans onto the lane; further off is a fault.
          if (Math.abs(at.z - a.rest) > 0.01) throw new OpError(`push: "${a.items[i]}" ended at ${at.z.toFixed(4)}, not at rest ${a.rest} (machine Z)`);
          at.z = a.rest;
          const world = cycle.machinePoint(a.machine, at);
          r.object.position.copy(r.object.parent ? r.object.parent.worldToLocal(world) : world);
          r.object.updateMatrixWorld(true);
        }
      },
    });
    cycle.queueMotions({
      machine: a.machine,
      to: { [a.motion]: back },
      seconds: a.retract.seconds,
      state: stateOf(cycle, a),
      label: a.retract.label,
      ease: { [a.motion]: smoother },
    });
  },
});
