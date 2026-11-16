// Automatic screwdriver (as on screwdriving gantries): servo spindle, screw-feed tube, and a bit
// on a pneumatic slide; a fed screw sits on the bit tip until it is driven.
// Ported from the reference Robots.js (addToolScrewdriver). Frame: origin on the bit axis at the
// tool-point height of the gripper it is mounted beside; the bracket reaches back (−X) to it.
import * as THREE from 'three';
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, box, cylinder } from '../../core/primitives.js';

const RETRACTED = 0.02;
const STROKE = 0.05;
const HEX_SIDES = 6;

/**
 * Builds the screwdriver under `tool`, its bit `offsetX` along +X from the tool point.
 * Returns { root, offset, tipY(extend), set(extend, spinAngle), showScrew(bool) }.
 */
export function buildScrewdriver(tool, materials, { fingerLength = 0.12, offsetX = 0.13 } = {}) {
  const root = group(tool, 'Screwdriver', [offsetX, 0, 0]);
  const bodyY = fingerLength + 0.02;
  box(root, [offsetX - 0.03, 0.02, 0.03], [-(offsetX - 0.03) / 2 - 0.02, bodyY + 0.01, 0], materials.aluminium, 'Screwdriver bracket');
  cylinder(root, 0.022, 0.12, [0, bodyY + 0.06, 0], materials.machineBlue, 'Spindle motor', { segments: 18 });
  cylinder(root, 0.016, 0.05, [0, bodyY - 0.025, 0], materials.machineGrey, 'Slide cylinder', { segments: 16 });
  // Feed tube against the motor (the reference left it 4 mm clear, unattached).
  cylinder(root, 0.004, 0.22, [0.026, bodyY + 0.09, 0], materials.guide, 'Screw feed tube', { segments: 8 });
  const bit = group(root, 'Bit');
  cylinder(bit, 0.009, 0.03, [0, 0.055, 0], materials.chrome, 'Bit holder', { segments: 14 });
  cylinder(bit, 0.0025, 0.04, [0, 0.02, 0], materials.stainless, 'Hex bit', { segments: HEX_SIDES });
  // Shaft from the bit holder up into the slide cylinder, long enough to stay inside it at full
  // stroke. The reference had none: the extended bit came off the slide (and with longer
  // fingers the bit never reached the slide at all).
  const shaftTop = bodyY - 0.05 - (RETRACTED - STROKE) + 0.005; // slide bottom, in bit space at full extension
  if (shaftTop > 0.07) cylinder(bit, 0.005, shaftTop - 0.07, [0, (0.07 + shaftTop) / 2, 0], materials.chrome, 'Bit shaft', { segments: 10 });
  const screw = group(bit, 'Fed screw');
  cylinder(screw, 0.0035, 0.003, [0, -0.0015, 0], materials.chrome, 'Screw head', { segments: 12 });
  cylinder(screw, 0.0015, 0.012, [0, -0.009, 0], materials.stainless, 'Screw shank', { segments: 8 });
  screw.visible = false;
  return {
    root,
    offset: new THREE.Vector3(offsetX, 0, 0),
    /** Bit tip height in tool space (0 = retracted, 1 = extended). */
    tipY: (extend) => RETRACTED - STROKE * extend,
    set(extend, spin = 0) {
      bit.position.y = RETRACTED - STROKE * extend;
      bit.rotation.y = spin;
    },
    showScrew(visible) { screw.visible = visible; },
  };
}

/** Motions shared by every robot that carries the screwdriver. */
export const SCREWDRIVER_MOTIONS = Object.freeze({
  driver: { range: [0, 1] }, // bit slide: 0 retracted, 1 extended
  driverSpin: { range: [0, 1] }, // bit turn within one sixth of a turn (hex bit looks the same each 60°)
  screw: { values: ['hidden', 'fed'] }, // a fed screw on the bit tip
});

/** Wires SCREWDRIVER_MOTIONS to a built screwdriver. */
export function screwdriverMotions(driver) {
  let extend = 0;
  let spin = 0;
  return {
    driver: (v) => { extend = v; driver.set(extend, spin); },
    driverSpin: (v) => { spin = (v * 2 * Math.PI) / HEX_SIDES; driver.set(extend, spin); },
    screw: (v) => driver.showScrew(v === 'fed'),
  };
}

defineComponent({
  type: 'screwdriver',
  category: 'tool',
  summary: 'Automatic screwdriver with servo spindle, screw feed and a bit on a pneumatic slide; mounts beside a gripper.',
  params: z.object({
    fingerLength: z.number().min(0.06).max(0.2).default(0.12).describe('Finger length of the gripper beside it (m)'),
    offsetX: z.number().min(0.08).max(0.2).default(0.13).describe('Bit offset from the tool point (m)'),
  }),
  footprint: (p) => ({
    x: [-(p.offsetX - 0.03) - 0.02, 0.035],
    z: [-0.025, 0.025],
    height: p.fingerLength + 0.22,
    bottom: -0.05, // extended bit with a fed screw
  }),
  mount: 'tool',
  motions: SCREWDRIVER_MOTIONS,
  build({ params, materials }) {
    const root = group(null, 'screwdriver');
    const driver = buildScrewdriver(root, materials, params);
    driver.root.position.x = 0; // standalone: origin on the bit axis
    return { root, motions: screwdriverMotions(driver) };
  },
});
