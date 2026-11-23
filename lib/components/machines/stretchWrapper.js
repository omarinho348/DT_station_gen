// Turntable stretch wrapper: a load (a stacked pallet) stands on a turning deck while a film
// carriage rides up a mast and lays stretch film around it in an overlapping spiral. Procedural:
// the reference station 3 loaded its frame from Wrapping.STEP (left out, owner's decision); the
// spiral film is a port of its createSpiralFilm / rectPerimeterLoop (AssetWrapMachine.js).
//
// Origin: deck centre on the floor; the mast stands on +X. Motion `wrap` 0 → 1 plays a whole wrap:
// the deck turns (a whole number of turns, so the load ends facing the way it came), the carriage
// follows the film band up the mast, the film roll pays out and the film grows to its head. The
// film and anything attached to the `deck` anchor turn with the deck.
import * as THREE from 'three';
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, addMesh, box, cylinder, roundedBox } from '../../core/primitives.js';
import { buildRoofBeacon, BEACON_MOTION } from './portalCommon.js';

const CLEARANCE = 0.012; // film off the load faces
const MAST = 0.2;
const ROLL_RADIUS = 0.07;
const BASE_TURNS = 1.5;
const MIN_TOP_TURNS = 1.5;
const CONTROL_TOP = 0.62; // control box top, where its beacon stands
const BEACON_TOP = CONTROL_TOP + 0.41;

/** One closed loop around a rectangle (XZ), corners exact; arc length and outward offset per sample. */
function rectPerimeterLoop(halfX, halfZ, maxSpacing = 0.05) {
  const sides = [
    { from: [halfX, -halfZ], to: [halfX, halfZ], normal: [1, 0] },
    { from: [halfX, halfZ], to: [-halfX, halfZ], normal: [0, 1] },
    { from: [-halfX, halfZ], to: [-halfX, -halfZ], normal: [-1, 0] },
    { from: [-halfX, -halfZ], to: [halfX, -halfZ], normal: [0, -1] },
  ];
  const samples = [];
  let s = 0;
  sides.forEach((side, index) => {
    const previous = sides[(index + 3) % 4];
    const length = Math.hypot(side.to[0] - side.from[0], side.to[1] - side.from[1]);
    const steps = Math.max(1, Math.ceil(length / maxSpacing));
    for (let i = 0; i < steps; i += 1) {
      const t = i / steps;
      const corner = i === 0;
      samples.push({
        x: THREE.MathUtils.lerp(side.from[0], side.to[0], t),
        z: THREE.MathUtils.lerp(side.from[1], side.to[1], t),
        s: s + t * length,
        ox: corner ? side.normal[0] + previous.normal[0] : side.normal[0],
        oz: corner ? side.normal[1] + previous.normal[1] : side.normal[1],
      });
    }
    s += length;
  });
  return { samples, perimeter: s };
}

/**
 * Film ribbon spiralling around the load: base turns at the bottom, a constant-pitch rise (pitch <
 * band height, so passes overlap), top turns at the top. Vertices follow the path, so the wrap is
 * revealed with a draw range. Unlike the reference, the turn count is rounded up to a whole number
 * (extra top turns), so the deck stops where it started.
 */
