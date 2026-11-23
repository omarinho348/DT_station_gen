// Shared roller bed of the basic transport and buffer blocks: two side frames and rollers at a
// pitch, roller tops on the bed's surface (y = 0 in the frame it is built in), flow along +X.
// The rollers turn with one phase motion (0 … 1 = one turn), so a transfer op can scroll it with
// the unit it carries (motion spec ROLLER_MOTION: `travel` metres per turn).
import { box, cylinder, roundedBox } from '../../core/primitives.js';

export const ROLLER_RADIUS = 0.022;
export const FRAME = { width: 0.05, height: 0.1 };
export const ROLLER_MOTION = { range: [0, 1], wrap: true, travel: 2 * Math.PI * ROLLER_RADIUS, angle: 2 * Math.PI };

/** Roller x positions over a bed of `length`, centred. */
export function rollerXs(length, pitch) {
  const n = Math.max(1, Math.floor(length / pitch + 1e-9));
  const start = -((n - 1) * pitch) / 2;
  return Array.from({ length: n }, (_, i) => start + i * pitch);
}

/**
 * Builds the bed under `parent`: side frames from y −0.11 to −0.01 at z = ±width/2, rollers just
 * under y = 0. Returns { rollers, setPhase(v) }.
 */
export function buildRollerBed(parent, materials, { length, width, pitch = 0.1, frameMaterial, name = 'Bed' }) {
  for (const side of [-1, 1]) {
    roundedBox(parent, [length, FRAME.height, FRAME.width], [0, -0.06, side * width / 2], frameMaterial, `${name} side frame ${side > 0 ? 'front' : 'rear'}`, 0.006);
  }
  const rollers = rollerXs(length - 0.04, pitch).map((x) => cylinder(parent, ROLLER_RADIUS, width - FRAME.width, [x, -ROLLER_RADIUS, 0], materials.stainless, `${name} roller`, { axis: 'z', segments: 14 }));
  return {
    rollers,
    setPhase: (v) => rollers.forEach((r) => { r.rotation.z = -v * 2 * Math.PI; }),
  };
}

/** A cross bar between the side frames at x, under the rollers (something to stand a stop or a bracket on). */
export function crossBar(parent, materials, { x, width, name }) {
  return box(parent, [0.04, 0.03, width], [x, -0.095, 0], materials.frameDark, name);
}
