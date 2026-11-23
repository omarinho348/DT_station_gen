// Regular slotted carton (RSC), erected with its flaps open, packed and closed at a packaging
// station. Port of the reference station-2/CardboardCase.js plus the ST6 extras (bottom foam,
// dust-cover bag, shipping label). Length along X, width along Z, height along Y; origin at the
// centre of the base. Minor flaps hinge on the end walls, major flaps on the side walls; the tape
// runs along the major-flap seam and over both end walls.
import * as THREE from 'three';
import { z } from 'zod';
import { defineProduct } from '../../registry.js';
import { smoother } from '../../core/motion.js';
import { textLabel } from '../../core/textures.js';

/** Erected-case flap angle (rad from closed), as the reference. */
export const OPEN_ANGLE = THREE.MathUtils.degToRad(110);

/**
 * Largest flap angle (rad, 0 = closed) that keeps a bar at (`out`, `up`) from the hinge (out = away
 * from the case) on the outer side of a flap `depth` long. Reference CasePackingCycle.js.
 */
export function flapAngleUnderBar(out, up, depth, clearance) {
  const reach = Math.hypot(out, up);
  if (reach * reach - clearance * clearance > depth * depth) return Infinity;
  return Math.PI - Math.atan2(up, out) - Math.asin(Math.min(1, clearance / reach));
}

/** Largest flap angle that fits under a flat plate `up` above the hinge. Reference CasePackingCycle.js. */
export function flapAngleUnderPlate(up, depth, thickness) {
  const reach = Math.hypot(depth, thickness);
  if (up >= reach) return Infinity;
  return Math.asin(Math.max(up, thickness) / reach) - Math.atan2(thickness, depth);
}

const COLORS = { cardboard: 0xb8793c, tape: 0xe1c083, foam: 0xe9e6dc, bag: 0xdfe8ee };

