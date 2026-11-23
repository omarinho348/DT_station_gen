// Phase 5 palletizing (reference station 3): the procedural palletizer robot, its inverse
// kinematics and reach over a reference-sized pallet pattern.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { registry } from '../../lib/components/index.js';
import { createMaterials } from '../../lib/core/materials.js';
import { palletizerReach } from '../../lib/components/robots/palletizerRobot.js';

const materials = createMaterials();
const ctx = { materials, beltHeight: 0.82 };
const close = (a, b, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);
const worldOf = (o) => { o.updateWorldMatrix(true, false); return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld); };
const centre = (o) => { o.updateWorldMatrix(true, true); return new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()); };
const go = (r, t) => { for (const k of ['x', 'y', 'z', 'yaw']) r.set(k, t[k]); };

// Reference station 3: 0.62 × 0.42 × 0.42 cases, 3 × 3 × 3 with 2 cm gaps on a 0.144 m pallet.
const CASE = { length: 0.62, width: 0.42, height: 0.42 };
const STACK_CENTRE = { x: 0, z: -2.0 };
const cells = () => {
  const out = [];
  for (let layer = 0; layer < 3; layer += 1) for (let row = 0; row < 3; row += 1) for (let col = 0; col < 3; col += 1) {
    out.push({
      x: STACK_CENTRE.x + (col - 1) * (CASE.length + 0.02),
      z: STACK_CENTRE.z + (row - 1) * (CASE.width + 0.02),
      y: 0.144 + (layer + 1) * CASE.height, // the tool point on the case top
    });
  }
  return out;
};

describe('palletizerRobot', () => {
  it('puts the tool point exactly on reachable targets, with the commanded yaw, always level', () => {
    const r = registry.buildComponent('palletizerRobot', {}, ctx);
    const tool = r.anchor('tool');
    const targets = [
      { x: 1.6, y: 1.24, z: 0, yaw: 0 },
      { x: -0.64, y: 0.564, z: -2.44, yaw: Math.PI / 2 },
      { x: 2.0, y: 2.1, z: 1.0, yaw: -0.7 },
      { x: -1.2, y: 0.9, z: 1.5, yaw: 3 },
    ];
    for (const t of targets) {
      go(r, t);
      const at = worldOf(tool);
      close(at.distanceTo(new THREE.Vector3(t.x, t.y, t.z)), 0, 1e-9);
      const q = new THREE.Quaternion();
      tool.getWorldQuaternion(q);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      close(up.y, 1, 1e-9); // level: the tool points straight down
      const forward = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      const yaw = Math.atan2(-forward.z, forward.x);
      close(Math.abs(Math.atan2(Math.sin(yaw - t.yaw), Math.cos(yaw - t.yaw))), 0, 1e-9);
    }
    r.dispose();
  });

  it('keeps its link lengths, and the parallelogram rod parallel to the lower arm', () => {
    const r = registry.buildComponent('palletizerRobot', {}, ctx);
    go(r, { x: 2.2, y: 0.7, z: -0.8, yaw: 0 });
    const shoulder = worldOf(r.root.getObjectByName('Axis 2 joint'));
    const elbow = worldOf(r.root.getObjectByName('Axis 3 joint'));
    close(shoulder.distanceTo(elbow), 1.2, 1e-9);
    close(elbow.distanceTo(worldOf(r.root.getObjectByName('Wrist'))), 1.35, 1e-9);
    const dir = (name) => new THREE.Vector3(1, 0, 0).applyQuaternion(r.root.getObjectByName(name).getWorldQuaternion(new THREE.Quaternion()));
    close(Math.abs(dir('Lower arm').dot(dir('Parallelogram rod'))), 1, 1e-9);
    close(Math.abs(dir('Upper arm').dot(dir('Parallelogram crank'))), 1, 1e-9);
    r.dispose();
  });

  it('clamps a target out of reach instead of failing, and reports reach', () => {
    expect(palletizerReach({}, { x: 1.6, y: 1.24, z: 0 })).toBe(true);
    expect(palletizerReach({}, { x: 3.2, y: 1.0, z: 0 })).toBe(false); // beyond 3.0 m
    expect(palletizerReach({}, { x: 1.5, y: 0.1, z: 0 })).toBe(false); // below the lowest tool height
    const r = registry.buildComponent('palletizerRobot', {}, ctx);
    go(r, { x: 3.0, y: 0.4, z: 0, yaw: 0 });
    const at = worldOf(r.anchor('tool'));
    expect(Number.isFinite(at.x)).toBe(true);
    expect(at.x).toBeLessThan(3.0); // stopped at the limit
    r.dispose();
  });

  it('reaches a reference 3 × 3 × 3 pallet pattern beside it and the pick point, and clears the full stack', () => {
    for (const c of cells()) expect(palletizerReach({}, c), JSON.stringify(c)).toBe(true);
    const stackTop = 0.144 + 3 * CASE.height;
    for (const c of cells().slice(-9)) expect(palletizerReach({}, { ...c, y: stackTop + CASE.height + 0.1 })).toBe(true); // carrying a case over it
    expect(palletizerReach({}, { x: 1.6, y: 0.82 + CASE.height, z: 0 })).toBe(true); // pick from a 0.82 m conveyor
  });

  it('has the tool interface the pick-and-place ops use: x, y, z, yaw, grip (0 off / 1 on), anchor tool', () => {
    const r = registry.buildComponent('palletizerRobot', {}, ctx);
    for (const m of ['x', 'y', 'z', 'yaw', 'grip']) expect(r.motions[m]).toBeDefined();
    expect(r.motions.grip.range).toEqual([0, 1]);
    expect(r.anchors).toEqual(['tool']);
    const lamp = r.root.getObjectByName('Vacuum lamp').material;
    r.set('grip', 1);
    expect(lamp.emissiveIntensity).toBeGreaterThan(0);
    r.set('grip', 0);
    expect(lamp.emissiveIntensity).toBe(0);
    // Turning the tool turns only the flange, not the arm.
    const arm = centre(r.root.getObjectByName('Upper arm'));
    r.set('yaw', 1.2);
    close(centre(r.root.getObjectByName('Upper arm')).distanceTo(arm), 0, 1e-9);
    r.dispose();
  });
});

