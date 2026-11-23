// Parametric product (Claude.md §6.6.3): a product the catalog doesn't have, described by its shape
// and size: a box, a cylinder, a bottle or a tray, in a finish and colour. Its stages are visual
// changes in line order, each including the ones before:
//   raw → processed (recoloured: machined, painted, printed) → filled (liquid inside, at
//   `fillLevel`) → capped (cap / lid on) → labelled (label on its front, +Z)
// so the generic ops work on it as on the catalog products: `fill` (routine `fill`, ref
// `liquidSurface`), `cap` (feature `cap`), picks by `grasp` / `top`, labelling by `labelSpot`.
// Origin at the middle of its base; length along X, width along Z, height up.
import * as THREE from 'three';
import { z } from 'zod';
import { defineProduct } from '../../registry.js';
import { textLabel } from '../../core/textures.js';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'a colour like #2a6fdb');
const FINISHES = {
  plastic: { roughness: 0.45, metalness: 0.0 },
  glass: { roughness: 0.05, metalness: 0.0, transmissive: true },
  metal: { roughness: 0.3, metalness: 0.85 },
  cardboard: { roughness: 0.9, metalness: 0.0 },
};

/** Shape numbers: radius of round shapes, the neck of a bottle, the opening at the top. */
function dims(p) {
  const r = Math.min(p.length, p.width) / 2;
  const neckR = Math.max(0.006, r * 0.32);
  const neckH = p.shape === 'bottle' ? p.height * 0.16 : 0;
  const shoulderH = p.shape === 'bottle' ? p.height * 0.14 : 0;
  const bodyH = p.height - neckH - shoulderH;
  const wall = p.shape === 'tray' ? Math.min(0.006, p.height * 0.2) : 0.003;
  // Where the cap / lid sits, and the top of the opening.
  const openR = p.shape === 'bottle' ? neckR : p.shape === 'cylinder' ? r * 0.92 : null;
  return { r, neckR, neckH, shoulderH, bodyH, wall, openR, capH: Math.min(0.03, Math.max(0.006, p.height * 0.08)) };
}

