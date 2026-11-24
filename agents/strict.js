// OpenAI Structured Outputs in strict mode take a subset of JSON Schema. The IR and the library are
// described in zod; this turns the JSON Schema zod writes (z.toJSONSchema) into one strict mode
// accepts, and turns the model's answer back into what the zod schema validates.
//
//   const { schema, decode } = toStrict(z.toJSONSchema(zodSchema));
//   const answer = decode(modelOutput);      // then zodSchema.parse(answer)
//
// What changes (and is undone by decode):
//   - every object lists all its properties as required, additionalProperties false; a property that
//     was optional becomes "it or null" (decode drops the nulls, so zod defaults still apply)
//   - a map (an object with additionalProperties: a schema; z.record) becomes a list of
//     { key, value } pairs (decode turns it back into an object)
//   - a tuple (prefixItems) becomes an array of its item types with fixed length
//   - an unknown value (z.unknown()) becomes ANY_VALUE: a string, number, switch or short list
// What is dropped (zod still checks it after decode): default, minLength / maxLength, propertyNames,
// $schema, title, examples. What is refused: allOf, not, if / then / else (none in this project).
// checkStrict(schema) checks the result against strict mode's rules and OpenAI's size limits.

/**
 * What an unknown value (z.unknown(), written as {}) becomes: the values params and routine args
 * take in this library (a number, a string, a switch, a short list). zod checks the real type after.
 */
export const ANY_VALUE = Object.freeze({ anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'array', items: { anyOf: [{ type: 'number' }, { type: 'string' }] } }] });

const DROP = new Set(['default', 'minLength', 'maxLength', 'propertyNames', '$schema', 'title', 'examples', 'readOnly', 'writeOnly', 'id', '$id', '$comment']);
const REFUSE = ['allOf', 'not', 'if', 'then', 'else', 'dependentRequired', 'dependentSchemas', 'patternProperties', 'unevaluatedProperties'];

/** The JSON Schema type of a value (integers as integer). */
const jsonType = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v === 'number' ? 'number' : typeof v);
const isMap = (s) => s && typeof s === 'object' && s.type === 'object' && s.additionalProperties && typeof s.additionalProperties === 'object' && !Object.keys(s.properties ?? {}).length;
const withNull = (s) => {
  if (s.anyOf) return s.anyOf.some((b) => b.type === 'null') ? s : { ...s, anyOf: [...s.anyOf, { type: 'null' }] };
  if (s.type === 'null') return s;
  return { anyOf: [s, { type: 'null' }] };
};

/**
 * A strict-mode schema from a JSON Schema (as z.toJSONSchema writes it), and a decoder for answers.
 * @param {object} source  JSON Schema; its root must be an object (strict mode's rule)
 * @returns {{ schema: object, decode: (value) => any, encode: (value) => any }}  encode: the reverse (IR → strict form)
 */
