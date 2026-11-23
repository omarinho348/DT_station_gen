// A worker walking behind a high-lift pallet truck: moves stacked pallets between places in a
// station (palletizer → stretch wrapper → dispatch). Port of the reference station-3
// ProceduralWorker.js. It moves, so its travel is motions in its own placement frame: `x` / `z`
// (where the truck is), `heading` (which way the forks point; 0 = +X), `forks` (fork height),
// `stride` (the legs' walking phase). The anchor `cargo` is the pallet centre on the forks, where
// ops attach the load. The truck's origin is under the fork roots; the worker stands behind it.
import * as THREE from 'three';
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, box, cylinder } from '../../core/primitives.js';

const FORK_LOWERED = 0.045;
const FORK_RAISED = 0.6; // the reference lifts 0.55 m to clear a 0.44 m wrapper deck
const MAST = { x: -0.555, top: FORK_RAISED + 0.26 }; // lift mast on the truck body
const CARRIAGE_X = -0.51; // fork carriage, its front face at −0.49
const TILLER_X = -0.66;
const BEHIND = 1.44; // the figure's boots reach this far behind the fork roots (a heel at full back swing: 1.40 m)

const skinTone = 0xc68642;
const BOOT_DROP = 0.76; // hip height above the boot soles
const BOOT_TOE_HEEL = [-0.07, 0.15]; // boot heel / toe along the figure's facing (z)

