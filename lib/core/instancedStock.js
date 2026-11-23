// Stock of identical items (a rack of empty containers, a stack of flat cases) drawn with one
// InstancedMesh per template mesh, so a rack of 100+ items costs a dozen draw calls. Taking an item
// hides the last instance (order the slots so the last is the most accessible one). Port of the
// reference factory/SupplyRack.js (createInstancedStock). Used for supply stock that units are
// drawn from as a line releases them.
import * as THREE from 'three';

function isRendered(object, root) {
  for (let node = object; node && node !== root; node = node.parent) if (!node.visible) return false;
  return true;
}

/**
 * @param {object} o
 * @param {string} o.name
 * @param {THREE.Object3D} o.template  an item (e.g. a built product); only its visible meshes are used
 * @param {THREE.Matrix4[]} o.slots    item poses in the stock's frame (origin of the template)
 * @returns {{ root, capacity, remaining, take(): boolean, refill(), dispose() }}
 */
export function createInstancedStock({ name, template, slots }) {
  const root = new THREE.Group();
  root.name = name;
  template.updateMatrixWorld(true);
  const inverse = template.matrixWorld.clone().invert();
  const parts = [];
  template.traverse((object) => {
    if (!object.isMesh || !isRendered(object, template)) return;
    const local = inverse.clone().multiply(object.matrixWorld);
    const mesh = new THREE.InstancedMesh(object.geometry, object.material, Math.max(1, slots.length));
    mesh.name = `${name} · ${object.name || 'part'}`;
    mesh.castShadow = object.castShadow;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.renderOrder = object.renderOrder;
    slots.forEach((slot, index) => mesh.setMatrixAt(index, slot.clone().multiply(local)));
    mesh.instanceMatrix.needsUpdate = true;
    root.add(mesh);
    parts.push(mesh);
  });
  if (!parts.length) throw new Error(`stock "${name}": the template has no visible meshes`);
  let remaining = slots.length;
  const apply = () => parts.forEach((mesh) => { mesh.count = remaining; });
  apply();
  return {
    root,
    capacity: slots.length,
    get remaining() { return remaining; },
    take() {
      if (remaining === 0) return false;
      remaining -= 1;
      apply();
      return true;
    },
    refill() {
      remaining = slots.length;
      apply();
    },
    /** Frees the instance buffers (geometry and materials belong to the template). */
    dispose() {
      root.removeFromParent();
      parts.forEach((mesh) => mesh.dispose());
    },
  };
}
