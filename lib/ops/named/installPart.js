import * as THREE from 'three';
import { z } from 'zod';
import { defineOp } from '../../registry.js';
import { common, id, stateOf } from '../args.js';
import { checkGripper, gripperArgs, poseIn, queuePickSequence, vec3 } from '../sequences.js';

// Installs a part of an assembled product: picked from its kit pose, placed in its assembled
// pose (both from the product's assembly interface). The part may be re-oriented on the way (picked
// lying, installed upright), slid in along `insert` at the end, or turned while lowered.
// Port of the reference queueInstallPart.
defineOp({
  op: 'installPart',
  summary: 'Pick a part of the product from its kit pose and install it in its assembled pose (pick-and-place).',
  args: z.object({
    machine: id,
    part: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/).describe('Part name of the product'),
    name: z.string().min(1).max(40).optional().describe('Part name shown on the HMI (default: the part)'),
    ...gripperArgs,
    clearance: z.number().min(0).max(1).default(0.12).describe('Travel height above both grasp points (m)'),
    clearAbove: z.number().min(0).max(2).default(0).describe('Minimum travel height above the product assembly origin (m)'),
    insert: vec3.optional().describe('Slide the part into place along this product-frame vector at the end (m)'),
    spinTurns: z.number().int().min(0).max(20).default(0).describe('Turns while placed (threading)'),
    ...common,
  }),
  expand(cycle, a) {
    cycle.assembly(a.part);
    checkGripper(cycle, a);
    const name = a.name ?? a.part;
    queuePickSequence(cycle, {
      ...a,
      name,
      state: stateOf(cycle, a),
      hasInsert: Boolean(a.insert),
      geometry: () => {
        const asm = cycle.assembly(a.part);
        const owner = cycle.product.root;
        const kit = asm.grip(a.part, 'kit');
        const fitted = asm.grip(a.part, 'asm');
        const from = poseIn(cycle, a.machine, owner, kit.point, kit.yaw);
        const to = poseIn(cycle, a.machine, owner, fitted.point, fitted.yaw);
        const origin = cycle.toMachine(a.machine, owner, asm.origin());
        const insert = a.insert ? cycle.directionToMachine(a.machine, owner, new THREE.Vector3(...a.insert)) : new THREE.Vector3();
        return {
          from,
          to,
          entry: { x: to.x + insert.x, y: to.y + insert.y, z: to.z + insert.z, yaw: to.yaw },
          clearY: Math.max(from.y + a.clearance, to.y + a.clearance, origin.y + a.clearAbove),
          placed: cycle.machineFrom(a.machine, owner).multiply(asm.pose(a.part, 'asm')),
        };
      },
      item: () => cycle.assembly(a.part).object(a.part),
      onPick: () => cycle.assembly(a.part).setPart(a.part, 'carried'),
      onPlace: () => cycle.assembly(a.part).setPart(a.part, 'asm'),
    });
  },
});
