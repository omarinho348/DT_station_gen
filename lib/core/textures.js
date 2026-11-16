// Procedural canvas textures. Randomness here is seeded, so every load and every golden
// screenshot gets the same pixels (unseeded randomness is not allowed anywhere in lib/).
import * as THREE from 'three';

/** Deterministic PRNG (mulberry32): returns a function giving numbers in [0, 1). */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Canvas-drawn texture. Headless (Node, no DOM) there is no canvas, so a 1×1 texture of the
 * `fallback` colour [r, g, b, a] (0–255) is returned instead: components still build and can be measured.
 */
export function canvasTexture(width, height, draw, { fallback = [128, 128, 128, 255] } = {}) {
  let texture;
  if (typeof document === 'undefined') {
    texture = new THREE.DataTexture(new Uint8Array(fallback), 1, 1);
    texture.needsUpdate = true;
    texture.userData.headless = true;
  } else {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    draw(canvas.getContext('2d'), width, height);
    texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = 4;
  }
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Dark rubber belt: fine speckle plus splice lines that make belt motion readable. */
export function drawBelt(context, width, height, seed = 1) {
  const random = seededRandom(seed);
  context.fillStyle = '#25292c';
  context.fillRect(0, 0, width, height);
  for (let index = 0; index < 1100; index += 1) {
    const value = Math.round(32 + random() * 16);
    context.fillStyle = `rgb(${value},${value + 2},${value + 4})`;
    context.fillRect(Math.floor(random() * width), Math.floor(random() * height), 2, 1);
  }
  context.fillStyle = '#3a4045';
  for (let x = 0; x < width; x += 64) context.fillRect(x, 0, 3, height);
}

export function beltTexture() {
  const texture = canvasTexture(256, 64, drawBelt, { fallback: [37, 41, 44, 255] });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/** Welded wire mesh on a transparent background (use with alphaTest). */
export function drawWireMesh(context, width, height) {
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#c9ced1';
  for (let offset = 0; offset < width; offset += 16) {
    context.fillRect(offset, 0, 3, height);
    context.fillRect(0, offset, width, 3);
  }
}

export function wireMeshTexture() {
  const texture = canvasTexture(128, 128, drawWireMesh, { fallback: [201, 206, 209, 255] });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}
