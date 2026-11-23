// HDPE lubricant jerry can (20 L by default), filled and capped on a filling line. Port of the
// reference station-1 JerryCan.js (createJerryCanFactory) and its OilMaterials finishes and label.
// Origin at the centre of the base (it rests on the belt); length along X with the neck towards +X
// and the handle towards −X, width along Z. The natural body is translucent, so the oil level shows.
//
// Stages: empty → filled → capped. The `fill` routine raises the oil level during filling;
// the `cap` feature shows the screw cap on the neck (a capping machine hands its own cap over by switching
// it on). Refs: neckTop (rim of the neck, where a filling nozzle enters), capSeat (cap centre when
// screwed on), grasp (centre of the handle grip, where a handle gripper holds the can),
// liquidSurface (the oil surface under the neck, live as the can fills).
import * as THREE from 'three';
import { z } from 'zod';
import { defineProduct } from '../../registry.js';
import { group, addMesh, roundedBoxGeometry } from '../../core/primitives.js';
import { canvasTexture } from '../../core/textures.js';
import { createScrewCap } from '../../core/screwCap.js';

const REFERENCE_LENGTH = 0.28; // handle and label sizes are scaled from the reference can
const OIL_INSET = 0.012;
const OIL_BASE = 0.012;
const SHOULDER = 0.012;

const LOOKS = {
  natural: { body: 0xf0ebdd, solid: 0xe8e2d0, cap: 0x1f5ea8, translucent: true },
  yellow: { body: 0xf5c400, solid: 0xf2c000, cap: 0xf5c600, translucent: false },
};

// ---- Finishes, one set per shared material library and look / label text -----------------------

const sets = new WeakMap();

function drawLabel(context, width, height, { grade, volume }) {
  context.fillStyle = '#1d4f8f';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#e39a26';
  context.fillRect(0, height * 0.68, width, height * 0.07);
  context.fillStyle = '#f4f6f8';
  context.textAlign = 'center';
  const fit = (text, size, y) => {
    context.font = `bold ${size}px Arial, sans-serif`;
    const scale = Math.min(1, (width * 0.9) / Math.max(1, context.measureText(text).width));
    context.font = `bold ${Math.floor(size * scale)}px Arial, sans-serif`;
    context.fillText(text, width / 2, y);
  };
  fit('INDUSTRIAL', 64, height * 0.2);
  fit('LUBRICANT', 64, height * 0.32);
  fit(grade, 88, height * 0.52);
  fit(volume, 72, height * 0.9);
}

function finishes(shared, { look, grade, volume }) {
  if (!sets.has(shared)) sets.set(shared, new Map());
  const byKey = sets.get(shared);
  const key = `${look}|${grade}|${volume}`;
  if (byKey.has(key)) return byKey.get(key);
  const c = LOOKS[look];
  const own = {
    body: c.translucent
      ? new THREE.MeshPhysicalMaterial({ color: c.body, metalness: 0, roughness: 0.46, clearcoat: 0.25, clearcoatRoughness: 0.5, transparent: true, opacity: 0.56, depthWrite: false })
      : new THREE.MeshPhysicalMaterial({ color: c.body, metalness: 0, roughness: 0.38, clearcoat: 0.45, clearcoatRoughness: 0.35 }),
    solid: new THREE.MeshStandardMaterial({ color: c.solid, metalness: 0, roughness: 0.5 }),
    cap: new THREE.MeshStandardMaterial({ color: c.cap, metalness: 0.05, roughness: 0.4 }),
    label: new THREE.MeshStandardMaterial({
      map: canvasTexture(512, 600, (ctx, w, h) => drawLabel(ctx, w, h, { grade, volume }), { fallback: [29, 79, 143, 255] }),
      metalness: 0,
      roughness: 0.6,
    }),
    oil: new THREE.MeshPhysicalMaterial({ color: 0xc2860f, emissive: 0x2a1800, metalness: 0, roughness: 0.12, clearcoat: 0.6 }),
  };
  for (const [name, material] of Object.entries(own)) material.name = `jerry can ${name}`;
  byKey.set(key, own);
  return own;
}

/** Frees the jerry-can finishes made for a shared material library. */
export function disposeJerryCanMaterials(shared) {
  for (const own of sets.get(shared)?.values() ?? []) {
    for (const material of Object.values(own)) {
      material.map?.dispose();
      material.dispose();
    }
  }
  sets.delete(shared);
}

// ---- Geometry, shared by every can of the same size ----------------------------------------------

const geometryCache = new Map();
function cached(key, build) {
  if (!geometryCache.has(key)) {
    const geometry = build();
    geometry.userData.shared = true;
    geometryCache.set(key, geometry);
  }
  return geometryCache.get(key);
}

