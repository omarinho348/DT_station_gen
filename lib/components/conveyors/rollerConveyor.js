// Roller conveyor section: two side frames, rollers at a fixed pitch, legs, an optional end stop
// and an optional floor marking (e.g. a reject bay). Ported from the reference ST5
// InspectionEquipment.js (createRejectLane's RejectConveyor). Centred on the origin, flow along
// +X (placing the lane is a transform); the roller tops are at the line's belt height.
import * as THREE from 'three';
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, addMesh, box, cylinder, roundedBox } from '../../core/primitives.js';

const FRAME = { width: 0.05, height: 0.1 };
const ROLLER_RADIUS = 0.022;
const BAY_MARGIN = 0.15; // the floor marking reaches this far beyond the frames (1.3 m bay for a 1.0 m lane)

const rollerXs = (p) => {
  const xs = [];
  for (let x = -p.length / 2 + p.rollerPitch / 2; x < p.length / 2 - 1e-9; x += p.rollerPitch) xs.push(x);
  return xs;
};

defineComponent({
  type: 'rollerConveyor',
  category: 'conveyor',
  summary: 'Roller conveyor section with side frames, legs, optional end stop and floor marking (e.g. a reject lane).',
  params: z.object({
    length: z.number().min(0.6).max(6).default(1.82).describe('Length along X (m)'),
    width: z.number().min(0.3).max(1.4).default(1.0).describe('Frame spacing (m)'),
    rollerPitch: z.number().min(0.06).max(0.2).default(0.1).describe('Roller pitch (m)'),
    color: z.enum(['rejectRed', 'machineGrey', 'machineBlue', 'safetyYellow']).default('rejectRed').describe('Frame colour'),
    endStop: z.boolean().default(true).describe('End stop at the far end'),
    bayMarking: z.boolean().default(true).describe('Floor marking under the lane'),
  }),
  footprint: (p, ctx) => {
    const halfZ = p.bayMarking ? p.width / 2 + BAY_MARGIN : p.width / 2 + FRAME.width / 2;
    return { x: [-p.length / 2, p.length / 2], z: [-halfZ, halfZ], height: ctx.beltHeight + (p.endStop ? 0.08 : 0) }; // roller tops at belt height
  },
  mount: 'floor',
  ports: (p, ctx) => ({
    input: { position: [-p.length / 2, ctx.beltHeight, 0], direction: 'in', carries: 'unit' },
    output: { position: [p.length / 2, ctx.beltHeight, 0], direction: 'out', carries: 'unit' },
  }),
  motions: { rollers: { range: [0, 1] } }, // roller turn phase (0…1 = one full turn)
  build({ params, materials, beltHeight }) {
    const { length, width, color, endStop, bayMarking } = params;
    const frameMaterial = materials[color];
    const root = group(null, 'rollerConveyor');
    const half = width / 2;
    [-1, 1].forEach((side) => roundedBox(root, [length, FRAME.height, FRAME.width], [0, beltHeight - 0.06, side * half], frameMaterial, 'Lane side frame', 0.006));
    const rollers = rollerXs(params).map((x) => cylinder(root, ROLLER_RADIUS, width - 0.02, [x, beltHeight - ROLLER_RADIUS, 0], materials.stainless, 'Roller', { axis: 'z', segments: 14 }));
    const legsX = length > 0.8 ? [-length / 2 + 0.1, 0, length / 2 - 0.1] : [-length / 2 + 0.1, length / 2 - 0.1];
    legsX.forEach((x) => [-1, 1].forEach((side) => {
      box(root, [0.05, beltHeight - 0.1, 0.05], [x, (beltHeight - 0.1) / 2, side * half], materials.frame, 'Lane leg');
    }));
    if (endStop) {
      // A bar across the frames at the far end. (The reference used a small post standing between
      // the frames, resting on nothing but a roller.)
      box(root, [0.04, 0.06, width + FRAME.width], [length / 2 - 0.03, beltHeight - 0.01 + 0.03, 0], frameMaterial, 'End stop');
    }
    if (bayMarking) {
      const paint = new THREE.MeshStandardMaterial({ color: 0xb8302a, roughness: 0.8, transparent: true, opacity: 0.35, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
      paint.name = 'bay marking';
      const bay = addMesh(root, new THREE.PlaneGeometry(length - 0.2, width + 2 * BAY_MARGIN).rotateX(-Math.PI / 2), paint, 'Bay marking', [0, 0.002, 0], { castShadow: false });
      bay.receiveShadow = true;
    }
    return {
      root,
      motions: { rollers: (v) => rollers.forEach((r) => { r.rotation.z = -v * 2 * Math.PI; }) },
    };
  },
});