describe('stretchWrapper', () => {
  const PALLET = { length: 2.06, width: 1.46, height: 0.144 }; // reference: stack + 8 cm overhang
  const STACK = { length: 3 * 0.62 + 2 * 0.02, width: 3 * 0.42 + 2 * 0.02, height: 3 * 0.42 };

  it('spiral film: whole turns, overlapping passes, from the load bottom to its top', async () => {
    const { spiralFilm } = await import('../../lib/components/machines/stretchWrapper.js');
    const f = spiralFilm(0.962, 0.662, 1.26, { bandHeight: 0.32, pitch: 0.176 });
    expect(Number.isInteger(f.totalTurns)).toBe(true);
    close(f.totalLength, f.totalTurns * f.perimeter, 1e-9);
    expect(f.bandBottomAt(0)).toBe(0);
    close(f.bandBottomAt(f.totalLength) + f.bandHeight, 1.26, 1e-9); // the last band reaches the top
    expect(0.176).toBeLessThan(f.bandHeight); // pitch < band: no gaps between passes
    close(f.perimeter, 2 * (2 * 0.962 + 2 * 0.662), 1e-9);
    f.geometry.dispose();
  });

  it('a wrap turns the deck a whole number of turns, the carriage follows the band, the film fills in', () => {
    const w = registry.buildComponent('stretchWrapper', {}, ctx);
    const deck = w.anchor('deck');
    const filmRoot = w.root.getObjectByName('Wrap film');
    const film = w.root.getObjectByName('Film spiral');
    const carriage = w.root.getObjectByName('Film carriage');
    expect(filmRoot.visible).toBe(false);
    const filmBottom = 0.44 + 0.144;
    close(carriage.position.y, filmBottom + 0.32 / 2, 1e-9);
    w.set('wrap', 0.5);
    expect(filmRoot.visible).toBe(true);
    expect(film.geometry.drawRange.count).toBeGreaterThan(0);
    w.set('wrap', 1);
    close(Math.cos(deck.rotation.y), 1, 1e-9); // back where it started
    expect(deck.rotation.y).toBeGreaterThan(2 * Math.PI);
    close(carriage.position.y, filmBottom + 1.26 - 0.32 / 2, 1e-9);
    expect(film.geometry.drawRange.count).toBe(film.geometry.index.count);
    expect(w.root.getObjectByName('Film web').visible).toBe(false); // cut off at the end
    w.dispose();
  });

  it('film fits a reference 3 × 3 × 3 stack on its pallet: 12 mm off the case faces, starting at the pallet top', () => {
    const w = registry.buildComponent('stretchWrapper', {}, ctx);
    w.set('wrap', 1);
    const pos = w.root.getObjectByName('Film spiral').geometry.getAttribute('position');
    let minX = Infinity; let maxX = 0; let maxZ = 0; let minY = Infinity; let maxY = -Infinity;
    for (let i = 0; i < pos.count; i += 1) {
      const x = Math.abs(pos.getX(i)); const zz = Math.abs(pos.getZ(i));
      if (x > STACK.length / 2) minX = Math.min(minX, x);
      maxX = Math.max(maxX, x); maxZ = Math.max(maxZ, zz);
      minY = Math.min(minY, pos.getY(i)); maxY = Math.max(maxY, pos.getY(i));
    }
    close(maxX, STACK.length / 2 + 0.012 + 0.01, 0.01); // + a few mm of layer growth
    expect(maxZ).toBeGreaterThanOrEqual(STACK.width / 2 + 0.012);
    expect(minY).toBe(0); // film root sits on the pallet top
    close(maxY, STACK.height, 1e-6);
    close(w.root.getObjectByName('Wrap film').position.y, PALLET.height, 1e-9);
    w.dispose();
  });

  it('a stacked pallet on the deck turns with it and never reaches the carriage or mast', () => {
    const w = registry.buildComponent('stretchWrapper', { palletLength: PALLET.length, palletWidth: PALLET.width }, ctx);
    const pallet = registry.buildComponent('blockPallet', PALLET, ctx);
    w.anchor('deck').add(pallet.root);
    const load = new THREE.Mesh(new THREE.BoxGeometry(STACK.length, STACK.height, STACK.width));
    load.position.y = PALLET.height + STACK.height / 2;
    w.anchor('deck').add(load);
    const keepOut = ['Film roll body', 'Pre-stretch roller 1', 'Pre-stretch roller 2', 'Carriage plate', 'Mast', 'Roll spindle']
      .map((n) => w.root.getObjectByName(n));
    for (let v = 0; v <= 1.0001; v += 0.01) {
      w.set('wrap', Math.min(v, 1));
      const loadBox = new THREE.Box3().setFromObject(load).union(new THREE.Box3().setFromObject(pallet.root));
      // The load's corners stay inside their sweep circle; every carriage part stays outside it.
      const corner = Math.hypot(PALLET.length, PALLET.width) / 2;
      for (const part of keepOut) {
        part.updateWorldMatrix(true, true);
        const b = new THREE.Box3().setFromObject(part);
        // Distance from the deck axis to the nearest point of the part (in plan).
        const nearest = Math.hypot(Math.max(0, b.min.x, -b.max.x), Math.max(0, b.min.z, -b.max.z));
        expect(nearest, part.name).toBeGreaterThan(corner + 0.05);
      }
      expect(loadBox.max.x).toBeLessThanOrEqual(corner + 1e-9);
    }
    pallet.dispose();
    w.dispose();
  });

  it('the film runs from the roll to its head on the load, on the mast side', () => {
    const w = registry.buildComponent('stretchWrapper', {}, ctx);
    let mastSide = 0;
    let samples = 0;
    for (let v = 0.02; v < 0.98; v += 0.01) {
      w.set('wrap', v);
      const web = w.root.getObjectByName('Film web');
      if (!web.visible) continue;
      samples += 1;
      if (web.position.x > 0) mastSide += 1;
    }
    expect(samples).toBeGreaterThan(80);
    expect(mastSide).toBe(samples); // the web always spans from the mast side
    w.dispose();
  });
});

