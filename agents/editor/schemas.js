// The Editor agent's answer (Claude.md §7.4): an owner's request as an RFC 6902 JSON Patch on factory.json,
// or questions when the request is unclear. Strict mode can't type "any JSON value", so each op carries
// its value as JSON text (valueJson), parsed and checked in code.
import { toStrict } from '../strict.js';

export const PATCH_OPS = Object.freeze(['add', 'remove', 'replace']);

export function patchSchema() {
  const source = {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'One sentence for the owner: what the change does' },
      ops: {
        type: 'array',
        description: 'The JSON Patch (RFC 6902) on factory.json, applied in order; empty when you ask instead',
        items: {
          type: 'object',
          properties: {
            op: { type: 'string', enum: PATCH_OPS },
            path: { type: 'string', description: 'JSON Pointer into factory.json, e.g. /stations/2/process/1/seconds; "-" appends to an array' },
            valueJson: { type: 'string', description: 'For add and replace: the new value as JSON text (e.g. 4.5, "Capping", {"op":"wait","seconds":1}); null for remove' },
          },
          required: ['op', 'path'],
        },
      },
      questions: { type: 'array', items: { type: 'string' }, description: 'What you need the owner to tell you first (then leave ops empty); empty when the request is clear' },
    },
    required: ['summary', 'ops', 'questions'],
  };
  return { name: 'factoryPatch', ...toStrict(source) };
}
