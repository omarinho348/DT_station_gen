// Dev-only check scenes for the ops: builds the equipment listed in a scene file
// (app/dev/ops-scenes/<name>.json) from the registry, makes the product (a catalog product or a
// plain box) and box items, and plays the scene's process through an OpCycle in a loop.
// Open with #/twin?demo=ops (scene "basic") or #/twin?demo=ops&scene=assembly.
// Nothing here knows a component or product by name (rule 6): it is all data.
import * as THREE from 'three';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import { OpCycle, dryRun } from '../../lib/ops/index.js';
import { StepSequencer } from '../../lib/core/StepSequencer.js';
import { createMaterials, disposeMaterials } from '../../lib/core/materials.js';

const SCENES = Object.fromEntries(Object.entries(import.meta.glob('./ops-scenes/*.json', { eager: true, import: 'default' }))
  .map(([path, scene]) => [path.match(/([^/]+)\.json$/)[1], scene]));

export const sceneNames = () => Object.keys(SCENES);

/** Dry-run timing of a scene (the same steps the twin plays; decisions at their longest). */
export function sceneTiming(scene) {
  return dryRun(registry, scene.process, {
    equipment: Object.fromEntries(scene.equipment.map((e) => [e.id, { type: e.type, params: e.params }])),
    items: Object.keys(scene.items ?? {}),
    at: scene.start,
    workState: scene.workState,
    product: scene.product?.type ?? null,
  });
}

function boxItem(name, spec, materials) {
  const item = new THREE.Group();
  item.name = `item ${name}`;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...spec.box), materials[spec.color]);
  mesh.name = `item ${name} body`;
  mesh.position.y = spec.box[1] / 2; // origin at the underside, like every product
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  item.add(mesh);
  return item;
}

export function createDemo({ scene: sceneName = 'basic', onStep } = {}) {
  const scene = SCENES[sceneName];
  if (!scene) throw new Error(`Unknown ops scene "${sceneName}" (scenes: ${sceneNames().join(', ')})`);
  const materials = createMaterials();
  const root = new THREE.Group();
  root.name = `opsDemo ${sceneName}`;

  const equipment = {};
  for (const e of scene.equipment) {
    const inst = registry.buildComponent(e.type, e.params, { materials });
    inst.root.position.fromArray(e.position);
    root.add(inst.root);
    equipment[e.id] = inst;
  }
  const items = {};
  for (const [name, spec] of Object.entries(scene.items ?? {})) {
    items[name] = boxItem(name, spec, materials);
    root.add(items[name]);
  }

  const timing = sceneTiming(scene);
  console.info(`[opsDemo] ${sceneName}: cycle ${timing.duration.toFixed(2)} s (longest branch)`, timing.steps);

  let serial = 0;
  let product = null;
  const makeProduct = () => {
    const spec = scene.product;
    let unit;
    if (spec.type) {
      unit = registry.buildProduct(spec.type, { serial }, { materials });
      if (spec.stage) unit.setStage(spec.stage);
    } else {
      const box = boxItem('product', spec, materials);
      unit = { root: box, dispose: () => { box.removeFromParent(); box.traverse((o) => o.geometry?.dispose()); } };
    }
    unit.root.position.fromArray(spec.at);
    root.add(unit.root);
    return unit;
  };

  const sequencer = new StepSequencer({
    plan: () => {
      // A new unit: the old one leaves, items go back to their start, the process runs again.
      serial += 1;
      product?.dispose();
      product = makeProduct();
      for (const [name, spec] of Object.entries(scene.items ?? {})) {
        root.attach(items[name]);
        items[name].position.fromArray(spec.at);
        items[name].quaternion.identity();
      }
      const cycle = new OpCycle({
        registry, sequencer, equipment, product, items,
        facts: { quality: () => (serial % 3 === 0 ? 'fail' : 'pass') }, // deterministic per serial
        workState: scene.workState,
        at: scene.start,
      });
      cycle.expand(scene.process);
    },
    onStepStart: (step) => onStep?.(`Unit ${serial} · ${step.state} · ${step.label}`),
  });

  return {
    root,
    timing,
    camera: scene.camera ?? null,
    update(dt) {
      sequencer.advance(Math.min(dt, 0.1));
    },
    /** Jump ahead (screenshots of a given moment). */
    skip(seconds) {
      for (let left = seconds; left > 1e-9; left -= 1) sequencer.advance(Math.min(1, left));
    },
    dispose() {
      product?.dispose();
      Object.values(equipment).forEach((e) => e.dispose());
      Object.values(items).forEach((i) => i.traverse((o) => o.geometry?.dispose()));
      root.removeFromParent();
      disposeMaterials(materials);
    },
  };
}