defineProduct({
  type: 'carton',
  summary: 'Slotted shipping carton with bottom foam, flaps folded and taped at a case closer, dust-cover bag and shipping label.',
  params: z.object({
    length: z.number().min(0.15).max(1.5).default(0.6).describe('Length along X (m)'),
    width: z.number().min(0.15).max(1.2).default(0.54).describe('Width along Z (m)'),
    height: z.number().min(0.1).max(1.2).default(0.62).describe('Height (m)'),
    wall: z.number().min(0.002).max(0.02).default(0.006).describe('Board thickness (m)'),
    flap: z.number().min(0.002).max(0.02).default(0.005).describe('Flap thickness (m)'),
    foam: z.number().min(0).max(0.1).default(0.035).describe('Bottom foam thickness, 0 = none (m)'),
    title: z.string().max(32).default('').describe('First line of the shipping label'),
    code: z.string().max(24).default('').describe('Big line of the shipping label (e.g. the serial)'),
  }),
  // erected: flaps open, untaped; closed: flaps folded and the seam taped (a packed case as it leaves a closer and taper)
  stages: ['erected', 'closed'],
  // bottom: the surface packed contents stand on (top of the bottom foam); grasp: where a gripper
  // holds the carton (across its width, 6 cm below the top).
  refs: ['bottom', 'grasp', 'top'],
  features: {
    bag: { values: ['off', 'on'] },
    label: { values: ['off', 'on'] },
  },
  routines: {
    foldMinor: { summary: 'Fold the minor (end) flaps closed.', args: z.object({}) },
    foldMajor: { summary: 'Fold the major (side) flaps closed over them.', args: z.object({}) },
    tape: { summary: 'Lay the tape along the seam: its back end moves from `from` to `to` (carton-local X), then the carton is fully taped.', args: z.object({ from: z.number(), to: z.number() }) },
    tapeAlong: { summary: 'Tape laid by a fixed head as the carton passes under it: progress 0 = the leading edge at the head, 1 = the trailing edge past it (fully taped).', args: z.object({}) },
    foldUnder: {
      summary: 'Flaps folded by a closer tool, as far as it lets them (never back open): a bar (out beyond the wall, up above the hinge), a plate height above the side-flap hinge, or an angle.',
      args: z.object({
        flaps: z.enum(['minor', 'major']),
        bar: z.object({ out: z.number(), up: z.number(), radius: z.number().min(0).max(0.1) }).optional(),
        plate: z.number().optional(),
        angle: z.number().min(0).max(Math.PI).optional(),
      }),
    },
  },
  build({ params }) {
    const { length, width, height, wall, flap, foam } = params;
    const wallHeight = height - flap * 2;
    const minorHingeY = wallHeight;
    const majorHingeY = wallHeight + flap;
    const depth = width / 2;
    const tapeWidth = 0.05;
    const clipLength = 0.06;
    const own = [];
    const material = (name, options) => { const m = new THREE.MeshStandardMaterial(options); m.name = name; own.push(m); return m; };
    const mats = {
      cardboard: material('carton board', { color: COLORS.cardboard, roughness: 0.72, metalness: 0.02 }),
      tape: material('carton tape', { color: COLORS.tape, roughness: 0.48, metalness: 0.05 }),
      foam: material('carton foam', { color: COLORS.foam, roughness: 0.95 }),
      bag: material('dust bag', { color: COLORS.bag, roughness: 0.3, transparent: true, opacity: 0.45 }),
    };
    const add = (parent, geometry, mat, name, position = [0, 0, 0], { shadow = true } = {}) => {
      own.push(geometry);
      const mesh = new THREE.Mesh(geometry, mat);
      mesh.name = name;
      mesh.position.set(...position);
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const group = (parent, name, position = [0, 0, 0]) => {
      const g = new THREE.Group();
      g.name = name;
      g.position.set(...position);
      parent?.add(g);
      return g;
    };

    const root = group(null, 'Carton');
    const body = group(root, 'Case body');
    add(body, new THREE.BoxGeometry(length, wall, width), mats.cardboard, 'Case bottom', [0, wall / 2, 0]);
    [-1, 1].forEach((side) => {
      add(body, new THREE.BoxGeometry(length, majorHingeY, wall), mats.cardboard, side > 0 ? 'Side wall front' : 'Side wall rear', [0, majorHingeY / 2, side * (width / 2 - wall / 2)]);
      add(body, new THREE.BoxGeometry(wall, wallHeight, width - wall * 2), mats.cardboard, side > 0 ? 'End wall leading' : 'End wall trailing', [side * (length / 2 - wall / 2), wallHeight / 2, 0]);
    });

    // Flaps pivot on their hinge lines; the geometry reaches inward from the hinge.
    const flaps = group(root, 'Flaps');
    const minor = [-1, 1].map((side) => {
      const pivot = group(flaps, side > 0 ? 'Minor flap leading' : 'Minor flap trailing', [side * length / 2, minorHingeY, 0]);
      const mesh = add(pivot, new THREE.BoxGeometry(depth, flap, width - wall * 2).translate(-depth / 2, flap / 2, 0), mats.cardboard, 'Flap');
      if (side < 0) mesh.scale.x = -1;
      return { pivot, side };
    });
    const major = [-1, 1].map((side) => {
      const pivot = group(flaps, side > 0 ? 'Major flap front' : 'Major flap rear', [0, majorHingeY, side * width / 2]);
      const mesh = add(pivot, new THREE.BoxGeometry(length, flap, depth).translate(0, flap / 2, -depth / 2), mats.cardboard, 'Flap');
      if (side < 0) mesh.scale.z = -1;
      return { pivot, side };
    });

    const tape = group(root, 'Tape');
    const tapeTop = add(tape, new THREE.BoxGeometry(1, 0.0012, tapeWidth).translate(0.5, 0, 0), mats.tape, 'Tape seam', [0, height + 0.0006, 0], { shadow: false });
    add(tape, new THREE.BoxGeometry(0.0012, clipLength, tapeWidth), mats.tape, 'Tape clip leading', [length / 2 + 0.0006, height - clipLength / 2, 0], { shadow: false });
    const trailingClip = add(tape, new THREE.BoxGeometry(0.0012, clipLength, tapeWidth), mats.tape, 'Tape clip trailing', [-length / 2 - 0.0006, height - clipLength / 2, 0], { shadow: false });

    if (foam > 0) add(root, new THREE.BoxGeometry(length - 0.02, foam, width - 0.02), mats.foam, 'Bottom foam', [0, wall + foam / 2, 0]);
    const bagSize = [Math.max(length - 0.03, 0.05), Math.max(height - wall - foam - 0.09, 0.05), Math.max(width - 0.07, 0.05)];
    const bag = add(root, new THREE.BoxGeometry(...bagSize), mats.bag, 'Dust-cover bag', [0, wall + foam + bagSize[1] / 2, 0], { shadow: false });
    bag.visible = false;

    // Shipping label on the front side wall.
    const texture = textLabel({
      width: 512,
      height: 320,
      background: '#ffffff',
      color: '#111',
      border: '#111',
      lines: [
        { text: params.title, size: 40, y: 0.2 },
        { text: params.code, size: 64, y: 0.46 },
        { text: '▌▌▍▌▌▍▍▌▌▍▌▍▌▌▍▌▍▌', size: 46, y: 0.7, bold: false },
        { text: 'THIS SIDE UP  ↑↑', size: 30, y: 0.9 },
      ],
    });
    own.push(texture);
    const labelMaterial = material('shipping label', { map: texture, roughness: 0.6 });
    const label = add(root, new THREE.PlaneGeometry(0.2, 0.125), labelMaterial, 'Shipping label', [-length * 0.2, height * 0.55, width / 2 + 0.002], { shadow: false });
    label.visible = false;

    const angles = { minor: OPEN_ANGLE, major: OPEN_ANGLE }; // flap angle from closed (rad)
    const setAngle = (kind, angle) => {
      angles[kind] = angle;
      if (kind === 'minor') minor.forEach(({ pivot, side }) => { pivot.rotation.z = -side * angle; });
      else major.forEach(({ pivot, side }) => { pivot.rotation.x = side * angle; });
    };
    const setMinor = (closed) => setAngle('minor', OPEN_ANGLE * (1 - closed));
    const setMajor = (closed) => setAngle('major', OPEN_ANGLE * (1 - closed));
    /** Folds only ever go further: a tool pushes flaps in, nothing springs them back open. */
    const foldTo = (kind, angle) => setAngle(kind, Math.max(0, Math.min(angles[kind], angle)));
    /** Tape from the leading edge back to local X `fromX` (−length/2 = fully taped; null = none). */
    const setTape = (fromX) => {
      const active = fromX !== null && fromX < length / 2;
      tape.visible = active;
      if (!active) return;
      const start = Math.max(fromX, -length / 2);
      tapeTop.position.x = start;
      tapeTop.scale.x = length / 2 - start;
      trailingClip.visible = fromX <= -length / 2;
    };
    const reset = () => { setMinor(0); setMajor(0); setTape(null); bag.visible = false; label.visible = false; };
    reset();

    return {
      root,
      setStage: (stage) => {
        reset();
        if (stage === 'closed') { setMinor(1); setMajor(1); setTape(-length); }
      },
      refs: {
        bottom: () => new THREE.Vector3(0, wall + foam, 0),
        grasp: () => new THREE.Vector3(0, height - 0.06, 0),
        // top: the middle of the closed top, on the tape (where a vacuum cup lands)
        top: () => new THREE.Vector3(0, height + 0.0012, 0),
      },
      features: {
        bag: (v) => { bag.visible = v === 'on'; },
        label: (v) => { label.visible = v === 'on'; },
      },
      routines: {
        foldMinor: () => ({ update: (p) => setMinor(smoother(p)) }),
        foldMajor: () => ({ update: (p) => setMajor(smoother(p)) }),
        tape: ({ from, to }) => ({
          update: (p) => setTape(Math.min(from + (to - from) * p, length / 2)),
          end: () => setTape(-length),
        }),
        tapeAlong: () => ({
          update: (p) => setTape(p <= 0 ? null : length / 2 - length * Math.min(p, 1)),
          end: () => setTape(-length),
        }),
        // Reference CasePackingCycle.foldFlaps / foldFlapsUnderPlate: both flap kinds reach half the
        // case width; the end (minor) flaps hinge one flap thickness below the side (major) flaps.
        foldUnder: ({ flaps: kind, bar, plate, angle }) => ({
          update: () => {
            if (angle !== undefined) { setAngle(kind, angle); return; }
            if (bar) { foldTo(kind, flapAngleUnderBar(bar.out, bar.up, depth, flap + bar.radius)); return; }
            if (plate !== undefined && angles[kind] < Math.PI / 2) {
              foldTo(kind, flapAngleUnderPlate(kind === 'minor' ? plate + flap : plate, depth, flap));
            }
          },
        }),
      },
      dispose() {
        root.removeFromParent();
        own.forEach((o) => o.dispose());
      },
    };
  },
});
