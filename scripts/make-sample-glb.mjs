#!/usr/bin/env node
// Writes lib/assets/sampleCrate.glb: a small sample product model (a plastic crate with a lid and
// two grip slots) for the GLB product (lib/products/model, Phase 6 step 7) and its tests, so the
// import path is exercised without a user's file. No dependencies: three.js builds the geometry,
// the glTF 2.0 binary (JSON chunk + BIN chunk) is written by hand.
//
//   node scripts/make-sample-glb.mjs
//
// Model frame: metres, Y up, origin at the middle of the base, 0.40 × 0.25 × 0.30 m (L × H × W).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

const out = fileURLToPath(new URL('../lib/assets/sampleCrate.glb', import.meta.url));

// Parts: [name, geometry, colour (linear RGB), roughness]
const L = 0.4; const H = 0.25; const W = 0.3;
const parts = [
  ['Crate body', new THREE.BoxGeometry(L, H - 0.02, W).translate(0, (H - 0.02) / 2, 0), [0.05, 0.22, 0.45], 0.7],
  ['Crate lid', new THREE.BoxGeometry(L + 0.01, 0.02, W + 0.01).translate(0, H - 0.01, 0), [0.03, 0.12, 0.28], 0.6],
  ['Grip slot left', new THREE.BoxGeometry(0.004, 0.035, 0.12).translate(-L / 2 - 0.002, H * 0.72, 0), [0.01, 0.01, 0.01], 0.9],
  ['Grip slot right', new THREE.BoxGeometry(0.004, 0.035, 0.12).translate(L / 2 + 0.002, H * 0.72, 0), [0.01, 0.01, 0.01], 0.9],
];

const chunks = [];
let offset = 0;
const bufferViews = [];
const accessors = [];
const push = (typed, target, accessor) => {
  const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
  const padded = new Uint8Array(Math.ceil(bytes.length / 4) * 4);
  padded.set(bytes);
  bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
  chunks.push(padded);
  offset += padded.length;
  accessors.push({ bufferView: bufferViews.length - 1, ...accessor });
  return accessors.length - 1;
};

const meshes = [];
const materials = [];
const nodes = [];
for (const [name, geometry, color, roughness] of parts) {
  const pos = geometry.getAttribute('position');
  const nor = geometry.getAttribute('normal');
  const idx = geometry.getIndex();
  geometry.computeBoundingBox();
  const { min, max } = geometry.boundingBox;
  const position = push(new Float32Array(pos.array), 34962, { componentType: 5126, count: pos.count, type: 'VEC3', min: min.toArray(), max: max.toArray() });
  const normal = push(new Float32Array(nor.array), 34962, { componentType: 5126, count: nor.count, type: 'VEC3' });
  const indices = push(new Uint16Array(idx.array), 34963, { componentType: 5123, count: idx.count, type: 'SCALAR' });
  materials.push({ name: `${name} material`, pbrMetallicRoughness: { baseColorFactor: [...color, 1], metallicFactor: 0, roughnessFactor: roughness } });
  meshes.push({ name, primitives: [{ attributes: { POSITION: position, NORMAL: normal }, indices, material: materials.length - 1 }] });
  nodes.push({ name, mesh: meshes.length - 1 });
}

const bin = new Uint8Array(offset);
let at = 0;
for (const c of chunks) { bin.set(c, at); at += c.length; }
const json = {
  asset: { version: '2.0', generator: 'DT_station_gen scripts/make-sample-glb.mjs' },
  scene: 0,
  scenes: [{ name: 'Sample crate', nodes: [nodes.length] }],
  nodes: [...nodes, { name: 'Sample crate', children: nodes.map((_, i) => i) }],
  meshes,
  materials,
  accessors,
  bufferViews,
  buffers: [{ byteLength: bin.length }],
};
let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
const jsonPad = Math.ceil(jsonBytes.length / 4) * 4;
const jsonChunk = new Uint8Array(jsonPad).fill(0x20);
jsonChunk.set(jsonBytes);
jsonBytes = jsonChunk;

const total = 12 + 8 + jsonBytes.length + 8 + bin.length;
const glb = new DataView(new ArrayBuffer(total));
let p = 0;
const u32 = (v) => { glb.setUint32(p, v, true); p += 4; };
u32(0x46546c67); u32(2); u32(total); // 'glTF', version 2
u32(jsonBytes.length); u32(0x4e4f534a); // JSON
new Uint8Array(glb.buffer, p, jsonBytes.length).set(jsonBytes); p += jsonBytes.length;
u32(bin.length); u32(0x004e4942); // BIN
new Uint8Array(glb.buffer, p, bin.length).set(bin);
writeFileSync(out, new Uint8Array(glb.buffer));
console.log(`written ${out} (${total} bytes, ${parts.length} meshes)`);
