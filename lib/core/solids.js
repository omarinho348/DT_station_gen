// Solid parts of built components, and how far two of them go into each other (Phase 7 step 2;
// shared since Phase 8 step 3b). The reviewer's geometry check (agents/reviewer/geometry.js) and the
// station placer (lib/station/place.js) both test what is really there, not footprints: a footprint
// is an envelope (a portal's span over its belt), the meshes are the parts. Each visible mesh is an
// oriented box (its geometry's bounds in its own frame); products a component carries are left out.
import * as THREE from 'three';

/** Parts that go into each other less than this only touch (m). */
export const TOLERANCE = 0.02;


/**
 * The solid parts of a component: every visible mesh as an oriented box in the line frame
 * { name, centre, axes: [Vector3 ×3], half: [x, y, z], box: Box3 }. Products and items carried
 * by the component (userData.product) are not its parts.
 */
export function solidsOf(root) {
  const parts = [];
  const visit = (o) => {
    if (!o.visible || (o !== root && o.userData?.product)) return;
    if (o.isMesh && o.geometry) {
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const local = o.geometry.boundingBox;
      if (!local.isEmpty()) {
        const matrices = o.isInstancedMesh
          ? Array.from({ length: o.count }, (_, i) => { const m = new THREE.Matrix4(); o.getMatrixAt(i, m); return o.matrixWorld.clone().multiply(m); })
          : [o.matrixWorld];
        for (const m of matrices) parts.push(orientedBox(o.name || '(unnamed mesh)', local, m));
      }
    }
    o.children.forEach(visit);
  };
  visit(root);
  return parts;
}

function orientedBox(name, local, matrix) {
  const centre = local.getCenter(new THREE.Vector3()).applyMatrix4(matrix);
  const size = local.getSize(new THREE.Vector3());
  const ex = new THREE.Vector3();
  const ey = new THREE.Vector3();
  const ez = new THREE.Vector3();
  matrix.extractBasis(ex, ey, ez);
  const half = [size.x / 2 * ex.length(), size.y / 2 * ey.length(), size.z / 2 * ez.length()];
  const axes = [ex, ey, ez].map((v) => (v.lengthSq() > 0 ? v.normalize() : v));
  return { name, centre, axes, half, box: local.clone().applyMatrix4(matrix) };
}

const reach = (b, n) => Math.abs(b.axes[0].dot(n)) * b.half[0] + Math.abs(b.axes[1].dot(n)) * b.half[1] + Math.abs(b.axes[2].dot(n)) * b.half[2];

/**
 * How far two oriented boxes must move apart to clear each other (m): the smallest overlap over
 * the separating axes (both boxes' axes and their cross products); 0 when apart or only touching.
 */
export function penetration(a, b) {
  const d = b.centre.clone().sub(a.centre);
  const candidates = [...a.axes, ...b.axes];
  for (const u of a.axes) for (const v of b.axes) {
    const c = u.clone().cross(v);
    if (c.lengthSq() > 1e-10) candidates.push(c.normalize());
  }
  let min = Infinity;
  for (const n of candidates) {
    if (n.lengthSq() === 0) continue;
    const overlap = reach(a, n) + reach(b, n) - Math.abs(d.dot(n));
    if (overlap <= 0) return 0;
    if (overlap < min) min = overlap;
  }
  return Number.isFinite(min) ? min : 0;
}

/**
 * The deepest clash between two components' parts: { depth, parts: 'a × b', count } or null.
 * depth is how far one part must move to clear the other (a post through the middle of a table top:
 * half the top's width), so it says what it takes to fix.
 */
export function deepestClash(a, b, tolerance = TOLERANCE) {
  let best = null;
  let count = 0;
  for (const p of a.parts) {
    if (!p.box.intersectsBox(b.box)) continue;
    for (const q of b.parts) {
      if (!p.box.intersectsBox(q.box)) continue;
      const depth = penetration(p, q);
      if (depth <= tolerance) continue;
      count += 1;
      if (!best || depth > best.depth) best = { depth, parts: `${p.name} × ${q.name}` };
    }
  }
  return best ? { ...best, count } : null;
}
