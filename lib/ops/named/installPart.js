import * as THREE from 'three';
import { z } from 'zod';
import { defineOp } from '../../registry.js';
import { common, id, stateOf } from '../args.js';
import { OpError } from '../OpCycle.js';
import { checkGripper, gripperArgs, poseIn, queuePickSequence, vec3 } from '../sequences.js';

// Installs a part of an assembled product with the standard pick-and-place moves. The part comes
// from its kit pose on the product (ST2: building from the kit tray) or, with `from`, from a stock
// item: a free-standing copy of the part at a supermarket location (ST1: kitting). It goes into
// its assembled pose, or with `mode: kit` into its kit pose (a part kitted into the tray). The part
// may be re-oriented on the way, slid in along `insert` at the end, or turned while lowered.
// `onPlaced` switches value motions (a pick light off) or product features (a cable that comes with
// the part, stowed) as the part is let go. Port of the
// reference queueInstallPart and of the kitting picks of KittingCycle.
const switchArg = z.union([
  z.object({ machine: id, motion: id, to: z.union([z.string(), z.number()]) }).strict(),
  z.object({ feature: id.describe('Product feature'), to: z.string() }).strict(),
]);

defineOp({
  op: 'installPart',
  summary: 'Pick a part (from the product\'s kit or a stock copy) and put it into the product in its assembled or kit pose.',
  args: z.object({
    machine: id,
    part: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/).describe('Part name of the product'),
    name: z.string().min(1).max(60).optional().describe('Part name shown on the HMI (default: the part)'),
    from: id.optional().describe('Stock item holding a copy of the part (default: the part in its kit pose on the product)'),
    mode: z.enum(['asm', 'kit']).default('asm').describe('Pose the part goes into on the product'),
    ...gripperArgs,
    clearance: z.number().min(0).max(1).default(0.12).describe('Travel height above both grasp points (m)'),
    clearAbove: z.number().min(0).max(2).default(0).describe('Minimum travel height above the product assembly origin (m)'),
    insert: vec3.optional().describe('Slide the part into place along this product-frame vector at the end (m)'),
    spinTurns: z.number().int().min(0).max(20).default(0).describe('Turns while placed (threading)'),
    onPlaced: z.array(switchArg).max(8).default([]).describe('Machine value motions or product features switched as the part is let go'),
    ...common,
  }),
  expand(cycle, a) {
    cycle.assembly(a.part);
    checkGripper(cycle, a);
    if (a.from) cycle.item(a.from);
    if (!a.from && a.mode === 'kit') cycle.fail('a part already in its kit pose cannot be kitted again; give "from"');
    for (const s of a.onPlaced) {
      if (s.machine) { cycle.checkValue(s.machine, s.motion, s.to); continue; }
      const feature = cycle.productSpec?.features?.[s.feature];
      if (cycle.productSpec && !feature) cycle.fail(`product has no feature "${s.feature}" (features: ${Object.keys(cycle.productSpec.features ?? {}).join(', ') || 'none'})`);
      if (feature && !feature.values.includes(s.to)) cycle.fail(`product feature "${s.feature}" takes ${feature.values.join(' | ')}, got "${s.to}"`);
    }
    const name = a.name ?? a.part;
    const stockCopy = () => {
      const object = cycle.item(a.from);
      const info = object.userData.partCopy;
      if (info?.part !== a.part) throw new OpError(`stock item "${a.from}" holds ${info ? `part "${info.part}"` : 'no part copy'}, not "${a.part}"`);
      return object;
    };
    queuePickSequence(cycle, {
      ...a,
      name,
      state: stateOf(cycle, a),
      hasInsert: Boolean(a.insert),
      geometry: () => {
        const asm = cycle.assembly(a.part);
        const owner = cycle.product.root;
        let from;
        let partFrame = new THREE.Matrix4();
        if (a.from) {
          const object = stockCopy();
          from = poseIn(cycle, a.machine, object, object.userData.grasp.point, object.userData.grasp.yaw);
          partFrame = object.userData.partFrame;
        } else {
          const kit = asm.grip(a.part, 'kit');
          from = poseIn(cycle, a.machine, owner, kit.point, kit.yaw);
        }
        const fitted = asm.grip(a.part, a.mode);
        const to = poseIn(cycle, a.machine, owner, fitted.point, fitted.yaw);
        const origin = cycle.toMachine(a.machine, owner, asm.origin());
        const insert = a.insert ? cycle.directionToMachine(a.machine, owner, new THREE.Vector3(...a.insert)) : new THREE.Vector3();
        return {
          from,
          to,
          entry: { x: to.x + insert.x, y: to.y + insert.y, z: to.z + insert.z, yaw: to.yaw },
          clearY: Math.max(from.y + a.clearance, to.y + a.clearance, origin.y + a.clearAbove),
          placed: cycle.machineFrom(a.machine, owner).multiply(asm.pose(a.part, a.mode)).multiply(partFrame.clone().invert()),
        };
      },
      item: () => (a.from ? stockCopy() : cycle.assembly(a.part).object(a.part)),
      onPick: () => { if (!a.from) cycle.assembly(a.part).setPart(a.part, 'carried'); },
      onPlace: (object) => {
        if (a.from) object.visible = false; // the product's own part takes its place
        cycle.assembly(a.part).setPart(a.part, a.mode);
        for (const s of a.onPlaced) {
          if (s.machine) cycle.drive(s.machine, s.motion, s.to);
          else cycle.product.setFeature(s.feature, s.to);
        }
      },
    });
    for (const s of a.onPlaced) if (s.machine) cycle.plan(s.machine, s.motion, s.to);
  },
});
