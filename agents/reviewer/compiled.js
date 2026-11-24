// The reviewer's compiled-files check (Claude.md §7.3 "compiled files import and build headless",
// step 7.4). The files are what the twin loads (generated/<line>/*.js), so they are checked as files:
//   1. the factory.json is compiled in memory (compiler/emit.js)
//   2. the files are compiled again for generated/_review/<line>-<hash>/ (one level deeper than
//      generated/<line>/, so lib/ is ../../../lib, as for drafts) and written there; the hash keeps two
//      different versions apart in the module cache
//   3. line.js is imported and createLine() builds the line headless
//   4. that line is compared with the line built straight from the IR: the same layout, the same timing,
//      every named object in the same place, shown or hidden alike
//   5. the folder is removed again
// And when the factory.json has compiled files on disk already (generated/<line>/), they are compared
// with what it compiles to now: a stale folder is a warning (npm run compile).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { compileFactory } from '../../compiler/emit.js';
import { Line } from '../../lib/line/Line.js';
import { createMaterials } from '../../lib/core/materials.js';

let sharedMaterials = null;

/** Where the temporary compiled files go, under the project root. */
export const REVIEW_DIR = 'generated/_review';

/** Every named object of a built line: "name|shown|x,y,z" (positions to the micrometre), in scene order. */
export function sceneOf(line) {
  line.root.updateMatrixWorld(true);
  const out = [];
  const p = new THREE.Vector3();
  line.root.traverse((o) => {
    if (!o.name) return;
    p.setFromMatrixPosition(o.matrixWorld);
    out.push(`${o.name}|${o.visible ? 1 : 0}|${p.toArray().map((v) => Math.round(v * 1e6) / 1e6).join(',')}`);
  });
  return out;
}

/** The first place two JSON-like values differ, as a dotted path (or null when equal). */
export function firstDifference(a, b, path = '') {
  if (Object.is(a, b)) return null;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) {
    return `${path || '(value)'}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
  }
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  for (const k of keys) {
    const d = firstDifference(a[k], b[k], path ? `${path}.${k}` : k);
    if (d) return d;
  }
  return null;
}

/**
 * Checks the compiled files of a factory.json. Returns findings { check: 'compiled', … }.
 * @param {object} registry
 * @param {object} data   factory.json (parsed JSON); it must already pass the data checks
 * @param {object} o
 * @param {string} o.root           the project root (generated/ lives under it)
 * @param {Function} [o.importModule]  (root-relative path, e.g. "/generated/…/line.js") → module; default: import()
 * @param {string} [o.source]       the factory.json's path from the root (as npm run compile names it in the
 *                                  headers); given, the files on disk are checked for staleness
 */
export async function reviewCompiled(registry, data, { root, importModule = (p) => import(/* @vite-ignore */ p), source = null } = {}) {
  const findings = [];
  const add = (severity, path, message, hint) => findings.push({ check: 'compiled', severity, path, message, ...(hint ? { hint } : {}) });
  let compiled;
  try {
    compiled = compileFactory(registry, data, { source });
  } catch (error) {
    add('error', '(compile)', `the compiler refused it: ${error.message}`);
    return findings;
  }

  // Stale files on disk.
  const onDisk = join(root, 'generated', compiled.folder);
  if (source && existsSync(onDisk)) {
    const stale = compiled.files.filter((f) => !existsSync(join(onDisk, f.name)) || readFileSync(join(onDisk, f.name), 'utf8') !== f.content).map((f) => f.name);
    if (stale.length) add('warning', '(compile)', `generated/${compiled.folder}/ is not what this factory.json compiles to now (${stale.join(', ')})`, 'npm run compile');
  }

  // Write, import, build: the same files, with lib/ one level further up.
  const forReview = compileFactory(registry, data, { source, libPath: '../../../lib' });
  const hash = createHash('sha256').update(forReview.files.map((f) => `${f.name}\n${f.content}`).join('\n')).digest('hex').slice(0, 10);
  const folder = `${compiled.folder}-${hash}`;
  const dir = join(root, REVIEW_DIR, folder);
  mkdirSync(dir, { recursive: true });
  let fromFiles = null;
  let fromIr = null;
  try {
    for (const f of forReview.files) writeFileSync(join(dir, f.name), f.content);
    let mod;
    try {
      mod = await importModule(`/${REVIEW_DIR}/${folder}/line.js`);
    } catch (error) {
      add('error', '(compile)', `the compiled files do not import: ${error.message}`);
      return findings;
    }
    sharedMaterials ??= createMaterials();
    try {
      fromFiles = mod.createLine({ materials: sharedMaterials, registry });
    } catch (error) {
      if (/needs its model loaded first/.test(error.message)) {
        add('info', '(compile)', `compiled files not built: ${error.message.replace(/: await .*$/, '')}`, 'preload the models first (preloadComponentAssets in lib/core/assets.js); npm run review does');
        return findings;
      }
      add('error', '(compile)', `the compiled line does not build headless: ${error.message}`);
      return findings;
    }
    const { line, ctx, conventions } = compiled.expanded;
    fromIr = new Line({ registry, line, ctx: { ...ctx, materials: sharedMaterials }, conventions });
    const differs = [];
    const layout = firstDifference(fromFiles.layout, fromIr.layout);
    if (layout) differs.push(`layout ${layout}`);
    const timing = firstDifference(fromFiles.timing, fromIr.timing);
    if (timing) differs.push(`timing ${timing}`);
    const a = sceneOf(fromFiles);
    const b = sceneOf(fromIr);
    if (a.length !== b.length) differs.push(`scene: ${a.length} named objects vs ${b.length}`);
    const i = a.findIndex((x, k) => x !== b[k]);
    if (i >= 0) differs.push(`scene object #${i + 1}: ${a[i]} vs ${b[i] ?? '(none)'}`);
    if (differs.length) {
      add('error', '(compile)', `the compiled line is not the line factory.json describes: ${differs.join('; ')}`, 'a compiler bug: the files must build exactly what the IR does');
    } else {
      add('info', '(compile)', `${compiled.files.length} compiled files import and build headless, the same line as factory.json (${b.length} named objects)`);
    }
    return findings;
  } finally {
    fromFiles?.dispose?.();
    fromIr?.dispose?.();
    rmSync(dir, { recursive: true, force: true });
  }
}
