// Work carrier (the pallet the printer rides on through the line) and the kit tray with its foam
// insert. Ported from the reference PrinterModel.js (createCarrier, createKitTray). Carrier
// frame: origin under the plate centre (on the belts), +X = flow.
import * as THREE from 'three';
import { addMesh, box, cylinder, group, roundedBoxGeometry } from '../../core/primitives.js';
import { canvasTexture, seededRandom, textLabel } from '../../core/textures.js';
import { CARRIER, TRAY, serialLabel } from './definition.js';
import { PART_NUMBERS, TRAY_OFFSET, cached, partPose } from './parts.js';

export function createCarrier(materials, serial) {
  const { length, width, thickness } = CARRIER;
  const root = group(null, 'WorkCarrier');
  addMesh(root, cached(`carrierPlate:${length}`, () => roundedBoxGeometry([length, thickness, width], 0.006)), materials.carrierPlate, 'Carrier plate', [0, thickness / 2, 0]);
  [-1, 1].forEach((side) => box(root, [length - 0.02, 0.008, 0.03], [0, 0.004, side * CARRIER.strandZ], materials.frameDark, 'Wear strip'));
  [-1, 1].forEach((sx) => [-1, 1].forEach((sz) => {
    cylinder(root, 0.016, 0.004, [sx * (length / 2 - 0.05), thickness + 0.002, sz * (width / 2 - 0.05)], materials.chrome, 'Locating bushing', { segments: 16 });
    // Frame locators: the base frame's feet sit in these.
    box(root, [0.044, 0.008, 0.044], [CARRIER.buildX + sx * 0.16, thickness + 0.004, sz * 0.18], materials.printedBlack, 'Frame locator');
  }));
  box(root, [0.06, 0.02, 0.006], [0.45, thickness / 2, width / 2 + 0.003], materials.carrierTag, 'RFID tag');
  const plate = textLabel({ width: 256, height: 64, background: '#f4f5f6', color: '#1b1d1f', lines: [{ text: serialLabel(serial), size: 40, y: 0.55 }] });
  const plateMaterial = new THREE.MeshStandardMaterial({ map: plate, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  plateMaterial.name = 'serial plate';
  addMesh(root, new THREE.PlaneGeometry(0.1, 0.022), plateMaterial, 'Serial plate', [0.28, thickness / 2, width / 2 + 0.0015], { castShadow: false });
  return root;
}

/** Foam insert texture: a darker cut-out and a part number per kit part (one, shared). */
let foamTexture = null;
function kitFoamTexture() {
  if (foamTexture) return foamTexture;
  const { length, width } = TRAY;
  const scale = 1024 / length;
  foamTexture = canvasTexture(1024, Math.round(width * scale), (context, w, h) => {
    context.fillStyle = '#2b2e33';
    context.fillRect(0, 0, w, h);
    // Seeded speckle (rule 5; the reference used an unseeded random, so the foam changed every load).
    const random = seededRandom(1101);
    for (let index = 0; index < 4000; index += 1) {
      const value = Math.round(36 + random() * 16);
      context.fillStyle = `rgb(${value},${value},${value + 3})`;
      context.fillRect(random() * w, random() * h, 2, 2);
    }
    const footprints = {
      Upright_L: [0.08, 0.42], Upright_R: [0.08, 0.42], TopBar: [0.03, 0.38], LeadScrew: [0.014, 0.35], XGantry: [0.1, 0.44],
      Bed: [0.245, 0.245], Motor_Z: [0.07, 0.056], Motor_Y: [0.088, 0.05], PrintHead: [0.05, 0.04], ElectronicsBox: [0.165, 0.085],
      PSU: [0.205, 0.105], Display: [0.105, 0.028], Harness: [0.065, 0.06],
    };
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    Object.entries(footprints).forEach(([name, [fw, fd]]) => {
      const center = partPose(name, 'kit').at.sub(TRAY_OFFSET);
      const cx = (center.x + length / 2) * scale;
      const cy = (center.z + width / 2) * scale;
      context.fillStyle = '#16181b';
      context.fillRect(cx - (fw * scale) / 2, cy - (fd * scale) / 2, fw * scale, fd * scale);
      context.strokeStyle = '#4a4f56';
      context.lineWidth = 3;
      context.strokeRect(cx - (fw * scale) / 2, cy - (fd * scale) / 2, fw * scale, fd * scale);
      context.fillStyle = '#d9a81e';
      context.font = 'bold 18px Arial, sans-serif';
      context.fillText(PART_NUMBERS[name], cx, cy + (fd * scale) / 2 + 12);
    });
  }, { fallback: [43, 46, 51, 255] });
  foamTexture.anisotropy = 8;
  return foamTexture;
}

let foamMaterial = null;
export function createKitTray(materials) {
  const { length, width, height, floor } = TRAY;
  const root = group(null, 'KitTray');
  box(root, [length, floor - 0.004, width], [0, (floor - 0.004) / 2, 0], materials.trayBlue, 'Tray floor');
  // One foam material for every tray (the reference made a new one per tray).
  foamMaterial ||= Object.assign(new THREE.MeshStandardMaterial({ map: kitFoamTexture(), roughness: 0.95 }), { name: 'kit foam' });
  box(root, [length - 0.012, 0.004, width - 0.012], [0, floor - 0.002, 0], foamMaterial, 'Kit foam (part cut-outs)');
  [-1, 1].forEach((side) => {
    box(root, [length, height, 0.006], [0, height / 2, side * (width / 2 - 0.003)], materials.trayBlue, 'Tray wall');
    box(root, [0.006, height, width - 0.012], [side * (length / 2 - 0.003), height / 2, 0], materials.trayBlue, 'Tray wall');
  });
  return root;
}

/** Materials made per unit by the carrier / printer, to free on dispose (shared ones excluded). */
export const SHARED_PRODUCT_MATERIALS = () => (foamMaterial ? [foamMaterial] : []);
