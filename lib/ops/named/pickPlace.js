import * as THREE from 'three';
import { z } from 'zod';
import { defineOp } from '../../registry.js';
import { common, id, stateOf } from '../args.js';
import { checkGripper, gripperArgs, poseIn, queuePickSequence, vec3 } from '../sequences.js';

// Moves an item from one place to another with the standard pick-and-place sequence. A place is a
// port of a machine (a bin's inside, a fixture's seat) or a ref of the product, plus an offset
// to the grasp point and the tool heading there. Port of the reference queuePickPlace.
const place = z.union([
  z.object({ machine: id, port: id, offset: vec3.default([0, 0, 0]), yaw: z.number().default(0) }).strict(),
  z.object({ item: id, ref: id, offset: vec3.default([0, 0, 0]), yaw: z.number().default(0) }).strict(),
]);

defineOp({
  op: 'pickPlace',
  summary: 'Pick an item at one place (machine port or product ref) and put it at another, with the standard pick-and-place moves.',
  args: z.object({
    machine: id,
    item: id,
    from: place,
    to: place,
    name: z.string().min(1).max(40).optional(),
    ...gripperArgs,
    clearance: z.number().min(0).max(1).default(0.12).describe('Travel height above both grasp points (m)'),
    clearY: z.number().optional().describe('Absolute travel height in the machine frame (instead of clearance)'),
    onto: id.optional().describe('Item it is put onto, and then moves with'),
    ...common,
  }),
  expand(cycle, a) {
    cycle.item(a.item);
    checkGripper(cycle, a);
    for (const [key, p] of [['from', a.from], ['to', a.to]]) {
      if (p.machine) cycle.portPosition(p.machine, p.port);
      else checkRef(cycle, key, p);
    }
    if (a.onto) {
      if (a.onto === a.item) cycle.fail('an item cannot be put onto itself');
      cycle.item(a.onto);
    }
    const resolve = (p) => {
      if (p.machine) {
        const local = cycle.portPosition(p.machine, p.port).add(new THREE.Vector3(...p.offset));
        return poseIn(cycle, a.machine, cycle.machine(p.machine).root, local, p.yaw);
      }
      const local = cycle.productItem(p.item).ref(p.ref).add(new THREE.Vector3(...p.offset));
      return poseIn(cycle, a.machine, cycle.item(p.item), local, p.yaw);
    };
    queuePickSequence(cycle, {
      ...a,
      name: a.name ?? a.item,
      state: stateOf(cycle, a),
      geometry: () => {
        const from = resolve(a.from);
        const to = resolve(a.to);
        return { from, to, entry: to, clearY: a.clearY ?? Math.max(from.y, to.y) + a.clearance };
      },
      item: () => cycle.item(a.item),
      onReleased: (object) => { if (a.onto) cycle.item(a.onto).attach(object); },
    });
    cycle.locate(a.item, a.onto ? { on: a.onto } : a.to.machine ? { machine: a.to.machine, port: a.to.port } : { on: a.to.item });
  },
});

function checkRef(cycle, key, p) {
  cycle.item(p.item);
  const spec = cycle.itemSpec(p.item);
  if (!spec) cycle.fail(`${key}: item "${p.item}" has no refs (only products do)`);
  const refs = spec.refs ?? [];
  if (!refs.includes(p.ref)) cycle.fail(`${key}: ${p.item === 'product' ? 'the product' : `item "${p.item}"`} has no ref "${p.ref}" (refs: ${refs.join(', ') || 'none'})`);
}
