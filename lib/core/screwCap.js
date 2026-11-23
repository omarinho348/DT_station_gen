// Ribbed screw cap: shell with moulded grip ribs, top disc and tamper ring. Shared by containers
// (the jerry can's own cap) and the machines that feed and screw caps on, so both draw the same cap.
// Port of the reference station-1 JerryCan.js (createRibbedCapGeometry / createCapFactory).
import * as THREE from 'three';
import { group, addMesh } from './primitives.js';

/** Cylinder whose outer vertices alternate between two radii: moulded grip ribs. */
export function ribbedCapGeometry(radius, height, segments = 48) {
  const geometry = new THREE.CylinderGeometry(radius, radius, height, segments, 1);
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const z = position.getZ(i);
    if (Math.hypot(x, z) < radius * 0.99) continue;
    const angle = Math.atan2(z, x);
    const rib = Math.round(((angle + Math.PI) / (Math.PI * 2)) * segments) % 2 === 0 ? 1.045 : 1;
    position.setXYZ(i, x * rib, position.getY(i), z * rib);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A cap as a Group whose origin is the cap centre (so a chuck can carry it and hand it to a
 * container). Geometry is made per call; the caller owns the material.
 */
export function createScrewCap({ radius, height, material, name = 'Cap' }) {
  const cap = group(null, name);
  addMesh(cap, ribbedCapGeometry(radius, height), material, 'Cap shell');
  addMesh(cap, new THREE.CylinderGeometry(radius * 0.86, radius * 0.92, 0.004, 32), material, 'Cap top', [0, height / 2 + 0.001, 0]);
  addMesh(cap, new THREE.TorusGeometry(radius * 0.98, 0.0022, 8, 32).rotateX(Math.PI / 2), material, 'Tamper ring', [0, -height / 2 + 0.002, 0]);
  return cap;
}
