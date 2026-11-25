import * as THREE from 'three';
import { z } from 'zod';
import { defineOp } from '../../registry.js';
import { smoother } from '../../core/motion.js';
import { common, id, stateOf } from '../args.js';
import { once } from '../sequences.js';

// Drives one screw of the product with a robot's automatic screw-driving tool: screw fed while the tool
// travels over the hole (rising first, never dipping), driver down, bit runs down while it
// turns, torque reached, bit back. The wrist turns so the gripper stays on the outboard side.
// The seat comes from the product's assembly interface; the bit geometry from the robot's
// anchors (`tool` and `bit`). Port of the reference queueDriveScrew.
const TIMING = { travel: 0.35, lower: 0.18, drive: 0.4, retract: 0.15 };

defineOp({
  op: 'driveScrew',
  needs: { product: ['parts'] },
  summary: 'Drive one screw of the product with a screw-driving robot tool: feed, travel, lower, drive while turning, retract.',
  args: z.object({
    machine: id,
    screw: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*:\d+$/, 'a screw id "Part:index"').describe('Screw id of the product'),
    name: z.string().min(1).max(40).optional().describe('Text shown on the HMI (default: the screw id)'),
    centerX: z.number().default(0).describe('Machine-frame X: screws at or beyond it are driven with the wrist turned round'),
    turns: z.number().min(0).max(40).default(8).describe('Bit turns while driving'),
    timing: z.object(Object.fromEntries(Object.entries(TIMING).map(([k, v]) => [k, z.number().min(0).max(10).default(v)]))).default(TIMING),
    slide: id.default('driver').describe('Bit slide motion (0 retracted, 1 extended)'),
    spin: id.default('driverSpin').describe('Bit turn motion (periodic, with an angle)'),
    feed: id.default('screw').describe('Fed-screw motion (hidden / fed)'),
    tool: id.default('tool'),
    bit: id.default('bit').describe('Anchor at the extended bit tip'),
    ...common,
  }),
  expand(cycle, a) {
    const part = a.screw.split(':')[0];
    cycle.assembly(part);
    for (const motion of ['x', 'y', 'z', 'yaw']) cycle.motionSpec(a.machine, motion);
    cycle.checkAnchor(a.machine, a.tool);
    cycle.checkAnchor(a.machine, a.bit);
    cycle.checkValue(a.machine, a.slide, 0);
    cycle.checkValue(a.machine, a.slide, 1);
    cycle.checkValue(a.machine, a.feed, 'fed');
    cycle.checkValue(a.machine, a.feed, 'hidden');
    const spinSpec = cycle.motionSpec(a.machine, a.spin);
    if (!spinSpec.wrap || !spinSpec.angle) cycle.fail(`machine "${a.machine}".${a.spin} must be periodic with an angle to turn the bit`);
    const spinBy = ((a.turns * 2 * Math.PI) / spinSpec.angle) * (spinSpec.range[1] - spinSpec.range[0]);

    const state = stateOf(cycle, a);
    const label = a.name ?? a.screw;
    const t = a.timing;
    const now = () => cycle.machine(a.machine).state;
    const g = once(() => {
      const asm = cycle.assembly(part);
      if (!asm.screws(part).includes(a.screw)) throw new Error(`the product has no screw "${a.screw}"`);
      const seat = cycle.toMachine(a.machine, cycle.product.root, asm.screwSeat(a.screw));
      // The extended bit tip in the tool frame (fixed relative to the tool).
      const tip = new THREE.Vector3().setFromMatrixPosition(
        cycle.anchorInMachine(a.machine, a.tool).invert().multiply(cycle.anchorInMachine(a.machine, a.bit)),
      );
      const yaw = seat.x >= a.centerX ? Math.PI : 0;
      const offset = tip.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      return { x: seat.x - offset.x, z: seat.z - offset.z, yaw, seatY: seat.y - tip.y };
    });

    cycle.queueMotions({
      machine: a.machine, state, seconds: t.travel, label: `Screw fed · ${label}`, status: { ...a.status, driver: 'FEEDING' },
      // Travel no lower than where the tool already is: it never dips through the frame.
      to: { x: () => g().x, z: () => g().z, yaw: () => g().yaw, y: () => Math.max(now().y, g().seatY + 0.06) },
      ease: { y: (p) => smoother(Math.min(p * 3, 1)) },
      onStart: () => {
        cycle.drive(a.machine, a.feed, 'fed');
        cycle.drive(a.machine, a.slide, 0);
      },
    });
    cycle.plan(a.machine, a.feed, 'fed');
    cycle.plan(a.machine, a.slide, 0);
    cycle.queueMotions({
      machine: a.machine, state, seconds: t.lower + 0.12, label: `Screwdriver down · ${label}`, status: { ...a.status, driver: 'POSITIONING' },
      to: { x: () => g().x, z: () => g().z, yaw: () => g().yaw, y: () => g().seatY },
    });
    cycle.queueMotions({
      machine: a.machine, state, seconds: t.drive, label: `Driving screw · ${label}`, status: { ...a.status, driver: 'RUNNING' },
      to: { [a.slide]: 1 },
      by: { [a.spin]: spinBy },
      ease: { [a.spin]: (p) => p },
      onEnd: () => {
        cycle.drive(a.machine, a.feed, 'hidden');
        cycle.assembly(part).setScrew(a.screw, true);
      },
    });
    cycle.plan(a.machine, a.feed, 'hidden');
    cycle.queueMotions({
      machine: a.machine, state, seconds: t.retract, label: `Torque OK · ${label}`, status: { ...a.status, driver: 'TORQUE OK' },
      to: { [a.slide]: 0 },
    });
  },
});
