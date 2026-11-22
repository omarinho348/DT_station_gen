// JSON-like data → a readable JavaScript literal, for the files the compiler emits. Deterministic:
// keys keep their order, numbers print in their shortest exact form, short arrays / objects stay on
// one line and long ones break one entry per line. eval(toJs(x)) deep-equals x (JSON semantics:
// undefined object values are left out, undefined array entries become null).

const IDENT = /^[A-Za-z_$][\w$]*$/;
// Control characters, and U+2028 / U+2029 (they end a line inside a JS string literal): written
// as \uXXXX escapes. Built from code points so this source holds no invisible characters.
const UNSAFE = new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(0x1f)}${String.fromCharCode(0x2028, 0x2029)}]`, 'g');
const BACKSLASH = String.fromCharCode(0x5c);

/** A single-quoted JS string literal. */
export function jsString(text) {
  const named = { "'": "'", '\n': 'n', '\r': 'r', '\t': 't' };
  return `'${String(text)
    .replaceAll(BACKSLASH, BACKSLASH + BACKSLASH)
    .replace(/['\n\r\t]/g, (c) => BACKSLASH + named[c])
    .replace(UNSAFE, (c) => `${BACKSLASH}u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)}'`;
}

function key(name) {
  if (name === '__proto__') throw new Error('toJs: the key "__proto__" cannot be written as a literal');
  return IDENT.test(name) ? name : jsString(name);
}

/**
 * @param {*} value       JSON-like data (objects, arrays, strings, finite numbers, booleans, null)
 * @param {object} [o]
 * @param {number} [o.indent]  indentation of the line the literal starts on (spaces)
 * @param {number} [o.col]     the column the literal starts at (default: the indentation)
 * @param {number} [o.width]   lines longer than this are broken
 */
export function toJs(value, { indent = 0, col = indent, width = 100 } = {}) {
  return write(value, indent, col, width, '$');
}

// indent: indentation of the current line; col: the column the literal starts at on it.
function write(value, indent, col, width, path) {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string': return jsString(value);
    case 'boolean': return String(value);
    case 'number':
      if (!Number.isFinite(value)) throw new Error(`toJs: ${path} is ${value} (only finite numbers)`);
      return String(value);
    case 'object': break;
    default: throw new Error(`toJs: ${path} is a ${typeof value} (only JSON data)`);
  }
  const pad = ' '.repeat(indent + 2);
  let items;
  let open;
  let close;
  if (Array.isArray(value)) {
    [open, close] = ['[', ']'];
    items = value.map((v, i) => write(v === undefined ? null : v, indent + 2, indent + 2, width, `${path}[${i}]`));
    if (!items.length) return '[]';
    const inline = `[${items.join(', ')}]`;
    if (!inline.includes('\n') && col + inline.length + 1 <= width) return inline;
  } else {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new Error(`toJs: ${path} is a ${value.constructor?.name ?? 'non-plain object'} (only JSON data)`);
    }
    [open, close] = ['{', '}'];
    items = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${key(k)}: ${write(v, indent + 2, indent + 4 + key(k).length, width, `${path}.${k}`)}`);
    if (!items.length) return '{}';
    const inline = `{ ${items.join(', ')} }`;
    if (!inline.includes('\n') && col + inline.length + 1 <= width) return inline;
  }
  return `${open}\n${items.map((item) => `${pad}${item},`).join('\n')}\n${' '.repeat(indent)}${close}`;
}