export function spiralFilm(halfX, halfZ, height, { bandHeight, pitch, layerGrowth = 0.001 }) {
  const { samples, perimeter } = rectPerimeterLoop(halfX, halfZ);
  const riseHeight = Math.max(0, height - bandHeight);
  const riseTurns = riseHeight / pitch;
  const totalTurns = Math.ceil(BASE_TURNS + riseTurns + MIN_TOP_TURNS);
  const totalLength = totalTurns * perimeter;
  const bandBottomAt = (s) => {
    const turn = s / perimeter;
    return turn <= BASE_TURNS ? 0 : Math.min(riseHeight, (turn - BASE_TURNS) * pitch);
  };
  // Whole turns: the path is the loop repeated, closed back at its first sample.
  const path = [];
  for (let loop = 0; loop < totalTurns; loop += 1) for (const sample of samples) path.push({ ...sample, s: loop * perimeter + sample.s });
  path.push({ ...samples[0], s: totalLength });

  const positions = new Float32Array(path.length * 6);
  const normals = new Float32Array(path.length * 6);
  const indices = [];
  path.forEach((point, index) => {
    const grow = (point.s / perimeter) * layerGrowth;
    const x = point.x + point.ox * grow;
    const zz = point.z + point.oz * grow;
    const bottom = bandBottomAt(point.s);
    const n = Math.hypot(point.ox, point.oz) || 1;
    positions.set([x, bottom, zz, x, bottom + bandHeight, zz], index * 6);
    normals.set([point.ox / n, 0, point.oz / n, point.ox / n, 0, point.oz / n], index * 6);
    if (index > 0) {
      const a = (index - 1) * 2;
      const b = index * 2;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.setDrawRange(0, 0);
  return { geometry, path, perimeter, totalLength, totalTurns, riseHeight, bandHeight, bandBottomAt };
}

const layoutOf = (p) => {
  const halfX = p.loadLength / 2 + CLEARANCE;
  const halfZ = p.loadWidth / 2 + CLEARANCE;
  const sweep = Math.max(p.deckRadius, Math.hypot(halfX, halfZ) + 0.02, Math.hypot(p.palletLength, p.palletWidth) / 2 + 0.02);
  const filmBottom = p.deckHeight + p.loadBottom;
  const bandHeight = Math.min(0.32, p.loadHeight / 3);
  // Film roll (the carriage part nearest the load) 6 cm outside the circle the load's corners sweep.
  const mastX = sweep + MAST / 2 + 0.12 + 2 * ROLL_RADIUS + 0.06;
  const mastTop = filmBottom + p.loadHeight + 0.45;
  return { halfX, halfZ, sweep, filmBottom, bandHeight, mastX, mastTop };
};

defineComponent({
  type: 'stretchWrapper',
  category: 'machine',
  summary: 'Turntable stretch wrapper: the load turns on a deck while a film carriage rides up a mast and spirals stretch film around it.',
  params: z.object({
    deckRadius: z.number().min(0.6).max(1.5).default(0.9).describe('Turntable radius (m)'),
    deckHeight: z.number().min(0.08).max(0.6).default(0.44).describe('Deck top above the floor (m)'),
    loadLength: z.number().min(0.4).max(2.4).default(1.9).describe('Load (stack) length along X (m)'),
    loadWidth: z.number().min(0.4).max(1.8).default(1.3).describe('Load width along Z (m)'),
    loadHeight: z.number().min(0.3).max(2.4).default(1.26).describe('Load height to wrap (m)'),
    loadBottom: z.number().min(0).max(0.3).default(0.144).describe('Where the film starts above the deck: the pallet height (m)'),
    palletLength: z.number().min(0.6).max(2.6).default(2.06).describe('Pallet length, for the sweep clearance (m)'),
    palletWidth: z.number().min(0.6).max(2.0).default(1.46).describe('Pallet width, for the sweep clearance (m)'),
  }),
  footprint: (p) => {
    const l = layoutOf(p);
    return { x: [-l.sweep, l.mastX + MAST / 2 + 0.12], z: [-l.sweep, l.sweep], height: Math.max(l.mastTop + 0.06, BEACON_TOP) };
  },
  mount: 'floor',
  ports: (p) => ({ deck: { position: [0, p.deckHeight, 0], direction: 'work', carries: 'pallet' } }),
  anchors: ['deck'],
  motions: { wrap: { range: [0, 1] }, beacon: BEACON_MOTION },
  ops: [],
  build({ params: p, materials }) {
    const l = layoutOf(p);
    const root = group(null, 'stretchWrapper');

    // Base drum and the turning deck with index stripes.
    cylinder(root, p.deckRadius - 0.05, p.deckHeight - 0.05, [0, (p.deckHeight - 0.05) / 2, 0], materials.frame, 'Turntable base', { segments: 48 });
    const deck = group(root, 'Deck', [0, p.deckHeight, 0]);
    cylinder(deck, p.deckRadius, 0.05, [0, -0.025, 0], materials.machineGrey, 'Turntable deck', { segments: 64 });
    [-1, 1].forEach((side) => box(deck, [p.deckRadius * 0.9, 0.004, 0.05], [side * p.deckRadius * 0.5, 0.002, 0], materials.safetyYellow, 'Deck index stripe'));

    // Arm on the floor to the mast, mast, top cap, control box with beacon.
    roundedBox(root, [l.mastX - p.deckRadius + 0.1, 0.12, 0.3], [(p.deckRadius - 0.1 + l.mastX) / 2, 0.06, 0], materials.frame, 'Mast arm', 0.01);
    roundedBox(root, [MAST, l.mastTop - 0.12, MAST], [l.mastX, 0.12 + (l.mastTop - 0.12) / 2, 0], materials.machineWhite, 'Mast', 0.02);
    roundedBox(root, [MAST + 0.06, 0.06, MAST + 0.06], [l.mastX, l.mastTop + 0.03, 0], materials.frameDark, 'Mast cap', 0.01);
    roundedBox(root, [0.24, 0.5, 0.18], [l.mastX, 0.37, MAST / 2 + 0.09], materials.frameDark, 'Control box', 0.02);
    const setBeacon = buildRoofBeacon(root, materials, [l.mastX, CONTROL_TOP, MAST / 2 + 0.09]);

    // Film carriage: rides the mast's load side; film roll and pre-stretch rollers.
    const carriage = group(root, 'Film carriage', [l.mastX, 0, 0]);
    const carriageHeight = l.bandHeight + 0.14;
    roundedBox(carriage, [0.12, carriageHeight, MAST + 0.12], [-MAST / 2 - 0.06, 0, 0], materials.gantryOrange, 'Carriage plate', 0.01);
    const rollX = -MAST / 2 - 0.12 - ROLL_RADIUS;
    cylinder(carriage, 0.012, carriageHeight - 0.02, [rollX, 0, 0.05], materials.chrome, 'Roll spindle', { segments: 10 });
    const filmColor = new THREE.MeshStandardMaterial({ color: 0xd8eef8, metalness: 0.02, roughness: 0.28, transparent: true, opacity: 0.8 });
    filmColor.name = 'film roll';
    const roll = group(carriage, 'Film roll', [rollX, 0, 0.05]);
    cylinder(roll, ROLL_RADIUS, l.bandHeight, [0, 0, 0], filmColor, 'Film roll body', { segments: 24 });
    box(roll, [0.02, l.bandHeight * 0.9, 0.01], [ROLL_RADIUS, 0, 0], materials.guide, 'Roll seam');
    [-0.05, 0.05].forEach((zz, i) => cylinder(carriage, 0.03, l.bandHeight, [-MAST / 2 - 0.1, 0, zz - 0.05], materials.rubber, `Pre-stretch roller ${i + 1}`, { segments: 16 }));
    // Bracket from the carriage plate to the roll spindle and rollers.
    box(carriage, [0.12, 0.03, 0.2], [rollX + 0.06, carriageHeight / 2 - 0.015, 0.0], materials.gantryOrange, 'Roll bracket');

    // Film, in the deck frame (it turns with the load).
    const film = spiralFilm(l.halfX, l.halfZ, p.loadHeight, { bandHeight: l.bandHeight, pitch: l.bandHeight * 0.55 });
    const filmMaterial = new THREE.MeshStandardMaterial({ color: 0xd8eef8, metalness: 0.02, roughness: 0.28, transparent: true, opacity: 0.34, side: THREE.DoubleSide, depthWrite: false });
    filmMaterial.name = 'stretch film';
    const filmRoot = group(deck, 'Wrap film', [0, p.loadBottom, 0]);
    const filmMesh = addMesh(filmRoot, film.geometry, filmMaterial, 'Film spiral', [0, 0, 0], { castShadow: false });
    filmMesh.frustumCulled = false;
    filmMesh.renderOrder = 2;
    filmMesh.userData.restsOnLoad = true; // lies on the load, not on the machine (see componentChecks)
    const positions = film.geometry.getAttribute('position');
    const resting = positions.array.slice();
    let headIndex = -1;
    const restoreHead = () => {
      if (headIndex < 0) return;
      positions.array.set(resting.subarray(headIndex * 6, headIndex * 6 + 6), headIndex * 6);
      positions.needsUpdate = true;
      headIndex = -1;
    };
    /** Film laid up to arc length s: the last vertex pair moved to the exact head. Returns the head (deck frame). */
    const placeHead = (s) => {
      restoreHead();
      const { path } = film;
      if (s <= 0) { film.geometry.setDrawRange(0, 0); return null; }
      if (s >= film.totalLength) { film.geometry.setDrawRange(0, (path.length - 1) * 6); return null; }
      let lo = 0;
      let hi = path.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (path[mid].s <= s) lo = mid; else hi = mid;
      }
      const t = (s - path[lo].s) / Math.max(path[hi].s - path[lo].s, 1e-9);
      const x = THREE.MathUtils.lerp(positions.getX(lo * 2), positions.getX(hi * 2), t);
      const zz = THREE.MathUtils.lerp(positions.getZ(lo * 2), positions.getZ(hi * 2), t);
      const bottom = film.bandBottomAt(s);
      headIndex = hi;
      positions.setXYZ(hi * 2, x, bottom, zz);
      positions.setXYZ(hi * 2 + 1, x, bottom + l.bandHeight, zz);
      positions.needsUpdate = true;
      film.geometry.setDrawRange(0, hi * 6);
      return new THREE.Vector3(x, p.loadBottom + bottom, zz);
    };

    // Film web from the roll to the head on the load (machine frame).
    const web = addMesh(root, new THREE.PlaneGeometry(1, 1), filmMaterial, 'Film web', [0, 0, 0], { castShadow: false });
    web.userData.restsOnLoad = true;
    web.visible = false;
    web.position.set(l.mastX + rollX, l.filmBottom, 0.05);
    web.scale.setScalar(1e-3); // until the first wrap step places it
    const setWeb = (head) => {
      web.visible = Boolean(head);
      if (!head) return;
      const from = new THREE.Vector3(l.mastX + rollX, carriage.position.y, 0.05 + ROLL_RADIUS);
      const to = head.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), deck.rotation.y).add(new THREE.Vector3(0, p.deckHeight + l.bandHeight / 2, 0));
      const d = to.clone().sub(from);
      web.position.copy(from).add(to).multiplyScalar(0.5);
      web.rotation.set(0, Math.atan2(-d.z, d.x), 0);
      web.scale.set(Math.hypot(d.x, d.z), l.bandHeight, 1);
    };

    const carriageY = (s) => l.filmBottom + film.bandBottomAt(s) + l.bandHeight / 2;
    const wrap = (v) => {
      const s = v * film.totalLength;
      deck.rotation.y = (s / film.perimeter) * Math.PI * 2;
      carriage.position.y = carriageY(s);
      roll.rotation.y = -(s / ROLL_RADIUS) * 0.05; // pays out (scaled: the film is pre-stretched)
      filmRoot.visible = v > 0;
      setWeb(placeHead(s));
    };

    return {
      root,
      anchors: { deck },
      motions: { wrap, beacon: setBeacon },
    };
  },
});
