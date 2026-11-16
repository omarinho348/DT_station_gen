// Small procedural-modelling helpers shared by every component.
// Positions and sizes are [x, y, z] arrays in the caller's local frame (metres).
// Every helper names its object and sets shadows, so components stay consistent.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const UP = new THREE.Vector3(0, 1, 0);

export function group(parent, name, position) {
  const object = new THREE.Group();
  object.name = name;
  if (position) object.position.set(...position);
  parent?.add(object);
  return object;
}

export function addMesh(parent, geometry, material, name, position, { castShadow = true, receiveShadow = true } = {}) {
  const object = new THREE.Mesh(geometry, material);
  object.name = name;
  object.castShadow = castShadow;
  object.receiveShadow = receiveShadow;
  if (position) object.position.set(...position);
  parent?.add(object);
  return object;
}

/** Bevelled box; the radius is clamped so thin plates stay valid. */
export function roundedBoxGeometry([width, height, depth], radius = 0.01, segments = 3) {
  const safeRadius = Math.max(0.0005, Math.min(radius, Math.min(width, height, depth) / 2 - 0.0005));
  return new RoundedBoxGeometry(width, height, depth, segments, safeRadius);
}

export function roundedBox(parent, size, position, material, name, radius = 0.01) {
  return addMesh(parent, roundedBoxGeometry(size, radius), material, name, position);
}

export function box(parent, size, position, material, name) {
  return addMesh(parent, new THREE.BoxGeometry(...size), material, name, position);
}

export function cylinderGeometry(radius, height, { radiusBottom = radius, segments = 24, axis = 'y', openEnded = false } = {}) {
  const geometry = new THREE.CylinderGeometry(radius, radiusBottom, height, segments, 1, openEnded);
  if (axis === 'x') geometry.rotateZ(Math.PI / 2);
  if (axis === 'z') geometry.rotateX(Math.PI / 2);
  return geometry;
}

export function cylinder(parent, radius, height, position, material, name, options) {
  return addMesh(parent, cylinderGeometry(radius, height, options), material, name, position);
}

export function cylinderBetween(parent, from, to, radius, material, name, segments = 16) {
  const start = new THREE.Vector3(...from);
  const end = new THREE.Vector3(...to);
  const direction = end.clone().sub(start);
  const object = addMesh(parent, new THREE.CylinderGeometry(radius, radius, direction.length(), segments), material, name);
  object.position.copy(start).add(end).multiplyScalar(0.5);
  object.quaternion.setFromUnitVectors(UP, direction.normalize());
  return object;
}

/** Rigid pipe: straight segments joined by elbow spheres at each bend. */
export function pipeRun(parent, points, radius, material, name) {
  const run = group(parent, name);
  for (let index = 0; index < points.length - 1; index += 1) {
    cylinderBetween(run, points[index], points[index + 1], radius, material, `${name} segment ${index + 1}`);
  }
  for (let index = 1; index < points.length - 1; index += 1) {
    addMesh(run, new THREE.SphereGeometry(radius * 1.12, 16, 12), material, `${name} elbow ${index}`, points[index]);
  }
  return run;
}

/** Pipe flange: a short wide disc oriented along `axis`. */
export function flange(parent, radius, position, material, name, axis = 'y') {
  return cylinder(parent, radius, 0.018, position, material, name, { axis, segments: 20 });
}
