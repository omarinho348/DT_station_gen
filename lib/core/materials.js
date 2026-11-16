// Shared PBR material library: metals, paints, plastics, guards and indicator lamps.
// Product-specific materials (container plastics, liquids, printed labels) live with their product.
import * as THREE from 'three';
import { beltTexture, wireMeshTexture } from './textures.js';

/**
 * A fresh material set. Create one per line (or per gallery view) and pass it to every
 * component's build(), so all equipment shares materials and textures.
 */
export function createMaterials() {
  const standard = (parameters) => new THREE.MeshStandardMaterial(parameters);
  const materials = {
    // Metals
    stainless: standard({ color: 0xd2d7db, metalness: 0.9, roughness: 0.24 }),
    brushed: standard({ color: 0xaeb6bc, metalness: 0.86, roughness: 0.38 }),
    chrome: standard({ color: 0xe9edf0, metalness: 1, roughness: 0.08 }),
    aluminium: standard({ color: 0xbcc3c8, metalness: 0.78, roughness: 0.34 }),
    // Painted steel
    frame: standard({ color: 0x55616a, metalness: 0.4, roughness: 0.5 }),
    frameDark: standard({ color: 0x2b3136, metalness: 0.45, roughness: 0.48 }),
    motor: standard({ color: 0x4f6475, metalness: 0.45, roughness: 0.42 }),
    safetyYellow: standard({ color: 0xe0a621, metalness: 0.15, roughness: 0.5 }),
    // Machine finishes (from the reference PrinterMaterials.js)
    machineBlue: standard({ color: 0x2c5d8f, metalness: 0.35, roughness: 0.45 }),
    machineGrey: standard({ color: 0xc7ccd0, metalness: 0.3, roughness: 0.5 }),
    machineWhite: standard({ color: 0xe9ecee, metalness: 0.15, roughness: 0.5 }),
    gantryOrange: standard({ color: 0xe0782a, metalness: 0.3, roughness: 0.45 }),
    darkPanel: standard({ color: 0x23282d, metalness: 0.3, roughness: 0.5 }),
    // The slab top sits millimetres above the scene floor and the markings just above the slab,
    // closer than the depth buffer resolves at viewing distance. Polygon offset makes them win
    // the depth test instead of flickering as the camera moves.
    floorLine: standard({ color: 0xd9a21e, metalness: 0, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    floor: standard({ color: 0x59625f, metalness: 0.05, roughness: 0.86, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    // Rubber and plastics
    rubber: standard({ color: 0x1b1d1f, metalness: 0.02, roughness: 0.86 }),
    plasticBlack: standard({ color: 0x202326, metalness: 0.1, roughness: 0.45 }),
    guide: standard({ color: 0xe6e3d8, metalness: 0, roughness: 0.55 }),
    belt: standard({ color: 0xffffff, map: beltTexture(), metalness: 0.02, roughness: 0.82 }),
    beltReturn: standard({ color: 0x1f2326, metalness: 0.02, roughness: 0.85 }),
    hose: standard({ color: 0x23272a, metalness: 0.1, roughness: 0.6 }),
    airLine: standard({ color: 0x2a78c4, metalness: 0.05, roughness: 0.45 }),
    // Glazing and guarding
    guard: new THREE.MeshPhysicalMaterial({
      color: 0xd9eef5,
      metalness: 0,
      roughness: 0.06,
      transparent: true,
      opacity: 0.1,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    sightGlass: new THREE.MeshPhysicalMaterial({
      color: 0xeaf6fa,
      metalness: 0,
      roughness: 0.05,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    }),
    lens: standard({ color: 0x0d1418, metalness: 0.2, roughness: 0.1 }),
    fence: standard({
      color: 0xffffff,
      map: wireMeshTexture(),
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      metalness: 0.6,
      roughness: 0.4,
    }),
    // Controls
    emergency: standard({ color: 0xc8231d, metalness: 0.1, roughness: 0.35 }),
    buttonGreen: standard({ color: 0x2f9a4a, metalness: 0.1, roughness: 0.35 }),
  };
  for (const [key, material] of Object.entries(materials)) material.name = key;
  return materials;
}

/** Frees the GPU resources of a material set made by createMaterials(). */
export function disposeMaterials(materials) {
  for (const material of Object.values(materials)) {
    material.map?.dispose();
    material.dispose();
  }
}

/** Indicator lamp material with its own emissive state. One per lamp; starts off. */
export function createLampMaterial(color) {
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0,
    metalness: 0.05,
    roughness: 0.3,
    transparent: true,
    opacity: 0.92,
  });
  material.name = 'lamp';
  material.userData.baseColor = new THREE.Color(color);
  setLamp(material, false);
  return material;
}

export function setLamp(material, on, intensity = 1.6) {
  material.emissiveIntensity = on ? intensity : 0;
  material.color.copy(material.userData.baseColor).multiplyScalar(on ? 1 : 0.35);
  material.userData.on = Boolean(on);
}
