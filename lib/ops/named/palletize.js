import * as THREE from 'three';
import { z } from 'zod';
import { defineOp } from '../../registry.js';
import { common, id, stateOf } from '../args.js';
import { checkGripper, gripperArgs, poseIn, queuePickSequence, vec3 } from '../sequences.js';

// Picks an item and sets it on the next free spot of one of the station's stacks (cases on a
// pallet: columns × rows per layer, layer on layer). The spot is taken when the pick starts, from
// what the stack holds then; the item stays on the stack across units until it is dispatched.
// The tool holds the item at its `grasp` ref, so the item's origin lands exactly on the spot.
const place = z.union([
  z.object({ machine: id, port: id, offset: vec3.default([0, 0, 0]), yaw: z.number().default(0) }).strict(),
  z.object({ item: id, ref: id, offset: vec3.default([0, 0, 0]), yaw: z.number().default(0) }).strict(),
]);

defineOp({
  op: 'palletize',
  needs: { motions: ['x', 'y', 'z', 'yaw'] },
  summary: 'Pick an item and set it on the next free spot of a station stack (cases on a pallet), with the standard pick-and-place moves.',
  args: z.object({
    machine: id,
    item: id,
    from: place.describe('Where it is picked (its grasp point)'),
    stack: id,
    grasp: id.default('grasp').describe('Ref of the item where the gripper holds it'),
    name: z.string().min(1).max(40).optional(),
    ...gripperArgs,
    clearance: z.number().min(0).max(1).default(0.12),
    clearY: z.number().optional().describe('Absolute travel height in the machine frame (instead of clearance)'),
    ...common,
  }),
  expand(cycle, a) {
    cycle.item(a.item);
    checkGripper(cycle, a);
    cycle.stackSpec(a.stack);
    const spec = cycle.itemSpec(a.item);
    if (spec && !(spec.refs ?? []).includes(a.grasp)) cycle.fail(`item "${a.item}" has no ref "${a.grasp}" to hold it by`);
    if (a.from.machine) cycle.portPosition(a.from.machine, a.from.port);
    else cycle.item(a.from.item);
    const resolveFrom = () => {
      const p = a.from;
      if (p.machine) return poseIn(cycle, a.machine, cycle.machine(p.machine).root, cycle.portPosition(p.machine, p.port).add(new THREE.Vector3(...p.offset)), p.yaw);
      return poseIn(cycle, a.machine, cycle.item(p.item), cycle.productItem(p.item).ref(p.ref).add(new THREE.Vector3(...p.offset)), p.yaw);
    };
    queuePickSequence(cycle, {
      ...a,
      name: a.name ?? a.item,
      state: stateOf(cycle, a),
      geometry: () => {
        const from = resolveFrom();
        const object = cycle.item(a.item);
        object.updateWorldMatrix(true, false);
        const origin = new THREE.Vector3().setFromMatrixPosition(object.matrixWorld);
        const graspWorld = object.localToWorld(cycle.productItem(a.item).ref(a.grasp)).sub(origin);
        const spot = cycle.stacks.slotPoint(a.stack); // world, where the item's origin goes
        const root = cycle.machine(a.machine).root;
        root.updateWorldMatrix(true, false);
        const p = root.worldToLocal(spot.add(graspWorld));
        const to = { x: p.x, y: p.y, z: p.z, yaw: from.yaw };
        return { from, to, entry: to, clearY: a.clearY ?? Math.max(from.y, to.y) + a.clearance };
      },
      item: () => cycle.item(a.item),
      onReleased: (object) => cycle.stacks.place(a.stack, object),
    });
    cycle.locate(a.item, { stack: a.stack });
  },
});

// The stack is shipped: at the end of a timed step everything on it is cleared (a full pallet
// wrapped and taken away).
defineOp({
  op: 'dispatch',
  summary: 'Ship a station stack: at the end of a timed step everything on it is cleared (a full pallet wrapped and taken away).',
  args: z.object({
    stack: id,
    seconds: z.number().min(0).max(120).default(1),
    ...common,
  }),
  expand(cycle, a) {
    cycle.stackSpec(a.stack);
    cycle.queue(stateOf(cycle, a), a.label ?? `Dispatching ${a.stack}`, a.seconds, a.status, {
      onEnd: () => cycle.stacks.clear(a.stack),
    });
  },
});
