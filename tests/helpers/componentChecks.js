// Generic quality checks for any built component (Claude.md §9). Used by the component tests.
import * as THREE from 'three';

const TOL = 0.002; // 2 mm

/** Every Object3D has a name (meshes and groups). Returns the offenders' paths. */
export function unnamedObjects(root) {
  const out = [];
  root.traverse((o) => {
    if (!o.name) out.push(pathOf(o, root) || o.type);
  });
  return out;
}

/** Meshes whose geometry or world position has NaN / Infinity. */
export function nonFiniteMeshes(root) {
  root.updateMatrixWorld(true);
  const out = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position?.array ?? [];
    const bad = !Array.from(pos).every(Number.isFinite) || !o.matrixWorld.elements.every(Number.isFinite);
    if (bad) out.push(o.name);
  });
  return out;
}

/** Exact bounds from the vertices (rough boxes grow when a part rotates, e.g. a pulley). */
export function boundsOf(root) {
  root.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(root, true);
}

/** Is the built root inside its declared footprint (x, z ranges and 0…height)? */
export function footprintViolations(root, footprint) {
  const b = boundsOf(root);
  const v = [];
  if (b.min.x < footprint.x[0] - TOL) v.push(`min.x ${b.min.x.toFixed(4)} < ${footprint.x[0]}`);
  if (b.max.x > footprint.x[1] + TOL) v.push(`max.x ${b.max.x.toFixed(4)} > ${footprint.x[1]}`);
  if (b.min.z < footprint.z[0] - TOL) v.push(`min.z ${b.min.z.toFixed(4)} < ${footprint.z[0]}`);
  if (b.max.z > footprint.z[1] + TOL) v.push(`max.z ${b.max.z.toFixed(4)} > ${footprint.z[1]}`);
  if (b.max.y > footprint.height + TOL) v.push(`max.y ${b.max.y.toFixed(4)} > height ${footprint.height}`);
  const bottom = footprint.bottom ?? 0;
  if (bottom < 0 && b.min.y < bottom - TOL) v.push(`min.y ${b.min.y.toFixed(4)} < bottom ${bottom}`);
  return v;
}

/** Lowest point of all meshes (must be ≥ 0: nothing below the floor). */
export function lowestPoint(root) {
  return boundsOf(root).min.y;
}

/**
 * "Nothing floats": every mesh must be connected to the floor through a chain of meshes whose
 * bounding boxes touch or overlap (2 mm tolerance). Returns the names of floating meshes.
 * Box contact is a coarse test (it can miss a gap inside overlapping boxes) but catches
 * parts hanging in the air, which is the common modelling mistake.
 * Meshes marked userData.restsOnLoad (film lying on a held load) are not checked.
 * anchor 'top': for tools, which hang from a flange: everything must connect to the topmost part.
 */
export function floatingMeshes(root, { floorY = 0, anchor = 'floor' } = {}) {
  root.updateMatrixWorld(true);
  const meshes = [];
  root.traverse((o) => {
    // Meshes that lie on a load the machine holds (stretch film on a pallet) rest on that load, not
    // on the machine: they are marked userData.restsOnLoad and left out.
    if (o.isMesh && o.visible && !o.userData.restsOnLoad && isShown(o, root)) meshes.push({ name: o.name, box: new THREE.Box3().setFromObject(o, true).expandByScalar(TOL) });
  });
  const top = Math.max(...meshes.map((m) => m.box.max.y));
  const grounded = new Set(meshes.filter((m) => (anchor === 'top' ? m.box.max.y >= top - TOL : m.box.min.y <= floorY + TOL)));
  let grew = true;
  while (grew) {
    grew = false;
    for (const m of meshes) {
      if (grounded.has(m)) continue;
      for (const g of grounded) {
        if (m.box.intersectsBox(g.box)) {
          grounded.add(m);
          grew = true;
          break;
        }
      }
    }
  }
  return meshes.filter((m) => !grounded.has(m)).map((m) => m.name);
}

/** Visible all the way up to the root (a hidden group hides its children). */
function isShown(o, root) {
  for (let n = o; n && n !== root; n = n.parent) if (!n.visible) return false;
  return true;
}

function pathOf(o, root) {
  const parts = [];
  for (let n = o; n && n !== root.parent; n = n.parent) parts.unshift(n.name || `<${n.type}>`);
  return parts.join(' / ');
}
