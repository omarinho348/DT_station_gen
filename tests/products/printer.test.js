// The printer product: stages, refs, parts, determinism, axes, cables, disposal.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { registry } from '../../lib/products/index.js';
import { createMaterials } from '../../lib/core/materials.js';
import { unnamedObjects, nonFiniteMeshes, boundsOf } from '../helpers/componentChecks.js';

const materials = createMaterials();
const build = (serial = 1) => registry.buildProduct('printer', { serial }, { materials });

describe('printer product', () => {
  it('registers with the reference stages, refs and 14 parts', () => {
    const def = registry.getProduct('printer');
    expect(def.stages).toEqual(['empty', 'kitted', 'framed', 'wired', 'tested', 'inspected']);
    expect(def.refs).toEqual(['printerOrigin', 'trayCentre', 'dockPort']);
    expect(def.parts).toHaveLength(14);
  });

  it('builds every stage with all objects named and no NaN', () => {
    const p = build();
    for (const stage of p.stages) {
      p.setStage(stage);
      expect(p.stage).toBe(stage);
      expect(unnamedObjects(p.root)).toEqual([]);
      expect(nonFiniteMeshes(p.root)).toEqual([]);
    }
    expect(() => p.setStage('painted')).toThrow(/no stage "painted"/);
  });
});

const visible = (o) => { for (let n = o; n; n = n.parent) if (!n.visible) return false; return true; };
const visibleNamed = (root, name) => {
  const out = [];
  root.traverse((o) => { if (o.name === name && visible(o)) out.push(o); });
  return out;
};
function visibleBounds(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  root.traverse((o) => { if (o.isMesh && visible(o)) box.union(new THREE.Box3().setFromObject(o, true)); });
  return box;
}

describe('printer product stages', () => {
  it('has nothing floating and nothing below the belt at any stage', async () => {
    const { floatingMeshes } = await import('../helpers/componentChecks.js');
    const p = build();
    for (const stage of p.stages) {
      p.setStage(stage);
      expect(floatingMeshes(p.root), stage).toEqual([]);
      expect(visibleBounds(p.root).min.y, stage).toBeGreaterThanOrEqual(-1e-6);
    }
  });

  it('kits every part in the tray, then installs ST2 and ST3 parts in their assembled poses', () => {
    const p = build();
    const { printer } = p.api;
    p.setStage('empty');
    expect(Object.values(printer.parts).every((part) => part.mode === 'hidden')).toBe(true);
    p.setStage('kitted');
    expect(printer.parts.BaseFrame.mode).toBe('asm');
    expect(printer.parts.Motor_Z.mode).toBe('kit');
    p.setStage('framed');
    for (const name of ['Motor_Z', 'Motor_Y', 'Bed', 'Upright_L', 'Upright_R', 'XGantry', 'LeadScrew', 'TopBar']) expect(printer.parts[name].mode).toBe('asm');
    expect(printer.parts.PSU.mode).toBe('kit');
    expect(visibleNamed(p.root, 'Cap screw head').length).toBe(12); // 6 screwed ST2 parts × 2 (X gantry and lead screw have none)
    p.setStage('wired');
    expect(Object.values(printer.parts).filter((part) => part.mode === 'kit').length).toBe(1); // the emptied harness bag
    expect(printer.cables.every((c) => c.state.mode === 'done')).toBe(true);
    expect(visibleNamed(p.root, 'Cap screw head').length).toBe(20); // + 4 ST3 parts × 2
  });

  it('shows the test print and LCD from tested, and the QC sticker once inspected', () => {
    const p = build();
    p.setStage('wired');
    expect(visibleNamed(p.root, 'Test cube')).toHaveLength(0);
    p.setStage('tested');
    expect(visibleNamed(p.root, 'Test cube')).toHaveLength(1);
    expect(visibleNamed(p.root, 'QC label')).toHaveLength(0);
    p.setStage('inspected');
    expect(visibleNamed(p.root, 'QC label')).toHaveLength(1);
  });

  it('shows no stray cable plugs or coils before the cables are fitted', () => {
    const p = build();
    p.setStage('empty');
    expect(visibleNamed(p.root, 'Connector A Hotend')).toHaveLength(0);
    expect(visibleNamed(p.root, 'Coil Power')).toHaveLength(0);
  });
});