export function toStrict(source) {
  const defs = source.$defs ?? source.definitions ?? {};
  const convert = (s, path) => {
    if (s === true || s === undefined) throw new Error(`${path}: an unrestricted value (any JSON) cannot be strict; give it a type`);
    if (typeof s !== 'object') return s;
    for (const k of REFUSE) if (k in s) throw new Error(`${path}: "${k}" is not supported in strict mode`);
    if (!('type' in s) && !s.anyOf && !s.oneOf && !s.enum && !('const' in s) && !s.$ref && !s.properties && !s.items && !s.prefixItems) {
      return structuredClone(ANY_VALUE); // an unknown value
    }
    if (s.$ref) return { $ref: s.$ref.replace('#/definitions/', '#/$defs/') };
    const out = {};
    for (const [k, v] of Object.entries(s)) if (!DROP.has(k) && !['properties', 'required', 'additionalProperties', 'items', 'prefixItems', 'anyOf', 'oneOf', '$defs', 'definitions'].includes(k)) out[k] = v;
    // OpenAI wants a type beside const and enum (found by the first live call, step 8.6).
    if (!('type' in out) && ('const' in out || out.enum)) {
      const kinds = [...new Set(('const' in out ? [out.const] : out.enum).map(jsonType))];
      out.type = kinds.length === 1 ? kinds[0] : kinds;
    }
    if (isMap(s)) {
      const keyPattern = s.propertyNames?.pattern;
      return {
        type: 'array',
        ...(s.description ? { description: s.description } : {}),
        items: {
          type: 'object',
          properties: { key: { type: 'string', ...(keyPattern ? { pattern: keyPattern } : {}) }, value: convert(s.additionalProperties, `${path}.*`) },
          required: ['key', 'value'],
          additionalProperties: false,
        },
      };
    }
    if (s.type === 'object' || s.properties) {
      const props = s.properties ?? {};
      const required = new Set(s.required ?? []);
      out.type = 'object';
      out.properties = Object.fromEntries(Object.entries(props).map(([k, v]) => {
        const c = convert(v, `${path}.${k}`);
        return [k, required.has(k) ? c : withNull(c)];
      }));
      out.required = Object.keys(props);
      out.additionalProperties = false;
      return out;
    }
    if (s.prefixItems) {
      const types = s.prefixItems.map((p, i) => convert(p, `${path}[${i}]`));
      const same = types.every((t) => JSON.stringify(t) === JSON.stringify(types[0]));
      return { ...out, type: 'array', items: same ? types[0] : { anyOf: types }, minItems: types.length, maxItems: types.length };
    }
    if (s.items) out.items = convert(s.items, `${path}[]`);
    const union = s.anyOf ?? s.oneOf;
    if (union) out.anyOf = union.map((b, i) => convert(b, `${path}|${i}`));
    return out;
  };
  if (!(source.type === 'object' || source.properties)) throw new Error('the root of a strict schema must be an object');
  const schema = convert(source, '(root)');
  const defsOut = Object.fromEntries(Object.entries(defs).map(([k, v]) => [k, convert(v, `$defs.${k}`)]));
  if (Object.keys(defsOut).length) schema.$defs = defsOut;
  return { schema, decode: (value) => decodeWith(source, value, defs), encode: (value) => encodeWith(source, value, defs) };
}

const kindOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'number' ? 'number' : typeof v);
const accepts = (s, v) => {
  if (!s || typeof s !== 'object') return true;
  const k = kindOf(v);
  if (isMap(s)) return k === 'array';
  const t = s.type ?? (s.properties ? 'object' : s.prefixItems || s.items ? 'array' : null);
  if (s.const !== undefined) return s.const === v;
  if (s.enum) return s.enum.includes(v);
  if (!t) return true;
  const types = Array.isArray(t) ? t : [t];
  return types.some((x) => x === k || (x === 'integer' && k === 'number' && Number.isInteger(v)));
};

const resolve = (b, defs) => (b?.$ref ? defs[b.$ref.split('/').pop()] : b);

/**
 * The branch of a union a value belongs to: the right kind; for objects, the one whose fixed
 * (const) properties match and whose properties cover the value's keys.
 */
function branchFor(union, v, defs) {
  const fits = union.filter((b) => accepts(resolve(b, defs), v));
  if (kindOf(v) !== 'object') return fits[0];
  const consts = (r) => Object.entries(r.properties ?? {}).every(([k, p]) => p.const === undefined || v[k] === p.const);
  const covers = (r) => Object.keys(v).every((k) => k in (r.properties ?? {}) || (r.additionalProperties && typeof r.additionalProperties === 'object'));
  return fits.find((b) => consts(resolve(b, defs)) && covers(resolve(b, defs))) ?? fits.find((b) => consts(resolve(b, defs))) ?? fits[0];
}

/** Undoes toStrict's changes on a value, walking the original schema. */
function decodeWith(s, v, defs) {
  if (!s || typeof s !== 'object') return v;
  if (s.$ref) return decodeWith(defs[s.$ref.split('/').pop()], v, defs);
  if (isMap(s)) {
    if (!Array.isArray(v)) return v;
    return Object.fromEntries(v.map((pair) => [pair.key, decodeWith(s.additionalProperties, pair.value, defs)]));
  }
  const union = s.anyOf ?? s.oneOf;
  if (union) {
    const pick = branchFor(union, v, defs);
    return pick ? decodeWith(pick, v, defs) : v;
  }
  if ((s.type === 'object' || s.properties) && kindOf(v) === 'object') {
    const props = s.properties ?? {};
    const required = new Set(s.required ?? []);
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      if (val === null && !required.has(k)) continue; // an optional field left out
      out[k] = k in props ? decodeWith(props[k], val, defs) : val;
    }
    return out;
  }
  if (Array.isArray(v)) {
    if (s.prefixItems) return v.map((x, i) => decodeWith(s.prefixItems[i], x, defs));
    if (s.items) return v.map((x) => decodeWith(s.items, x, defs));
  }
  return v;
}

