// GLB product (Claude.md §6.4, §6.6.3): the owner's own model of the product, imported as a GLB in
// lib/assets/, with the grasp point marked by the user (params, in the model's frame after scale and
// turn). The model is rested on its base and centred on its middle (as the reference AssetManager
// rests a model), so the line can carry it like any product.
//
// Stages: raw → processed (every surface tinted towards `processedTint`: painted, coated) →
// labelled (a label on its front, +Z). Refs: `grasp` (marked, or the middle of its top),
// `top`, `base`, `labelSpot`. Feature `label`. Routines `process` and `label` (as the parametric
// product). The model's own meshes and materials are shared with the asset cache (assets.js);
// only the tinted copies of its materials and the label are this unit's.
//
// The file must be loaded first: preloadComponentAssets(registry, null, [{ type: 'model', params }])
// or loadAsset(file). `sampleCrate.glb` (scripts/make-sample-glb.mjs) is the built-in sample.
import * as THREE from 'three';
import { z } from 'zod';
import { defineProduct } from '../../registry.js';
import { instantiate } from '../../core/assets.js';
import { textLabel } from '../../core/textures.js';

const SAMPLE = 'sampleCrate.glb';
const vec3 = z.tuple([z.number(), z.number(), z.number()]);

defineProduct({
  type: 'model',
  summary: 'A product imported as a GLB model (the owner\'s file) with its grasp point marked; raw, processed (tinted), labelled.',
  params: z.object({
    file: z.string().regex(/^[\w.-]+\.glb$/, 'a .glb file name in lib/assets/').default(SAMPLE).describe('The model file'),
    scale: z.number().min(0.001).max(100).default(1).describe('Model units → metres'),
    turn: z.number().min(-2 * Math.PI).max(2 * Math.PI).default(0).describe('Turn about the vertical (rad), so it faces +X along the flow'),
    grasp: vec3.optional().describe('Grasp point the user marked (m, product frame); default: the middle of its top'),
    processedTint: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#2f6f9f').describe('Colour it takes when processed'),
    labelText: z.string().max(24).default('PRODUCT').describe('Text on its label'),
    serial: z.number().int().min(0).default(0).describe('Unit serial (set by the line)'),
  }),
  assets: (p) => [p.file],
  stages: ['raw', 'processed', 'labelled'],
  refs: ['grasp', 'top', 'base', 'labelSpot'],
  features: { label: { values: ['off', 'on'] } },
  routines: {
    process: { summary: 'Tint every surface towards the processed colour as the step runs.', args: z.object({}) },
    label: { summary: 'Lay its label on as the step runs.', args: z.object({}) },
  },
  build({ params: p }) {
    const root = new THREE.Group();
    root.name = 'Model product';
    const content = instantiate(p.file);
    content.name = `Model ${p.file}`;
    content.scale.setScalar(p.scale);
    content.rotation.y = p.turn;
    const holder = new THREE.Group();
    holder.name = 'Model holder';
    holder.add(content);
    root.add(holder);
    // Rest it on its base, centred.
    holder.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(content);
    const centre = bounds.getCenter(new THREE.Vector3());
    holder.position.set(-centre.x, -bounds.min.y, -centre.z);
    const size = bounds.getSize(new THREE.Vector3());

    // This unit's own copies of the model's materials (the cached ones are shared), to tint them.
    const owned = [];
    const tints = [];
    const target = new THREE.Color(p.processedTint);
    content.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      o.material = [o.material].flat().map((m) => {
        const copy = m.clone();
        copy.userData = { ...copy.userData, shared: false };
        owned.push(copy);
        if (copy.color) tints.push({ material: copy, from: copy.color.clone() });
        return copy;
      });
      if (o.material.length === 1) [o.material] = o.material;
    });
    const setTint = (k) => tints.forEach(({ material, from }) => material.color.copy(from).lerp(target, 0.75 * THREE.MathUtils.clamp(k, 0, 1)));

    // Label on the front (+Z) face of its bounds.
    const labelW = size.x * 0.6;
    const labelH = size.y * 0.35;
    const labelY = size.y * 0.5;
    const frontZ = size.z / 2 + 0.001;
    const map = textLabel({ width: 512, height: 256, background: '#f4f6f8', color: '#1d2a33', border: '#2f6f9f', lines: [{ text: p.labelText, size: 70, y: 0.42 }, { text: `#${String(p.serial).padStart(4, '0')}`, size: 40, y: 0.74, bold: false }] });
    const labelMat = new THREE.MeshStandardMaterial({ map, roughness: 0.7, side: THREE.DoubleSide });
    labelMat.name = 'model label';
    owned.push(labelMat);
    const labelGeo = new THREE.PlaneGeometry(1, labelH).translate(0.5, 0, 0);
    const labelHolder = new THREE.Group();
    labelHolder.name = 'Label holder';
    labelHolder.position.set(-labelW / 2, labelY, frontZ);
    const label = new THREE.Mesh(labelGeo, labelMat);
    label.name = 'Label';
    labelHolder.add(label);
    root.add(labelHolder);
    let shown = 0;
    const setLabel = (k) => {
      shown = THREE.MathUtils.clamp(k, 0, 1);
      label.visible = shown > 0.001;
      labelHolder.scale.x = Math.max(1e-4, shown * labelW);
    };

    const order = ['raw', 'processed', 'labelled'];
    return {
      root,
      setStage: (stage) => {
        const i = order.indexOf(stage);
        setTint(i >= 1 ? 1 : 0);
        setLabel(i >= 2 ? 1 : 0);
      },
      refs: {
        grasp: () => (p.grasp ? new THREE.Vector3(...p.grasp) : new THREE.Vector3(0, size.y, 0)),
        top: () => new THREE.Vector3(0, size.y, 0),
        base: () => new THREE.Vector3(0, 0, 0),
        labelSpot: () => new THREE.Vector3(0, labelY, frontZ),
      },
      features: { label: (v) => setLabel(v === 'on' ? 1 : 0) },
      routines: {
        process: () => ({ update: (k) => setTint(k), end: () => setTint(1) }),
        label: () => ({ update: (k) => setLabel(k), end: () => setLabel(1) }),
      },
      api: { size: () => size.clone(), label: () => shown },
      dispose() {
        labelGeo.dispose();
        map.dispose();
        owned.forEach((m) => m.dispose());
      },
    };
  },
});