defineProduct({
  type: 'parametric',
  summary: 'A product described by shape and size (box, cylinder, bottle, tray), finish and colour; raw, processed, filled, capped, labelled.',
  params: z.object({
    shape: z.enum(['box', 'cylinder', 'bottle', 'tray']).default('bottle').describe('Shape'),
    length: z.number().min(0.02).max(1.2).default(0.08).describe('Along X (m); a round shape takes the smaller of length and width as its diameter'),
    width: z.number().min(0.02).max(1.2).default(0.08).describe('Along Z (m)'),
    height: z.number().min(0.01).max(1.2).default(0.25).describe('Height (m)'),
    finish: z.enum(Object.keys(FINISHES)).default('glass').describe('Surface: plastic, glass, metal, cardboard'),
    color: hex.default('#9ec9b8').describe('Colour of the body'),
    processedColor: hex.optional().describe('Its colour once processed (machined, painted, printed); none: processing leaves the colour'),
    liquid: hex.default('#c8901c').describe('Colour of what it is filled with'),
    fillLevel: z.number().min(0.05).max(1).default(0.85).describe('Share of the inside filled at stage "filled"'),
    capColor: hex.default('#d23c2c').describe('Colour of the cap or lid'),
    labelText: z.string().max(24).default('PRODUCT').describe('Text on its label'),
    serial: z.number().int().min(0).default(0).describe('Unit serial (set by the line)'),
    rejectEvery: z.number().int().min(0).max(1000).default(0).describe('Quality: every Nth serial fails inspection (0: none). Deterministic by serial, never random'),
  }),
  stages: ['raw', 'processed', 'filled', 'capped', 'labelled'],
  facts: { quality: { values: ['pass', 'reject'] } },
  refs: ['grasp', 'top', 'base', 'neckTop', 'capSeat', 'liquidSurface', 'labelSpot'],
  features: { cap: { values: ['off', 'on'] }, label: { values: ['off', 'on'] } },
  routines: {
    fill: { summary: 'Raise the liquid from where it is to `to` (share of the inside; default the fill level).', args: z.object({ to: z.number().min(0).max(1).optional() }) },
    process: { summary: 'Turn its colour from the raw colour to the processed one as the step runs.', args: z.object({}) },
    label: { summary: 'Lay its label on as the step runs (from one edge to the other).', args: z.object({}) },
  },
  build({ params: p }) {
    const d = dims(p);
    const f = FINISHES[p.finish];
    const owned = { geometries: [], materials: [], textures: [] };
    const geo = (g) => { owned.geometries.push(g); return g; };
    const mat = (m) => { owned.materials.push(m); return m; };
    const rawColor = new THREE.Color(p.color);
    const doneColor = new THREE.Color(p.processedColor ?? p.color);
    const bodyMat = mat(f.transmissive
      ? new THREE.MeshPhysicalMaterial({ color: rawColor.clone(), roughness: f.roughness, metalness: 0, transparent: true, opacity: 0.38, depthWrite: false })
      : new THREE.MeshStandardMaterial({ color: rawColor.clone(), roughness: f.roughness, metalness: f.metalness }));
    bodyMat.name = 'parametric body';
    const liquidMat = mat(new THREE.MeshStandardMaterial({ color: p.liquid, roughness: 0.25, transparent: true, opacity: 0.92 }));
    liquidMat.name = 'parametric liquid';
    const capMat = mat(new THREE.MeshStandardMaterial({ color: p.capColor, roughness: 0.5 }));
    capMat.name = 'parametric cap';
    const labelMap = textLabel({ width: 512, height: 256, background: '#f4f6f8', color: '#1d2a33', border: '#2f6f9f', lines: [{ text: p.labelText, size: 70, y: 0.42 }, { text: `#${String(p.serial).padStart(4, '0')}`, size: 40, y: 0.74, bold: false }] });
    owned.textures.push(labelMap);
    const labelMat = mat(new THREE.MeshStandardMaterial({ map: labelMap, roughness: 0.7, side: THREE.DoubleSide }));
    labelMat.name = 'parametric label';

    const root = new THREE.Group();
    root.name = 'Parametric product';
    const add = (geometry, material, name, position = [0, 0, 0], parent = root) => {
      const m = new THREE.Mesh(geo(geometry), material);
      m.name = name;
      m.position.fromArray(position);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };

    // Body, and the liquid volume inside it (a unit-height shape scaled to the level).
    let innerH;
    let liquidBase;
    let liquid = null;
    if (p.shape === 'box') {
      add(new THREE.BoxGeometry(p.length, p.height, p.width).translate(0, p.height / 2, 0), bodyMat, 'Body');
      innerH = p.height - 2 * d.wall; liquidBase = d.wall;
      liquid = add(new THREE.BoxGeometry(p.length - 2 * d.wall, 1, p.width - 2 * d.wall).translate(0, 0.5, 0), liquidMat, 'Liquid', [0, liquidBase, 0]);
    } else if (p.shape === 'tray') {
      const w = d.wall;
      add(new THREE.BoxGeometry(p.length, w, p.width).translate(0, w / 2, 0), bodyMat, 'Tray base');
      for (const [side, size, pos] of [
        ['front', [p.length, p.height, w], [0, p.height / 2, p.width / 2 - w / 2]],
        ['rear', [p.length, p.height, w], [0, p.height / 2, -p.width / 2 + w / 2]],
        ['left', [w, p.height, p.width - 2 * w], [-p.length / 2 + w / 2, p.height / 2, 0]],
        ['right', [w, p.height, p.width - 2 * w], [p.length / 2 - w / 2, p.height / 2, 0]],
      ]) add(new THREE.BoxGeometry(...size), bodyMat, `Tray wall ${side}`, pos);
      innerH = p.height - w; liquidBase = w;
      liquid = add(new THREE.BoxGeometry(p.length - 2 * w, 1, p.width - 2 * w).translate(0, 0.5, 0), liquidMat, 'Contents', [0, liquidBase, 0]);
    } else {
      // Cylinder or bottle: a round body, a bottle with shoulder and neck.
      add(new THREE.CylinderGeometry(d.r, d.r, d.bodyH, 40).translate(0, d.bodyH / 2, 0), bodyMat, 'Body');
      if (p.shape === 'bottle') {
        add(new THREE.CylinderGeometry(d.neckR, d.r, d.shoulderH, 40).translate(0, d.bodyH + d.shoulderH / 2, 0), bodyMat, 'Shoulder');
        add(new THREE.CylinderGeometry(d.neckR, d.neckR, d.neckH, 28).translate(0, d.bodyH + d.shoulderH + d.neckH / 2, 0), bodyMat, 'Neck');
      }
      innerH = d.bodyH - 0.004; liquidBase = 0.002;
      liquid = add(new THREE.CylinderGeometry(d.r - 0.003, d.r - 0.003, 1, 40).translate(0, 0.5, 0), liquidMat, 'Liquid', [0, liquidBase, 0]);
    }
    if (f.transmissive) liquid.renderOrder = 1;

    // Cap / lid: a screw cap on a bottle, a lid on the rest.
    const topY = p.height;
    const cap = p.shape === 'bottle'
      ? add(new THREE.CylinderGeometry(d.neckR + 0.003, d.neckR + 0.003, d.capH, 28).translate(0, d.capH / 2, 0), capMat, 'Cap', [0, topY - d.capH * 0.6, 0])
      : p.shape === 'cylinder'
        ? add(new THREE.CylinderGeometry(d.r + 0.002, d.r + 0.002, d.capH * 0.5, 40).translate(0, d.capH * 0.25, 0), capMat, 'Lid', [0, topY, 0])
        : add(new THREE.BoxGeometry(p.length + 0.004, d.capH * 0.4, p.width + 0.004).translate(0, d.capH * 0.2, 0), capMat, p.shape === 'tray' ? 'Film lid' : 'Lid', [0, topY, 0]);
    const capTop = p.shape === 'bottle' ? topY + d.capH * 0.4 : p.shape === 'cylinder' ? topY + d.capH * 0.5 : topY + d.capH * 0.4;

    // Label on the front (+Z): flat on a box or tray, wrapped round a cylinder or bottle. It is laid
    // on from one edge to the other (`label` routine): a flat one by its width, a wrapped one by the
    // share of its arc drawn.
    const round = p.shape === 'cylinder' || p.shape === 'bottle';
    const faceH = p.shape === 'box' || p.shape === 'tray' ? p.height : d.bodyH;
    const labelH = faceH * 0.45;
    const labelY = faceH * 0.5;
    const labelW = (round ? d.r * 2 : p.length) * 0.8; // flat width, or arc length when wrapped
    const frontZ = round ? d.r + 0.0008 : p.width / 2 + 0.0008;
    const labelHolder = new THREE.Group();
    labelHolder.name = 'Label holder';
    root.add(labelHolder);
    let label;
    let arcIndexCount = 0;
    if (round) {
      // A band of the cylinder round +Z, its arc = labelW (texture drawn from its left edge).
      const arc = Math.min(labelW / (d.r + 0.0008), Math.PI * 1.2);
      const g = new THREE.CylinderGeometry(d.r + 0.0008, d.r + 0.0008, labelH, 32, 1, true, -arc / 2, arc);
      label = add(g, labelMat, 'Label', [0, labelY, 0], labelHolder);
      arcIndexCount = g.index.count;
    } else {
      labelHolder.position.set(-labelW / 2, labelY, frontZ);
      label = add(new THREE.PlaneGeometry(1, labelH).translate(0.5, 0, 0), labelMat, 'Label', [0, 0, 0], labelHolder);
    }
    label.castShadow = false;

    let level = 0;
    const setLevel = (v) => {
      level = THREE.MathUtils.clamp(v, 0, 1);
      liquid.visible = level > 0.001;
      liquid.scale.y = Math.max(1e-4, level * innerH);
    };
    let labelShown = 0;
    const setLabel = (share) => {
      labelShown = THREE.MathUtils.clamp(share, 0, 1);
      label.visible = labelShown > 0.001;
      if (round) label.geometry.setDrawRange(0, Math.round((labelShown * arcIndexCount) / 6) * 6); // whole segments
      else labelHolder.scale.x = Math.max(1e-4, labelShown * labelW);
    };
    const setTint = (t) => bodyMat.color.copy(rawColor).lerp(doneColor, THREE.MathUtils.clamp(t, 0, 1));
    const setCap = (on) => { cap.visible = on; };
    const order = ['raw', 'processed', 'filled', 'capped', 'labelled'];
    const setStage = (stage) => {
      const i = order.indexOf(stage);
      setTint(i >= 1 ? 1 : 0);
      setLevel(i >= 2 ? p.fillLevel : 0);
      setCap(i >= 3);
      setLabel(i >= 4 ? 1 : 0);
    };
    return {
      root,
      setStage,
      refs: {
        grasp: () => new THREE.Vector3(0, p.shape === 'bottle' ? d.bodyH + d.shoulderH * 0.5 : p.height * 0.5, 0),
        top: () => new THREE.Vector3(0, cap.visible ? capTop : topY, 0),
        base: () => new THREE.Vector3(0, 0, 0),
        neckTop: () => new THREE.Vector3(0, topY, 0),
        capSeat: () => new THREE.Vector3(0, p.shape === 'bottle' ? topY - d.capH * 0.6 : topY, 0),
        // Live: it rises as the product fills (a filling stream ends here).
        liquidSurface: () => new THREE.Vector3(0, liquidBase + level * innerH, 0),
        labelSpot: () => new THREE.Vector3(0, labelY, frontZ),
      },
      features: { cap: (v) => setCap(v === 'on'), label: (v) => setLabel(v === 'on' ? 1 : 0) },
      // What an inspection decides on: a deterministic function of the serial (Claude.md rule 5).
      facts: { quality: () => (p.rejectEvery > 0 && p.serial > 0 && p.serial % p.rejectEvery === 0 ? 'reject' : 'pass') },
      routines: {
        fill: ({ to = p.fillLevel } = {}) => {
          let from = 0;
          return { start: () => { from = level; }, update: (k) => setLevel(from + (to - from) * k), end: () => setLevel(to) };
        },
        process: () => ({ update: (k) => setTint(k), end: () => setTint(1) }),
        label: () => ({ update: (k) => setLabel(k), end: () => setLabel(1) }),
      },
      api: { level: () => level, label: () => labelShown },
      dispose() {
        owned.geometries.forEach((g) => g.dispose());
        owned.textures.forEach((t) => t.dispose());
        owned.materials.forEach((m) => m.dispose());
      },
    };
  },
});
