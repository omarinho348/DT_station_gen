// JSON diffs as RFC 6902 JSON Patch (Claude.md §7.2 "a change diff to approve", §7.4 the Editor's
// patches). Plain data in, plain data out; nothing here knows what a factory is, apart from labelling
// array items by their `id` for people.
//
//   diffJson(before, after)        → [{ op: 'add' | 'remove' | 'replace', path, value? }]
//   applyPatch(doc, ops)           → a new document (add / remove / replace / test)
//   labelPath(doc, path)           → "stations › cap › equipment › belt › params › length"
//   describeDiff(before, after)    → the ops with a label and the old value, for the approval panel
//
// Arrays are compared index by index; extra items are added at the end or removed from the end
// (highest index first, so the ops apply in order). Good for the Builder, which only appends.

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Deep equality for JSON values (key order ignored). */
export function jsonEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => jsonEqual(x, b[i]));
  if (isObject(a)) {
    if (!isObject(b)) return false;
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => Object.hasOwn(b, k) && jsonEqual(a[k], b[k]));
  }
  return false;
}

const escape = (key) => String(key).replace(/~/g, '~0').replace(/\//g, '~1');
const unescape = (key) => key.replace(/~1/g, '/').replace(/~0/g, '~');

/** "/a/b~1c/0" → ['a', 'b/c', '0'] */
export const parsePointer = (path) => (path === '' ? [] : path.replace(/^\//, '').split('/').map(unescape));

/** The RFC 6902 ops that turn `before` into `after`. */
export function diffJson(before, after, path = '') {
  if (jsonEqual(before, after)) return [];
  if (Array.isArray(before) && Array.isArray(after)) {
    const ops = [];
    const common = Math.min(before.length, after.length);
    for (let i = 0; i < common; i += 1) ops.push(...diffJson(before[i], after[i], `${path}/${i}`));
    for (let i = common; i < after.length; i += 1) ops.push({ op: 'add', path: `${path}/${i}`, value: structuredClone(after[i]) });
    for (let i = before.length - 1; i >= common; i -= 1) ops.push({ op: 'remove', path: `${path}/${i}` });
    return ops;
  }
  if (isObject(before) && isObject(after)) {
    const ops = [];
    for (const k of Object.keys(before)) if (!Object.hasOwn(after, k)) ops.push({ op: 'remove', path: `${path}/${escape(k)}` });
    for (const [k, v] of Object.entries(after)) {
      if (!Object.hasOwn(before, k)) ops.push({ op: 'add', path: `${path}/${escape(k)}`, value: structuredClone(v) });
      else ops.push(...diffJson(before[k], v, `${path}/${escape(k)}`));
    }
    return ops;
  }
  return [{ op: 'replace', path, value: structuredClone(after) }];
}

export class PatchError extends Error {}

/** Applies RFC 6902 ops (add, remove, replace, test) to a copy of `doc`. Throws PatchError on a bad op. */
export function applyPatch(doc, ops) {
  let root = structuredClone(doc);
  for (const [n, o] of ops.entries()) {
    const keys = parsePointer(o.path);
    if (!keys.length) {
      if (o.op === 'replace' || o.op === 'add') { root = structuredClone(o.value); continue; }
      if (o.op === 'test') { if (!jsonEqual(root, o.value)) throw new PatchError(`op ${n}: test failed at ""`); continue; }
      throw new PatchError(`op ${n}: cannot ${o.op} the whole document`);
    }
    let parent = root;
    for (const k of keys.slice(0, -1)) {
      parent = Array.isArray(parent) ? parent[Number(k)] : parent?.[k];
      if (parent === undefined || parent === null || typeof parent !== 'object') throw new PatchError(`op ${n}: no "${o.path}" (missing parent)`);
    }
    const last = keys.at(-1);
    if (Array.isArray(parent)) {
      const i = last === '-' ? parent.length : Number(last);
      if (!Number.isInteger(i) || i < 0 || i > parent.length || (o.op !== 'add' && i >= parent.length)) throw new PatchError(`op ${n}: index ${last} is outside "${o.path}"`);
      if (o.op === 'add') parent.splice(i, 0, structuredClone(o.value));
      else if (o.op === 'remove') parent.splice(i, 1);
      else if (o.op === 'replace') parent[i] = structuredClone(o.value);
      else if (o.op === 'test') { if (!jsonEqual(parent[i], o.value)) throw new PatchError(`op ${n}: test failed at "${o.path}"`); }
      else throw new PatchError(`op ${n}: unsupported op "${o.op}"`);
    } else {
      const has = Object.hasOwn(parent, last);
      if (o.op === 'add') parent[last] = structuredClone(o.value);
      else if (!has) throw new PatchError(`op ${n}: no "${o.path}"`);
      else if (o.op === 'remove') delete parent[last];
      else if (o.op === 'replace') parent[last] = structuredClone(o.value);
      else if (o.op === 'test') { if (!jsonEqual(parent[last], o.value)) throw new PatchError(`op ${n}: test failed at "${o.path}"`); }
      else throw new PatchError(`op ${n}: unsupported op "${o.op}"`);
    }
  }
  return root;
}

/** The value at a JSON pointer, or undefined. */
export function valueAt(doc, path) {
  let v = doc;
  for (const k of parsePointer(path)) {
    if (v === null || typeof v !== 'object') return undefined;
    v = Array.isArray(v) ? v[Number(k)] : v[k];
  }
  return v;
}

/** A pointer for people: array items shown by their `id` (or `name`) where they have one. */
export function labelPath(doc, path) {
  const parts = [];
  let v = doc;
  for (const k of parsePointer(path)) {
    if (Array.isArray(v)) {
      const item = v[Number(k)];
      const name = isObject(item) ? (item.id ?? item.name ?? null) : null;
      parts.push(typeof name === 'string' ? name : `[${k}]`);
      v = item;
    } else {
      parts.push(k);
      v = isObject(v) ? v[k] : undefined;
    }
  }
  return parts.join(' › ') || '(whole document)';
}

/**
 * The diff for the approval panel: each op with a label (array items by id: the "after" document for
 * add / replace, "before" for remove) and, for replace / remove, the value it had.
 */
export function describeDiff(before, after) {
  return diffJson(before, after).map((o) => ({
    ...o,
    label: labelPath(o.op === 'remove' ? before : after, o.path),
    ...(o.op === 'add' ? {} : { from: structuredClone(valueAt(before, o.path)) }),
  }));
}
