// The unit a station works on, measured (Phase 13): what machines are fitted to (a nozzle
// height to the neck, a cap seat to the cap seat, a tamp pad to the label spot) and what routines
// reach for (a tamp pad to the unit's face, a gripper to its width). Built once from the line's
// product, in Node as in the browser; nothing here names a product (rule 6).
//
//   measureUnit(registry, product, ctx) → { size: [x, y, z], refs: { name: [x, y, z] } } | null
//
// Product frame: its base at y = 0 on the surface it stands on, centred on x / z. Measured at its last
// stage (capped, labelled: everything it gains on the line), so heights include what it gains.
import * as THREE from 'three';
import { createMaterials } from '../core/materials.js';

const r4 = (v) => Math.round(v * 1e4) / 1e4;

/** The product type of a factory.json product entry. */
export const productTypeOf = (product) => (product.kind === 'catalog' ? product.type : product.kind === 'glb' ? 'model' : 'parametric');

/**
 * Measures the line's product (factory.json's product entry). null when it can't be built here (a GLB
 * whose model is not loaded): fitting then leaves the params as they are.
 */
export function measureUnit(registry, product, ctx = {}) {
  if (!product) return null;
  let built;
  try {
    built = registry.buildProduct(productTypeOf(product), product.params ?? {}, { ...ctx, materials: createMaterials() });
  } catch {
    return null;
  }
  try {
    const def = registry.getProduct(productTypeOf(product));
    const last = def?.stages?.at(-1);
    if (last) built.setStage(last);
    built.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(built.root);
    const size = box.isEmpty() ? [0, 0, 0] : box.getSize(new THREE.Vector3()).toArray().map(r4);
    const refs = {};
    for (const name of built.refs ?? []) {
      try {
        const v = built.ref(name);
        if (v?.isVector3) refs[name] = v.toArray().map(r4);
      } catch { /* a ref that needs a running line (none so far) */ }
    }
    return { size, refs };
  } finally {
    built.dispose?.();
    built.root.removeFromParent?.();
  }
}
