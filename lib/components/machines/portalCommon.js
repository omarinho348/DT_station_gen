// Shared pieces of the portal machines that straddle a product conveyor (filler, capper): the
// stainless portal with polycarbonate guards, the control cabinet on top and the stack light on
// its roof. Ported from the reference station-1 FillingMachine.js (buildPortalFrame) and the
// cabinets / stack lights of FillingMachine.js and CappingMachine.js. Not a component by itself.
import * as THREE from 'three';
import { group, addMesh, box, cylinder, roundedBox } from '../../core/primitives.js';
import { createLampMaterial, setLamp } from '../../core/materials.js';

/** Base plates reach this far beyond the posts; guards hang this far outside them. */
export const PORTAL_OVERHANG = { plate: 0.09, guard: 0.049, cabinetX: 0.08, cabinetZ: 0.06, door: 0.071 };
export const BEACON_HEIGHT = 0.41; // stack light on the cabinet roof, base to cap

/** Four posts with base plates and anchor bolts, side rails and guards (ends only above the product path). */
export function buildPortalFrame(parent, materials, { halfX, halfZ, top, guardBottom }) {
  const frame = group(parent, 'Frame');
  [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(([sx, sz], i) => {
    roundedBox(frame, [0.08, top - 0.02, 0.08], [sx * halfX, 0.02 + (top - 0.02) / 2, sz * halfZ], materials.stainless, `Post ${i + 1}`, 0.012);
    roundedBox(frame, [0.18, 0.02, 0.18], [sx * halfX, 0.01, sz * halfZ], materials.brushed, `Base plate ${i + 1}`, 0.004);
    [[-0.06, -0.06], [0.06, 0.06], [-0.06, 0.06], [0.06, -0.06]].forEach(([bx, bz]) => {
      cylinder(frame, 0.008, 0.016, [sx * halfX + bx, 0.026, sz * halfZ + bz], materials.chrome, 'Anchor bolt', { segments: 6 });
    });
  });
  [-1, 1].forEach((sz) => {
    roundedBox(frame, [halfX * 2, 0.06, 0.06], [0, 0.32, sz * halfZ], materials.stainless, 'Lower side rail', 0.01);
    roundedBox(frame, [halfX * 2, 0.05, 0.05], [0, guardBottom - 0.03, sz * halfZ], materials.stainless, 'Guard rail', 0.01);
  });

  const guards = group(parent, 'Safety guards');
  const guardHeight = top - guardBottom;
  [-1, 1].forEach((sz) => {
    addMesh(guards, new THREE.BoxGeometry(halfX * 2 - 0.08, guardHeight, 0.008), materials.guard, sz > 0 ? 'Front guard' : 'Rear guard', [0, guardBottom + guardHeight / 2, sz * (halfZ + 0.045)], { castShadow: false });
  });
  const endBottom = guardBottom + 0.38;
  [-1, 1].forEach((sx) => {
    addMesh(guards, new THREE.BoxGeometry(0.008, top - endBottom, halfZ * 2 - 0.08), materials.guard, 'End guard', [sx * (halfX + 0.045), endBottom + (top - endBottom) / 2, 0], { castShadow: false });
  });
  return frame;
}

/** Control cabinet on the portal: housing, access doors, name plate. Returns the group. */
export function buildCabinet(parent, materials, { halfX, halfZ, bottom, height, doors }) {
  const cabinet = group(parent, 'Control cabinet');
  const y = bottom + height / 2;
  roundedBox(cabinet, [halfX * 2 + 0.16, height, halfZ * 2 + 0.12], [0, y, 0], materials.brushed, 'Cabinet housing', 0.03);
  doors.forEach(({ x, width }) => box(cabinet, [width, height - 0.08, 0.006], [x, y, halfZ + 0.062], materials.stainless, 'Access door'));
  if (doors.length > 1) box(cabinet, [0.004, height - 0.08, 0.01], [0, y, halfZ + 0.064], materials.frameDark, 'Door split');
  roundedBox(cabinet, [0.3, 0.07, 0.008], [-Math.min(0.5, halfX - 0.3), y, halfZ + 0.067], materials.frameDark, 'Name plate', 0.004);
  return cabinet;
}

/**
 * Stack light standing on the cabinet roof at `position`. Returns set(mode) for a `beacon`
 * motion with values off | run | wait | alarm (green / amber / red), which stations use as their
 * signal tower.
 */
export function buildRoofBeacon(parent, materials, position) {
  const light = group(parent, 'Stack light', position);
  cylinder(light, 0.04, 0.02, [0, 0.01, 0], materials.frameDark, 'Stack light base', { segments: 20 });
  cylinder(light, 0.012, 0.12, [0, 0.08, 0], materials.stainless, 'Stack light pole', { segments: 12 });
  const lamps = { green: createLampMaterial(0x2ecc59), amber: createLampMaterial(0xf2a516), red: createLampMaterial(0xe23a2e) };
  ['green', 'amber', 'red'].forEach((color, i) => {
    cylinder(light, 0.035, 0.07, [0, 0.175 + i * 0.075, 0], lamps[color], `Lamp ${color}`, { segments: 24 });
  });
  // The reference lamps stood on the pole top with 5 mm gaps between tiers; a core joins them.
  cylinder(light, 0.02, 0.25, [0, 0.265, 0], materials.plasticBlack, 'Stack light core', { segments: 12 });
  cylinder(light, 0.037, 0.02, [0, 0.4, 0], materials.frameDark, 'Stack light cap', { segments: 24 });
  return (mode) => {
    setLamp(lamps.green, mode === 'run');
    setLamp(lamps.amber, mode === 'wait');
    setLamp(lamps.red, mode === 'alarm');
  };
}

export const BEACON_MOTION = { values: ['off', 'run', 'wait', 'alarm'], default: 'off' };

/** Head positions of `count` heads at `pitch`, centred on 0. */
export const headXs = (count, pitch) => Array.from({ length: count }, (_, i) => Math.round((i - (count - 1) / 2) * pitch * 1e9) / 1e9); // rounded: no 0.6000000000000001 in ports and compiled files
