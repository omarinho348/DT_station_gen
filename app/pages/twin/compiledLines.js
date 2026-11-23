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
  const mod = await load();
  await preloadComponentAssets(catalog); // a line may use a component built from a model
  const materials = createMaterials();
  const line = mod.createLine({ materials });
  return { ...playLine(line, { materials, name, speed, onStatus }), module: mod };
}
