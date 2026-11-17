// Parallel two-finger gripper: body, finger rail, two fingers with rubber pads, grip-state LED.
// Ported from the reference Robots.js (createFingerGripper). The origin is the TOOL POINT: the
// centre between the fingertips. Fingers clamp across local Z.
// Robots mount it with buildFingerGripper(); the registered component shows it on its own.
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, box, cylinder, roundedBox } from '../../core/primitives.js';
import { createLampMaterial, setLamp } from '../../core/materials.js';

const FINGER_THICKNESS = 0.012;

/** Builds the gripper under `parent`. Returns { root, setGap(m), setHolding(bool), height }. */
export function buildFingerGripper(parent, materials, { fingerLength = 0.12, maxGap = 0.2, name = 'Gripper' } = {}) {
  const root = group(parent, name);
  roundedBox(root, [0.09, 0.05, Math.max(0.12, maxGap * 0.6)], [0, fingerLength + 0.025, 0], materials.machineGrey, 'Gripper body', 0.006);
  box(root, [0.05, 0.012, maxGap + 0.05], [0, fingerLength + 0.004, 0], materials.aluminium, 'Finger rail');
  const fingers = [-1, 1].map((side) => {
    const finger = group(root, `Finger ${side > 0 ? 'front' : 'rear'}`);
    roundedBox(finger, [0.04, fingerLength, FINGER_THICKNESS], [0, fingerLength / 2, 0], materials.frameDark, 'Finger', 0.003);
    box(finger, [0.04, 0.03, 0.004], [0, 0.015, -side * 0.008], materials.rubber, 'Finger pad');
    return { finger, side };
  });
  const led = createLampMaterial(0x39d353);
  led.name = 'grip led';
  cylinder(root, 0.008, 0.006, [0.046, fingerLength + 0.03, 0], led, 'Grip LED', { axis: 'x', segments: 12 });
  const api = {
    root,
    /** Gripper height above the tool point (where it meets the flange). */
    height: fingerLength + 0.05,
    setGap(gap) {
      fingers.forEach(({ finger, side }) => { finger.position.z = side * (gap / 2 + FINGER_THICKNESS / 2); });
    },
    setHolding(holding) { setLamp(led, holding, 1.8); },
  };
  api.setGap(maxGap);
  api.setHolding(false);
  return api;
}

defineComponent({
  type: 'fingerGripper',
  category: 'tool',
  summary: 'Parallel two-finger gripper with rubber pads and a grip LED; origin at the fingertip centre.',
  params: z.object({
    fingerLength: z.number().min(0.06).max(0.2).default(0.12).describe('Finger length (m)'),
    maxGap: z.number().min(0.06).max(0.7).default(0.2).describe('Maximum opening (m)'),
  }),
  footprint: (p) => {
    const half = Math.max(Math.max(0.12, p.maxGap * 0.6), p.maxGap + 0.05) / 2; // body or finger rail
    return { x: [-0.05, 0.05], z: [-half, half], height: p.fingerLength + 0.05 };
  },
  mount: 'tool',
  motions: (p) => ({
    grip: { range: [0, p.maxGap], default: p.maxGap }, // finger gap (m)
    holding: { values: ['off', 'on'] }, // grip LED
  }),
  build({ params, materials }) {
    const root = group(null, 'fingerGripper');
    const g = buildFingerGripper(root, materials, params);
    return {
      root,
      motions: {
        grip: (gap) => g.setGap(gap),
        holding: (v) => g.setHolding(v === 'on'),
      },
    };
  },
});