describe('palletJackWorker', () => {
  const PALLET = { length: 2.06, width: 1.46, height: 0.144 }; // reference station-3 pallet
  const boxesOf = (root) => { const out = []; root.updateMatrixWorld(true); root.traverse((o) => { if (o.isMesh && o.visible) out.push({ name: o.name, box: new THREE.Box3().setFromObject(o) }); }); return out; };
  const clashes = (a, b) => {
    const out = [];
    for (const x of boxesOf(a)) for (const y of boxesOf(b)) if (x.box.intersectsBox(y.box)) out.push(`${x.name} × ${y.name}`);
    return [...new Set(out)];
  };
  const palletAtCargo = (w) => {
    const pallet = registry.buildComponent('blockPallet', PALLET, ctx);
    const at = worldOf(w.anchor('cargo'));
    pallet.root.position.set(at.x, 0, at.z);
    pallet.root.rotation.y = w.root.getObjectByName('Worker and truck').rotation.y;
    return pallet;
  };

  it('lowered forks slide under a reference block pallet centred on the cargo point without touching it', () => {
    const w = registry.buildComponent('palletJackWorker', {}, ctx);
    const pallet = palletAtCargo(w);
    expect(clashes(w.root, pallet.root)).toEqual([]);
    w.dispose();
    pallet.dispose();
  });

  it('raised 10 cm the forks are above the stringer undersides (they lift it); carried at full height it clears a 0.44 m wrapper deck and the truck', () => {
    const w = registry.buildComponent('palletJackWorker', {}, ctx);
    const pallet = palletAtCargo(w);
    const stringerBottom = Math.min(...boxesOf(pallet.root).filter((b) => /Stringer/.test(b.name)).map((b) => b.box.min.y));
    w.set('forks', 0.045 + 0.1);
    const forkTop = Math.max(...boxesOf(w.root).filter((b) => /fork$/.test(b.name)).map((b) => b.box.max.y));
    expect(forkTop).toBeGreaterThan(stringerBottom);
    // Carry it: attached to the cargo anchor where it stands, then to full height.
    w.set('forks', 0.045);
    w.anchor('cargo').attach(pallet.root);
    w.set('forks', 0.6);
    pallet.root.updateWorldMatrix(true, true); // through the lifted forks
    const palletBox = new THREE.Box3().setFromObject(pallet.root);
    expect(palletBox.min.y).toBeGreaterThan(0.44);
    const truckParts = boxesOf(w.root).filter((b) => /Truck body|Tiller|Pump lever|Lift mast|Mast head|Worker|leg|boot|arm|sleeve|hand/.test(b.name));
    expect(truckParts.filter((t) => t.box.intersectsBox(palletBox)).map((t) => t.name)).toEqual([]);
    w.dispose();
  });

  it('drives anywhere in its travel and turns; the cargo anchor (and a load on it) goes along; the legs swing', () => {
    const w = registry.buildComponent('palletJackWorker', {}, ctx);
    w.set('x', 3);
    w.set('z', -2);
    w.set('heading', Math.PI / 2);
    const at = worldOf(w.anchor('cargo'));
    close(at.x, 3, 1e-9); // 0.55 m ahead of the fork roots, now along −Z
    close(at.z, -2 - 0.55, 1e-9);
    w.set('stride', 0.25);
    expect(w.root.getObjectByName('Left hip').rotation.x).toBeCloseTo(0.45, 9);
    expect(w.root.getObjectByName('Right hip').rotation.x).toBeCloseTo(-0.45, 9);
    w.dispose();
  });
});

describe('caseSource', () => {
  it('a reference case passes out through its chute onto a 0.82 m belt, touching nothing', () => {
    const s = registry.buildComponent('caseSource', {}, ctx);
    expect(s.ports.output).toMatchObject({ position: [0.04, 0.82, 0], carries: 'case' });
    const caseBox = new THREE.Box3(new THREE.Vector3(-0.5, 0.82, -0.21), new THREE.Vector3(0.12, 0.82 + 0.42, 0.21)); // half out of the chute
    const parts = [];
    s.root.updateMatrixWorld(true);
    s.root.traverse((o) => { if (o.isMesh && !/Chute interior|Cabinet body|Cabinet inset/.test(o.name)) parts.push(o); });
    expect(parts.filter((m) => new THREE.Box3().setFromObject(m).intersectsBox(caseBox)).map((m) => m.name)).toEqual([]);
    s.dispose();
  });
});
