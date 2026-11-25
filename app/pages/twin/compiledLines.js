// Compiled lines (generated/<line>/line.js, written by compiler/emit.js), loaded by dynamic import
// so the twin page only fetches the line it shows. Open with #/twin?line=<folder>, e.g.
// #/twin?line=printer-line (?t=<s> frozen at that moment, ?speed=<n>, ?cam=x,y,z,tx,ty,tz).
import { createMaterials } from '../../../lib/core/materials.js';
import { playLine } from './linePlayer.js';
import { preloadComponentAssets } from '../../../lib/core/assets.js';
import { registry as catalog } from '../../../lib/components/index.js';

const MODULES = Object.fromEntries(Object.entries(import.meta.glob('../../../generated/*/line.js'))
  .map(([path, load]) => [path.match(/generated\/([^/]+)\/line\.js$/)[1], load]));

export const compiledLineNames = () => Object.keys(MODULES).sort();

/** Loads and starts a compiled line; resolves to the player (root, update, skip, dispose). */
export async function loadCompiledLine(name, { speed = 1, onStatus = null } = {}) {
  const load = MODULES[name];
  if (!load) {
    throw new Error(`No compiled line "${name}" (compiled: ${compiledLineNames().join(', ') || 'none'}; run npm run compile)`);
  }
  return startModule(await load(), name, { speed, onStatus });
}

/**
 * Loads and starts a Builder draft (generated/_draft/<line>/r<rev>/line.js, written by the dev server
 * while the page is open, so not known to import.meta.glob): a plain dynamic import of its URL. Every
 * draft revision has its own folder, so the browser never reuses an older draft's station files.
 */
export async function loadDraftLine(url, { speed = 1, onStatus = null } = {}) {
  if (!/^\/generated\/_draft\/[\w-]+\/(r[\w-]+\/)?line\.js$/.test(url)) throw new Error(`not a draft line: ${url}`);
  const mod = await import(/* @vite-ignore */ url);
  return startModule(mod, url.split('/').slice(3, -1).join('/'), { speed, onStatus });
}

/**
 * Loads and starts a stored line's compiled files (generated/<folder>/line.js, written by /api/lines):
 * from the glob when it was there at page load, else by a plain dynamic import (a line saved since).
 */
export async function loadStoredLine(folder, { speed = 1, onStatus = null } = {}) {
  if (!/^[\w-]+$/.test(folder)) throw new Error(`not a line folder: ${folder}`);
  const mod = MODULES[folder] ? await MODULES[folder]() : await import(/* @vite-ignore */ `/generated/${folder}/line.js`);
  return startModule(mod, folder, { speed, onStatus });
}

async function startModule(mod, name, { speed, onStatus }) {
  // A line may use a component built from a model, and its product may be the owner's GLB model.
  await preloadComponentAssets(catalog, null, [mod.product]);
  const materials = createMaterials();
  const line = mod.createLine({ materials });
  return { ...playLine(line, { materials, name, speed, onStatus }), module: mod };
}