describe('printer product data', () => {
  it('gives quality and verdict deterministically by serial, only once tested / inspected', () => {
    const a = build(7);
    expect(a.api.quality()).toBeNull();
    a.setStage('inspected');
    const b = build(7);
    b.setStage('inspected');
    expect(a.api.quality()).toEqual(b.api.quality());
    // Reference qualityFor(7): flatness 0.04 + (259 % 11) / 100 = 0.10, error 0.02 + (91 % 7) / 100 = 0.02.
    expect(a.api.quality()).toEqual({ flatness: 0.1, dimError: 0.02 });
    const rejects = Array.from({ length: 40 }, (_, i) => i + 1).filter((s) => {
      const u = build(s);
      u.setStage('inspected');
      return u.api.verdict() === 'REJECT';
    });
    expect(rejects.length).toBeGreaterThan(0); // some units fail the 0.12 mm flatness limit
  });

  it('places its refs in the product frame (dock port on the mainboard enclosure rear face)', () => {
    const p = build();
    expect(p.ref('printerOrigin').toArray()).toEqual([-0.31, 0.03, 0]);
    expect(p.ref('trayCentre').toArray()).toEqual([0.29, 0.03, 0]);
    p.setStage('wired');
    p.root.updateMatrixWorld(true);
    const dock = p.root.getObjectByName('Dock port').getWorldPosition(new THREE.Vector3());
    expect(dock.distanceTo(p.ref('dockPort'))).toBeLessThan(0.002);
    expect(() => p.ref('nozzle')).toThrow(/no ref "nozzle"/);
  });

  it('moves the printer axes: bed along Z, head along X, gantry and lead screw with the nozzle', () => {
    const p = build();
    p.setStage('wired');
    const { printer } = p.api;
    const bed0 = printer.parts.Bed.object.position.z;
    const gantry0 = printer.parts.XGantry.object.position.y;
    printer.setAxes({ bed: 0.05, head: 0.08, nozzle: printer.axes.nozzle + 0.008 });
    expect(printer.parts.Bed.object.position.z - bed0).toBeCloseTo(0.05, 9);
    expect(printer.parts.XGantry.object.position.y - gantry0).toBeCloseTo(0.008, 9);
    expect(printer.parts.LeadScrew.object.rotation.y).toBeCloseTo(2 * Math.PI, 9); // T8: one turn per 8 mm
    expect(nonFiniteMeshes(p.root)).toEqual([]);
  });

  it('lays a cable through every routing state without NaN', () => {
    const p = build();
    p.setStage('framed');
    const { printer } = p.api;
    const grip = new THREE.Vector3(0.1, 0.3, 0.1);
    for (const patch of [{ mode: 'carryA', grip }, { mode: 'pluggedA' }, { mode: 'routing', grip, passed: 2 }, { mode: 'done' }]) {
      printer.setCable(0, patch);
      expect(printer.cables[0].mesh.visible).toBe(true);
      expect(nonFiniteMeshes(p.root)).toEqual([]);
    }
  });

  it('hands out free-standing part copies with their grasp point', () => {
    const p = build();
    const copy = p.api.partCopy('Motor_Z');
    expect(copy.name).toBe('Motor_Z');
    expect(copy.userData.grasp.toArray()).toEqual([0, 0.021, 0]);
  });

  it('is identical on every build (deterministic geometry)', () => {
    const sig = () => {
      const p = build(3);
      p.setStage('wired');
      const b = visibleBounds(p.root);
      let count = 0;
      p.root.traverse((o) => { if (o.isMesh) count += 1; });
      return [count, ...b.min.toArray(), ...b.max.toArray()].map((v) => v.toFixed(6)).join(',');
    };
    expect(sig()).toBe(sig());
  });

  it('frees its own geometry and materials but leaves shared ones for other units', () => {
    const a = build();
    const b = build();
    a.setStage('wired');
    b.setStage('wired');
    const sharedRail = b.root.getObjectByName('Centre rail 4040').geometry;
    let disposed = 0;
    sharedRail.addEventListener('dispose', () => { disposed += 1; });
    a.dispose();
    expect(disposed).toBe(0);
    expect(materials.chrome.version >= 0).toBe(true);
    expect(a.root.parent).toBeNull();
  });
});
