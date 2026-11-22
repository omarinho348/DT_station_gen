// Writes a compiled line (compiler/emit.js) to generated/<folder>/ (Node only: the compile script,
// later the dev-server API). Files whose content did not change are left alone, so Vite reloads
// only what changed. Generated .js files the new output no longer has are removed; files without
// the generator's mark are never touched.
import { mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { GENERATED_MARK } from './emit.js';

/**
 * @param {{ folder: string, files: { name, content }[] }} compiled
 * @param {string} outRoot  e.g. <repo>/generated (or generated/_draft for previews)
 * @returns {{ dir, written: string[], unchanged: string[], removed: string[] }}
 */
export function writeCompiled(compiled, outRoot) {
  const dir = join(outRoot, compiled.folder);
  mkdirSync(dir, { recursive: true });
  const names = new Set(compiled.files.map((f) => f.name));
  const result = { dir, written: [], unchanged: [], removed: [] };
  for (const file of compiled.files) {
    const path = join(dir, file.name);
    if (existsSync(path) && readFileSync(path, 'utf8') === file.content) {
      result.unchanged.push(file.name);
      continue;
    }
    writeFileSync(path, file.content);
    result.written.push(file.name);
  }
  for (const name of readdirSync(dir)) {
    if (names.has(name) || !name.endsWith('.js')) continue;
    const path = join(dir, name);
    if (readFileSync(path, 'utf8').includes(GENERATED_MARK)) {
      rmSync(path);
      result.removed.push(name);
    }
  }
  return result;
}
