// The printer product's own finishes (from the reference PrinterMaterials.js), on top of the
// shared library. One set per shared library (so per line / gallery view), never per unit;
// the few that glow or change per printer are cloned by the printer itself.
import * as THREE from 'three';
import { canvasTexture } from '../../core/textures.js';

const standard = (parameters) => new THREE.MeshStandardMaterial(parameters);
const sets = new WeakMap();

function threadTexture() {
  const texture = canvasTexture(16, 64, (context, width, height) => {
    context.fillStyle = '#d9dde0';
    context.fillRect(0, 0, width, height);
    context.fillStyle = '#7d848a';
    for (let y = 0; y < height; y += 8) context.fillRect(0, y, width, 3);
  }, { fallback: [190, 195, 199, 255] });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 20);
  return texture;
}

function perforatedTexture() {
  return canvasTexture(128, 128, (context, width, height) => {
    context.fillStyle = '#b9c0c5';
    context.fillRect(0, 0, width, height);
    context.fillStyle = '#41484d';
    for (let y = 8; y < height; y += 16) {
      for (let x = (y / 16) % 2 ? 16 : 8; x < width; x += 16) {
        context.beginPath();
        context.arc(x, y, 3.4, 0, Math.PI * 2);
        context.fill();
      }
    }
  }, { fallback: [150, 157, 162, 255] });
}

/** The shared library plus the printer's finishes (cached per shared library). */
export function printerMaterials(shared) {
  if (sets.has(shared)) return sets.get(shared);
  const own = {
    carrierPlate: standard({ color: 0x9aa3a9, metalness: 0.75, roughness: 0.35 }),
    carrierTag: standard({ color: 0xf2c21b, metalness: 0.1, roughness: 0.4 }),
    trayBlue: standard({ color: 0x2d62ad, metalness: 0.05, roughness: 0.55 }),
    extrusion: standard({ color: 0x1f2328, metalness: 0.65, roughness: 0.38 }),
    printedOrange: standard({ color: 0xe8661c, metalness: 0.02, roughness: 0.55 }),
    printedBlack: standard({ color: 0x26292d, metalness: 0.02, roughness: 0.6 }),
    rod: standard({ color: 0xdfe4e8, metalness: 1, roughness: 0.12 }),
    motorBody: standard({ color: 0x2f3439, metalness: 0.6, roughness: 0.35 }),
    motorCap: standard({ color: 0x8f989e, metalness: 0.85, roughness: 0.3 }),
    bedSheet: standard({ color: 0xb98b3c, metalness: 0.55, roughness: 0.42 }),
    psu: standard({ color: 0xffffff, map: perforatedTexture(), metalness: 0.7, roughness: 0.4 }),
    displayBezel: standard({ color: 0x18191b, metalness: 0.1, roughness: 0.5 }),
    screenOff: standard({ color: 0x0a0c0e, metalness: 0.2, roughness: 0.2 }),
    brass: standard({ color: 0xc9a43c, metalness: 0.9, roughness: 0.25 }),
    leadScrew: standard({ color: 0xffffff, map: threadTexture(), metalness: 0.9, roughness: 0.3 }),
    spring: standard({ color: 0xe0b21d, metalness: 0.7, roughness: 0.35 }),
    bag: new THREE.MeshPhysicalMaterial({ color: 0xeaf2f5, roughness: 0.3, transparent: true, opacity: 0.35, depthWrite: false }),
    filament: standard({ color: 0xe8661c, metalness: 0, roughness: 0.42 }),
  };
  for (const [key, material] of Object.entries(own)) material.name = `printer ${key}`;
  const set = {
    ...shared,
    ...own,
    cable: { black: shared.cableBlack, red: shared.cableRed, blue: shared.cableBlue, yellow: shared.cableYellow, white: shared.cableWhite },
    /** Materials owned by this set (disposePrinterMaterials frees them; shared ones stay). */
    own,
  };
  sets.set(shared, set);
  return set;
}

/** Frees the printer finishes made for a shared library. */
export function disposePrinterMaterials(shared) {
  const set = sets.get(shared);
  if (!set) return;
  for (const material of Object.values(set.own)) {
    material.map?.dispose();
    material.dispose();
  }
  sets.delete(shared);
}
