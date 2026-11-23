// Model assets (GLB files in lib/assets/) for the few components built from a model instead of
// procedurally (the optional ABB robot). Component build() is synchronous, so assets are loaded
// beforehand and cached: a component lists them (`assets: ['robot.glb']`), the app / tests
// call preloadComponentAssets() before building, and build() takes a clone with instantiate().
//
// Works in the browser (fetch) and in Node (file read), so tests use the real model. Clones share
// the cached geometry and materials; they are marked userData.shared, so disposing one instance
// never frees what the others use.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const cache = new Map(); // name → Promise<gltf> (loading) and then the gltf
const loaded = new Map(); // name → gltf

/** URL of an asset file in lib/assets/. */
export const assetUrl = (name) => new URL(`../assets/${name}`, import.meta.url);

async function readBytes(url) {
  if (typeof window === 'undefined' && url.protocol === 'file:') {
    const fsName = 'node:fs/promises'; // kept out of the browser bundle
    const { readFile } = await import(/* @vite-ignore */ fsName);
    const buffer = await readFile(url);
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`asset ${url}: HTTP ${response.status}`);
  return response.arrayBuffer();
}

/** Loads (once) and caches a GLB asset. Resolves to the parsed glTF. */
export function loadAsset(name) {
  if (!cache.has(name)) {
    cache.set(name, (async () => {
      const bytes = await readBytes(assetUrl(name));
      const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(bytes, '', resolve, reject));
      gltf.scene.traverse((o) => {
        // Every object named (§6.2): unnamed glTF nodes are named after their parent.
        if (!o.name) o.name = o.parent ? `${o.parent.name || 'node'} part` : 'model';
        if (o.geometry) o.geometry.userData.shared = true;
        for (const m of [o.material].flat()) if (m) m.userData.shared = true;
      });
      loaded.set(name, gltf);
      return gltf;
    })());
  }
  return cache.get(name);
}

export const isAssetLoaded = (name) => loaded.has(name);

/** A fresh copy of a loaded asset's scene (geometry and materials shared with the cache). */
export function instantiate(name) {
  const gltf = loaded.get(name);
  if (!gltf) throw new Error(`asset "${name}" is not loaded; await preloadComponentAssets() before building`);
  return gltf.scene.clone(true);
}

/**
 * Loads every asset the given component types (default: all registered ones) need, the assets of
 * every registered product at its default params, and those of the `products` given ([{ type, params }]: a GLB
 * product names its file in its params).
 */
export async function preloadComponentAssets(registry, types = null, products = []) {
  const defs = registry.components().filter((d) => !types || types.includes(d.type));
  // Every product's assets at its default params (the gallery shows the GLB product's sample).
  const fixed = registry.products?.().flatMap((d) => {
    if (Array.isArray(d.assets)) return d.assets;
    const defaults = d.params.safeParse({});
    return defaults.success && typeof d.assets === 'function' ? d.assets(defaults.data) : [];
  }) ?? [];
  const chosen = products.flatMap(({ type, params = {} }) => {
    const def = registry.getProduct?.(type);
    if (!def || typeof def.assets !== 'function') return [];
    const parsed = def.params.safeParse(params);
    return parsed.success ? def.assets(parsed.data) : [];
  });
  const names = [...new Set([...defs.flatMap((d) => d.assets ?? []), ...fixed, ...chosen])];
  await Promise.all(names.map(loadAsset));
  return names;
}
