// The line store (Phase 10 step 1): where a line's factory.json lives for good, with a version for every
// change (Claude.md §7.4 "keep a version history of factory.json for undo"), compiled after each save.
//
//   lines/<id>/factory.json            the current version (the single source of truth, rule 2)
//   lines/<id>/versions/v0001.json     { version, time, by, message, request?, patch, factory } per change
//   generated/<folder>/                its compiled files (only those whose text changed are rewritten,
//                                      so Vite reloads only what changed)
//
// Undo writes the previous version again as a new version (by: 'undo'), so the history only grows and an
// undo can itself be undone. Node only.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { diffJson } from '../agents/diff.js';

const ID = /^[a-z][a-zA-Z0-9]*$/;

export class LineStoreError extends Error {}

const pad = (n) => String(n).padStart(4, '0');

/**
 * @param {object} o
 * @param {string} o.root
 * @param {(factory) => object} o.validate   factory.json → parsed (throws on an invalid one)
 * @param {(factory) => { folder, written, unchanged, removed }} [o.compile]  writes generated/<folder>/
 * @param {string[]} [o.reserved]  line ids a stored line may not take (the example lines: their compiled
 *                                 folders are the visual reference)
 * @param {Function} [o.now]
 */
export function createLineStore({ root, validate, compile = null, reserved = [], now = () => new Date().toISOString() }) {
  const dir = (id) => {
    if (!ID.test(id ?? '')) throw new LineStoreError(`not a line id: "${id}"`);
    return join(root, 'lines', id);
  };
  const writeJson = (path, data) => {
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
    renameSync(tmp, path);
  };
  const versionFiles = (id) => {
    const v = join(dir(id), 'versions');
    return existsSync(v) ? readdirSync(v).filter((n) => /^v\d{4}\.json$/.test(n)).sort() : [];
  };

  /** The lines there are: [{ id, title, version, stations }]. */
  function list() {
    const base = join(root, 'lines');
    if (!existsSync(base)) return [];
    return readdirSync(base).filter((n) => ID.test(n) && existsSync(join(base, n, 'factory.json'))).sort().map((id) => {
      const f = JSON.parse(readFileSync(join(base, id, 'factory.json'), 'utf8'));
      return { id, title: f.line?.title ?? id, version: versionFiles(id).length, stations: f.stations?.length ?? 0 };
    });
  }

  function exists(id) {
    return existsSync(join(dir(id), 'factory.json'));
  }

  /** The current factory.json and its version number. */
  function load(id) {
    if (!exists(id)) throw new LineStoreError(`no line "${id}" in lines/`);
    return { factory: JSON.parse(readFileSync(join(dir(id), 'factory.json'), 'utf8')), version: versionFiles(id).length };
  }

  /**
   * Saves a new version: validated, written, compiled. The line's id is fixed (it names the folders).
   * @returns {{ version, patch, compiled }}
   */
  function save(id, factory, { by, message, request = null }) {
    if (factory?.line?.id !== id) throw new LineStoreError(`the factory's line.id is "${factory?.line?.id}", not "${id}" (a line's id cannot change)`);
    if (reserved.includes(id)) throw new LineStoreError(`"${id}" is an example line's id (spec/examples; its compiled files are the reference): save it under another id`);
    validate(factory);
    const before = exists(id) ? load(id).factory : null;
    const patch = before ? diffJson(before, factory) : [];
    if (before && !patch.length) throw new LineStoreError('nothing changed');
    const version = versionFiles(id).length + 1;
    mkdirSync(join(dir(id), 'versions'), { recursive: true });
    writeJson(join(dir(id), 'versions', `v${pad(version)}.json`), { version, time: now(), by, message, ...(request ? { request } : {}), patch, factory });
    writeJson(join(dir(id), 'factory.json'), factory);
    const compiled = compile ? compile(factory) : null;
    return { version, patch, compiled };
  }

  /** A new line from a factory.json (an example, a Builder result) under its own id: version 1. */
  function create(id, factory, { by, message }) {
    if (exists(id)) throw new LineStoreError(`there is already a line "${id}"`);
    return save(id, { ...structuredClone(factory), line: { ...factory.line, id } }, { by, message });
  }

  /** Every version, newest first, without the full factories. */
  function history(id) {
    return versionFiles(id).reverse().map((n) => {
      const { factory, ...v } = JSON.parse(readFileSync(join(dir(id), 'versions', n), 'utf8'));
      return { ...v, ops: v.patch.length };
    });
  }

  /** A version's factory.json. */
  function version(id, n) {
    const path = join(dir(id), 'versions', `v${pad(n)}.json`);
    if (!existsSync(path)) throw new LineStoreError(`line "${id}" has no version ${n}`);
    return JSON.parse(readFileSync(path, 'utf8')).factory;
  }

  /** Undo: the version before the current one is saved again as a new version. */
  function undo(id) {
    const n = versionFiles(id).length;
    if (n < 2) throw new LineStoreError('there is nothing to undo (this is the first version)');
    return save(id, version(id, n - 1), { by: 'undo', message: `undo version ${n} (back to version ${n - 1})` });
  }

  /** Recompiles the current version (after a library change, or when generated/ was cleaned). */
  function recompile(id) {
    if (!compile) throw new LineStoreError('no compiler');
    return compile(load(id).factory);
  }

  return { list, exists, load, save, create, history, version, undo, recompile };
}

/**
 * The store as the dev server and scripts use it: validated by the IR schema, compiled with the
 * project's compiler into generated/<folder>/, the example lines' ids reserved.
 * @param {{ root, registry, parseFactory, compileFactory, writeCompiled }} m
 */
export function projectLineStore({ root, registry, parseFactory, compileFactory, writeCompiled, now }) {
  const examples = join(root, 'spec', 'examples');
  const reserved = existsSync(examples) ? readdirSync(examples).filter((n) => n.endsWith('.factory.json')).map((n) => JSON.parse(readFileSync(join(examples, n), 'utf8')).line?.id).filter(Boolean) : [];
  return createLineStore({
    root,
    reserved,
    now,
    validate: (factory) => parseFactory(factory),
    compile: (factory) => {
      const c = compileFactory(registry, factory, { source: `lines/${factory.line.id}/factory.json` });
      return { folder: c.folder, ...writeCompiled(c, join(root, 'generated')) };
    },
  });
}