/** Puts a value in strict form (the reverse of decode): maps as { key, value } lists, missing optional fields as null. */
function encodeWith(s, v, defs) {
  if (!s || typeof s !== 'object') return v;
  if (s.$ref) return encodeWith(defs[s.$ref.split('/').pop()], v, defs);
  if (isMap(s)) {
    if (kindOf(v) !== 'object') return v;
    return Object.entries(v).map(([key, value]) => ({ key, value: encodeWith(s.additionalProperties, value, defs) }));
  }
  const union = s.anyOf ?? s.oneOf;
  if (union) {
    // A map's strict form is a list, so test the value's own kind against the original branches.
    const fits = union.filter((b) => { const r = resolve(b, defs); return isMap(r) ? kindOf(v) === 'object' : accepts(r, v); });
    const pick = kindOf(v) === 'object' ? branchFor(fits, v, defs) ?? fits[0] : fits[0];
    return pick ? encodeWith(pick, v, defs) : v;
  }
  if ((s.type === 'object' || s.properties) && kindOf(v) === 'object') {
    const out = {};
    for (const [k, p] of Object.entries(s.properties ?? {})) out[k] = k in v && v[k] !== undefined ? encodeWith(p, v[k], defs) : null;
    return out;
  }
  if (Array.isArray(v)) {
    if (s.prefixItems) return v.map((x, i) => encodeWith(s.prefixItems[i], x, defs));
    if (s.items) return v.map((x) => encodeWith(s.items, x, defs));
  }
  return v;
}

/** OpenAI's documented limits for a strict schema. */
export const STRICT_LIMITS = Object.freeze({ properties: 5000, depth: 10, enumValues: 1000 });

/**
 * Problems strict mode would refuse: [] when the schema is fine. Checks every object's
 * required / additionalProperties, a root object, no maps or refused keywords left, and the size
 * limits (object properties in all, nesting depth, enum values).
 */
export function checkStrict(schema) {
  const problems = [];
  let properties = 0;
  let enumValues = 0;
  const seen = new Set();
  const walk = (s, path, depth) => {
    if (!s || typeof s !== 'object') return;
    if (s.$ref) {
      const name = s.$ref.split('/').pop();
      if (!seen.has(name)) { seen.add(name); walk(schema.$defs?.[name], `$defs.${name}`, depth); }
      return;
    }
    for (const k of REFUSE) if (k in s) problems.push(`${path}: "${k}" not supported`);
    for (const k of ['default', 'minLength', 'maxLength', 'propertyNames', 'prefixItems', 'oneOf']) if (k in s) problems.push(`${path}: "${k}" not supported`);
    if (!('type' in s) && !s.anyOf && !s.$ref) problems.push(`${path}: no type${'const' in s || s.enum ? ' beside const / enum (OpenAI requires one)' : ' (any JSON value is not allowed)'}`);
    if (s.enum) enumValues += s.enum.length;
    if (s.type === 'object' || s.properties) {
      if (depth > STRICT_LIMITS.depth) problems.push(`${path}: nested deeper than ${STRICT_LIMITS.depth} objects`);
      const keys = Object.keys(s.properties ?? {});
      properties += keys.length;
      if (s.additionalProperties !== false) problems.push(`${path}: additionalProperties must be false`);
      const req = new Set(s.required ?? []);
      const missing = keys.filter((k) => !req.has(k));
      if (missing.length) problems.push(`${path}: every property must be required (${missing.join(', ')} are not)`);
      for (const [k, v] of Object.entries(s.properties ?? {})) walk(v, `${path}.${k}`, depth + 1);
    }
    if (s.items) walk(s.items, `${path}[]`, depth);
    for (const [i, b] of (s.anyOf ?? []).entries()) walk(b, `${path}|${i}`, depth);
  };
  if (!(schema.type === 'object' && schema.properties)) problems.push('(root): must be an object');
  walk(schema, '(root)', 1);
  if (properties > STRICT_LIMITS.properties) problems.push(`${properties} object properties in all (limit ${STRICT_LIMITS.properties})`);
  if (enumValues > STRICT_LIMITS.enumValues) problems.push(`${enumValues} enum values in all (limit ${STRICT_LIMITS.enumValues})`);
  return problems;
}
