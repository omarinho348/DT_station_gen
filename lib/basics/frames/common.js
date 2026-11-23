// Shared pieces of the basic frames (lib/basics/frames): the colour choice, foot plates, and the
// mount points other parts are fixed to. A mount point is an anchor: a named, empty Object3D whose
// origin is where a mounted part's origin goes and whose axes are the part's axes (Y up unless
// said otherwise). Composites (Phase 6 step 4) hang axes and tools on these.
import { z } from 'zod';
import { group, box } from '../../core/primitives.js';

/** Frame colours from the shared materials. */
export const FRAME_COLORS = ['machineGrey', 'gantryOrange', 'machineBlue', 'safetyYellow', 'machineWhite', 'frameDark'];
export const frameColor = (fallback = 'machineGrey') => z.enum(FRAME_COLORS).default(fallback).describe('Frame colour');

/** A square foot plate on the floor under a post centred at (x, z). */
export function footPlate(parent, x, z, size, materials, name) {
  return box(parent, [size, 0.012, size], [x, 0.006, z], materials.stainless, name);
}

/** An empty mount point (anchor) at `position`, optionally turned about Y. */
export function mountPoint(parent, name, position, rotationY = 0) {
  const point = group(parent, name, position);
  point.rotation.y = rotationY;
  return point;
}