/** Every size derived from the params (also used by the refs and the tests). */
export function canDimensions(p) {
  const k = p.length / REFERENCE_LENGTH;
  const neckBaseY = p.height + 0.008;
  const neckTopY = neckBaseY + p.neckHeight;
  return {
    k,
    innerHeight: p.height - OIL_BASE - p.cornerRadius,
    neckBaseY,
    neckTopY,
    capSeatY: neckTopY - p.capHeight / 2 + 0.006,
    handle: { rearX: -0.1 * k, frontX: -0.008 * k, gripX: -0.054 * k, gripLength: 0.15 * k, postY: p.height + 0.02, gripY: p.height + 0.052 },
    label: {
      width: Math.min(0.17, p.length - 2 * p.cornerRadius - 0.04),
      height: Math.min(0.2, p.height - 2 * p.cornerRadius - 0.06),
      x: -0.035 * k,
      y: p.height / 2,
    },
  };
}

defineProduct({
  type: 'jerryCan',
  summary: 'HDPE jerry can for lubricants or chemicals: filled through its neck, screw-capped, carried by its handle.',
  params: z.object({
    length: z.number().min(0.15).max(0.45).default(0.28).describe('Length along X (m)'),
    width: z.number().min(0.1).max(0.3).default(0.19).describe('Width along Z (m)'),
    height: z.number().min(0.15).max(0.55).default(0.36).describe('Body height (m)'),
    cornerRadius: z.number().min(0.005).max(0.06).default(0.03).describe('Body corner radius (m)'),
    neckOffsetX: z.number().min(0).max(0.2).default(0.075).describe('Neck centre from the body centre, towards +X (m)'),
    neckRadius: z.number().min(0.01).max(0.04).default(0.021).describe('Neck radius (m)'),
    neckHeight: z.number().min(0.01).max(0.06).default(0.03).describe('Neck height (m)'),
    capRadius: z.number().min(0.012).max(0.055).default(0.027).describe('Cap radius (m)'),
    capHeight: z.number().min(0.01).max(0.05).default(0.032).describe('Cap height (m)'),
    fillLevel: z.number().min(0.1).max(1).default(0.9).describe('Share of the inner height filled at stage "filled"'),
    look: z.enum(['natural', 'yellow']).default('natural').describe('Natural translucent HDPE with a blue cap, or opaque yellow'),
    grade: z.string().max(12).default('15W-40').describe('Big line of the label'),
    volume: z.string().max(8).default('20 L').describe('Bottom line of the label'),
  }).superRefine((p, ctx) => {
    const issue = (path, message) => ctx.addIssue({ code: 'custom', path: [path], message });
    const shoulderR = p.neckRadius + 0.014;
    if (p.capRadius <= p.neckRadius || p.capRadius > p.neckRadius + 0.015) issue('capRadius', 'must be 0–15 mm larger than neckRadius');
    if (p.cornerRadius > Math.min(p.length, p.width, p.height) / 4) issue('cornerRadius', 'must be at most a quarter of the smallest body size');
    if (p.neckOffsetX + shoulderR > p.length / 2 - p.cornerRadius / 2) issue('neckOffsetX', 'the neck must stand on the flat top (too close to the +X end)');
    if (shoulderR > p.width / 2 - p.cornerRadius / 2) issue('neckRadius', 'the neck is too wide for the can');
    const gripFront = (-0.054 + 0.075) * (p.length / REFERENCE_LENGTH);
    if (p.neckOffsetX - shoulderR < gripFront + 0.005) issue('neckOffsetX', 'the neck must clear the handle grip (move it towards +X)');
  }),
  stages: ['empty', 'filled', 'capped'],
  refs: ['neckTop', 'capSeat', 'grasp', 'liquidSurface'],
  features: { cap: { values: ['off', 'on'] } },
  routines: {
    fill: {
      summary: 'Raise the oil level from where it is to `to` (share of the inner height; default: the fill level).',
      args: z.object({ to: z.number().min(0).max(1).optional() }),
    },
  },
  build({ params, materials: shared }) {
    const p = params;
    const m = finishes(shared, p);
    const d = canDimensions(p);
    const size = `${p.length}:${p.width}:${p.height}:${p.cornerRadius}`;
    const neck = `${p.neckRadius}:${p.neckHeight}`;
    const g = {
      body: cached(`body:${size}`, () => roundedBoxGeometry([p.length, p.height, p.width], p.cornerRadius, 4).translate(0, p.height / 2, 0)),
      oil: cached(`oil:${size}`, () => new THREE.BoxGeometry(p.length - OIL_INSET * 2, 1, p.width - OIL_INSET * 2).translate(0, 0.5, 0)),
      foot: cached(`foot:${size}`, () => roundedBoxGeometry([p.length - 0.03, 0.008, p.width - 0.03], 0.003)),
      shoulder: cached(`shoulder:${neck}`, () => new THREE.CylinderGeometry(p.neckRadius + 0.011, p.neckRadius + 0.014, SHOULDER, 28)),
      neck: cached(`neck:${neck}`, () => new THREE.CylinderGeometry(p.neckRadius, p.neckRadius, p.neckHeight, 28)),
      thread: cached(`thread:${neck}`, () => new THREE.TorusGeometry(p.neckRadius + 0.001, 0.0018, 6, 28).rotateX(Math.PI / 2)),
      handlePost: cached(`handlePost:${d.k}`, () => roundedBoxGeometry([0.03 * d.k, 0.05, 0.05], 0.009)),
      handleGrip: cached(`handleGrip:${d.k}`, () => roundedBoxGeometry([d.handle.gripLength, 0.026, 0.038], 0.011)),
      label: cached(`label:${d.label.width}:${d.label.height}`, () => new THREE.PlaneGeometry(d.label.width, d.label.height)),
    };

    const root = group(null, 'JerryCan');
    // Oil first, drawn before the translucent body (render order), scaled to the level.
    const oil = addMesh(root, g.oil, m.oil, 'Oil volume', [0, OIL_BASE, 0], { castShadow: false });
    oil.renderOrder = 1;
    const body = addMesh(root, g.body, m.body, 'Can body');
    body.renderOrder = 2;
    addMesh(root, g.foot, m.solid, 'Base foot', [0, 0.004, 0]);

    // Printed labels on both broad faces; the +X end stays clear as a level window.
    addMesh(root, g.label, m.label, 'Label front', [d.label.x, d.label.y, p.width / 2 + 0.0015], { castShadow: false });
    const back = addMesh(root, g.label, m.label, 'Label back', [d.label.x, d.label.y, -p.width / 2 - 0.0015], { castShadow: false });
    back.rotation.y = Math.PI;

    const neckGroup = group(root, 'Neck', [p.neckOffsetX, 0, 0]);
    addMesh(neckGroup, g.shoulder, m.solid, 'Neck shoulder', [0, p.height + SHOULDER / 2 - 0.002, 0]);
    addMesh(neckGroup, g.neck, m.solid, 'Neck', [0, d.neckBaseY + p.neckHeight / 2, 0]);
    addMesh(neckGroup, g.thread, m.solid, 'Thread 1', [0, d.neckBaseY + p.neckHeight * 0.35, 0]);
    addMesh(neckGroup, g.thread, m.solid, 'Thread 2', [0, d.neckBaseY + p.neckHeight * 0.7, 0]);

    const handle = group(root, 'Handle');
    addMesh(handle, g.handlePost, m.solid, 'Handle post rear', [d.handle.rearX, d.handle.postY, 0]);
    addMesh(handle, g.handlePost, m.solid, 'Handle post front', [d.handle.frontX, d.handle.postY, 0]);
    addMesh(handle, g.handleGrip, m.solid, 'Handle grip', [d.handle.gripX, d.handle.gripY, 0]);

    // The can's own cap (screw caps carry their own small geometry).
    const cap = createScrewCap({ radius: p.capRadius, height: p.capHeight, material: m.cap });
    cap.position.set(p.neckOffsetX, d.capSeatY, 0);
    root.add(cap);

    let level = 0;
    const setLevel = (value) => {
      level = THREE.MathUtils.clamp(value, 0, 1);
      oil.visible = level > 0.001;
      oil.scale.y = Math.max(0.0001, level * d.innerHeight);
    };
    const setCap = (on) => { cap.visible = on; };
    const stages = {
      empty: () => { setLevel(0); setCap(false); },
      filled: () => { setLevel(p.fillLevel); setCap(false); },
      capped: () => { setLevel(p.fillLevel); setCap(true); },
    };

    return {
      root,
      setStage: (stage) => stages[stage](),
      refs: {
        neckTop: () => new THREE.Vector3(p.neckOffsetX, d.neckTopY, 0),
        capSeat: () => new THREE.Vector3(p.neckOffsetX, d.capSeatY, 0),
        grasp: () => new THREE.Vector3(d.handle.gripX, d.handle.gripY, 0),
        // The oil surface under the neck, live: it rises as the can fills (a filling stream ends here).
        liquidSurface: () => new THREE.Vector3(p.neckOffsetX, OIL_BASE + level * d.innerHeight, 0),
      },
      features: { cap: (v) => setCap(v === 'on') },
      routines: {
        fill: ({ to = p.fillLevel } = {}) => {
          let from = 0;
          return {
            start: () => { from = level; },
            update: (progress) => setLevel(from + (to - from) * progress),
            end: () => setLevel(to),
          };
        },
      },
      /** Oil surface height above the base for a level (default: the current one). */
      api: { level: () => level, surfaceY: (value = level) => OIL_BASE + value * d.innerHeight },
      dispose() {
        // Finishes and geometry are shared; only the cap's own geometry is this can's.
        cap.traverse((o) => o.geometry?.dispose());
      },
    };
  },
});