defineComponent({
  type: 'palletJackWorker',
  category: 'robot',
  summary: 'Worker with a high-lift pallet truck: drives under a pallet, lifts it, carries it to another place and sets it down.',
  params: z.object({
    forkLength: z.number().min(0.8).max(1.6).default(1.15).describe('Fork length (m)'),
    forkSpread: z.number().min(0.25).max(0.7).default(0.36).describe('Distance between the fork centres (m)'),
    travel: z.number().min(1).max(15).default(6).describe('How far it may travel from its placement along X and Z (m)'),
  }),
  footprint: (p) => {
    // Travel plus the turning radius: the farthest corner (fork tips or boots, half the width out).
    const reach = p.travel + Math.hypot(Math.max(p.forkLength - 0.15, BEHIND), Math.max(p.forkSpread / 2 + 0.05, 0.23)) + 0.02;
    return { x: [-reach, reach], z: [-reach, reach], height: 1.75 };
  },
  mount: 'floor',
  anchors: ['cargo'],
  motions: (p) => ({
    x: { range: [-p.travel, p.travel], default: 0 },
    z: { range: [-p.travel, p.travel], default: 0 },
    heading: { range: [-Math.PI, Math.PI], default: 0, wrap: true },
    forks: { range: [FORK_LOWERED, FORK_RAISED], default: FORK_LOWERED },
    stride: { range: [0, 1], default: 0, wrap: true }, // one full walking cycle (two steps)
  }),
  ops: [],
  build({ params: p, materials }) {
    const root = group(null, 'palletJackWorker');
    const mover = group(root, 'Worker and truck');
    const skin = new THREE.MeshStandardMaterial({ color: skinTone, roughness: 0.72, metalness: 0.05 });
    skin.name = 'skin';
    const suit = new THREE.MeshStandardMaterial({ color: 0x2f6f9f, metalness: 0.15, roughness: 0.62 });
    suit.name = 'work suit';

    // Truck, all behind the back end of a pallet centred on the cargo point (x ≥ −0.48 for the
    // reference 2.06 m pallet): body on the steer wheel, tiller, pump lever, lift mast with the fork
    // carriage. (The reference's forks rose on nothing, and its body stood 1 cm into the pallet.)
    const truck = group(mover, 'Pallet truck');
    box(truck, [0.16, 0.12, 0.42], [-0.62, 0.18, 0], materials.frameDark, 'Truck body');
    cylinder(truck, 0.07, 0.05, [-0.62, 0.07, 0], materials.rubber, 'Steer wheel', { axis: 'x', segments: 16 });
    box(truck, [0.06, 0.85, 0.06], [TILLER_X, 0.55, 0], materials.aluminium, 'Tiller mast');
    box(truck, [0.06, 0.06, 0.36], [TILLER_X, 0.98, 0], materials.aluminium, 'Tiller handle');
    box(truck, [0.05, 0.05, 0.12], [-0.62, 0.265, 0.13], materials.gantryOrange, 'Pump lever');
    [-1, 1].forEach((s) => box(truck, [0.05, MAST.top - 0.12, 0.05], [MAST.x, 0.12 + (MAST.top - 0.12) / 2, s * 0.2], materials.frameDark, 'Lift mast'));
    box(truck, [0.05, 0.05, 0.45], [MAST.x, MAST.top - 0.025, 0], materials.frameDark, 'Mast head');

    // Forks on their carriage: they run back to the carriage between a block pallet's blocks and
    // under its stringers (top 0.105 m lowered).
    const forks = group(truck, 'Forks', [0, FORK_LOWERED, 0]);
    const forkY = 0.035;
    const forkBack = CARRIAGE_X + 0.02;
    const forkEnd = p.forkLength - 0.15;
    [-1, 1].forEach((s) => {
      box(forks, [forkEnd - forkBack, 0.05, 0.1], [(forkEnd + forkBack) / 2, forkY, s * p.forkSpread / 2], materials.aluminium, s < 0 ? 'Left fork' : 'Right fork');
      cylinder(forks, 0.035, 0.04, [p.forkLength - 0.28, forkY, s * p.forkSpread / 2], materials.rubber, s < 0 ? 'Left fork wheel' : 'Right fork wheel', { axis: 'z', segments: 12 });
    });
    box(forks, [0.04, 0.26, Math.max(0.45, p.forkSpread + 0.12)], [CARRIAGE_X, forkY + 0.105, 0], materials.frameDark, 'Fork carriage');
    const cargo = group(forks, 'Cargo', [0.55, forkY + 0.025, 0]); // pallet centre over the forks (reference)

    // Worker figure behind the tiller, facing the way the truck goes (+X).
    const figure = group(mover, 'Worker figure', [TILLER_X - 0.36, 0, 0]); // hands on the tiller handle
    figure.rotation.y = Math.PI / 2;
    // Torso from the hips to the shoulders, vest band, neck, head, hard hat. (The reference's torso
    // stood 3 cm above the hips and the head 6 cm above the shoulders.)
    box(figure, [0.28, 0.57, 0.2], [0, 0.74 + 0.285, 0], suit, 'Torso');
    box(figure, [0.3, 0.08, 0.22], [0, 1.34, 0], materials.gantryOrange, 'Safety vest band');
    cylinder(figure, 0.05, 0.12, [0, 1.42, 0], skin, 'Neck', { segments: 12 });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), skin);
    head.name = 'Head';
    head.position.set(0, 1.55, 0);
    figure.add(head);
    const hat = new THREE.Mesh(new THREE.SphereGeometry(0.125, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), materials.safetyYellow);
    hat.name = 'Hard hat';
    hat.position.set(0, 1.6, 0);
    figure.add(hat);
    // Legs from the hips to the boots on the floor (the reference legs ended 22 cm above the boots).
    const hips = [[-0.1, 'Left'], [0.1, 'Right']].map(([x, side]) => {
      const hip = group(figure, `${side} hip`, [x, 0.76, 0]);
      box(hip, [0.1, 0.7, 0.1], [0, -0.35, 0], suit, `${side} leg`);
      box(hip, [0.12, 0.08, 0.22], [0, -0.72, 0.04], materials.rubber, `${side} boot`);
      return hip;
    });
    // Arms from the shoulders to the tiller handle.
    [[-0.18, -0.15, 'Left'], [0.18, 0.15, 'Right']].forEach(([sx, hx, side]) => {
      const shoulder = new THREE.Vector3(sx, 1.27, 0);
      const hand = new THREE.Vector3(hx, 0.98, 0.36);
      const reach = hand.clone().sub(shoulder);
      const arm = group(figure, `${side} arm`, shoulder.toArray());
      arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), reach.clone().normalize());
      box(arm, [0.08, reach.length(), 0.08], [0, -reach.length() / 2, 0], suit, `${side} sleeve`);
      box(arm, [0.07, 0.07, 0.07], [0, -reach.length(), 0], skin, `${side} hand`);
    });

    return {
      root,
      anchors: { cargo },
      motions: {
        x(v) { mover.position.x = v; },
        z(v) { mover.position.z = v; },
        heading(v) { mover.rotation.y = v; },
        forks(v) { forks.position.y = v; },
        stride(v) {
          const swing = Math.sin(v * 2 * Math.PI) * 0.45;
          hips[0].rotation.x = swing;
          hips[1].rotation.x = -swing;
          // A stiff swinging leg reaches lower than a standing one (its toe passes under the hip),
          // so the figure rises by as much as its lowest boot corner would sink into the floor.
          let lowest = -BOOT_DROP;
          for (const angle of [swing, -swing]) for (const zc of BOOT_TOE_HEEL) lowest = Math.min(lowest, -BOOT_DROP * Math.cos(angle) - zc * Math.sin(angle));
          figure.position.y = -BOOT_DROP - lowest;
        },
      },
    };
  },
});
