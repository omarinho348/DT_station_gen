// Station connections as data (no geometry): the schema of one pipe or hose between two machines'
// anchors, and the check of its ends against the station's machines. Drawn by connections.js.
import { z } from 'zod';
import { id } from '../ops/args.js';

const anchorRef = z.string().regex(/^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/, 'use "machine.anchor", e.g. supply.discharge');
const vec3 = z.tuple([z.number(), z.number(), z.number()]);

/** Materials a connection may use (names in the shared material library). */
export const CONNECTION_MATERIALS = ['stainless', 'brushed', 'aluminium', 'hose', 'airLine', 'frame', 'cableBlack'];
export const CONNECTION_DEFAULTS = { pipe: { radius: 0.026, material: 'stainless' }, hose: { radius: 0.018, material: 'hose' } };

export const Connection = z.object({
  id,
  from: anchorRef.describe('Start: "machine.anchor"'),
  to: anchorRef.describe('End: "machine.anchor"'),
  kind: z.enum(['pipe', 'hose']).default('pipe').describe('Rigid pipe run, or flexible hose'),
  radius: z.number().min(0.003).max(0.1).optional().describe('Outer radius (m); default 0.026 pipe, 0.018 hose'),
  material: z.enum(CONNECTION_MATERIALS).optional().describe('Default stainless (pipe), hose (hose)'),
  route: z.enum(['up', 'across']).default('up').describe('Pipe: rise to the end height first, or run across first'),
  flanges: z.boolean().default(true).describe('Pipe: a flange at each end'),
  sag: vec3.default([0, -0.1, 0]).describe('Hose: offset of its middle from the straight line (m)'),
  startTangent: vec3.default([0, -0.12, 0]).describe('Hose: direction it leaves `from` (m)'),
  endTangent: vec3.default([0, 0.12, 0]).describe('Hose: direction it arrives at `to`, from the end (m)'),
});

export const Connections = z.array(Connection).default([]).superRefine((list, ctx) => {
  const seen = new Set();
  list.forEach((c, i) => {
    if (seen.has(c.id)) ctx.addIssue({ code: 'custom', path: [i, 'id'], message: `connection id "${c.id}" is used twice` });
    seen.add(c.id);
  });
});

/**
 * Checks every connection against the station's machines (built instances or catalog specs, both
 * list their anchor names). Returns a list of messages; empty when all is well.
 */
export function connectionProblems(connections, machines) {
  const problems = [];
  for (const c of connections) {
    for (const end of ['from', 'to']) {
      const [machine, anchor] = c[end].split('.');
      const spec = machines[machine];
      if (!spec) problems.push(`connection "${c.id}" ${end}: unknown machine "${machine}" (machines: ${Object.keys(machines).join(', ')})`);
      else if (!(spec.anchors ?? []).includes(anchor)) problems.push(`connection "${c.id}" ${end}: machine "${machine}" has no anchor "${anchor}" (anchors: ${(spec.anchors ?? []).join(', ') || 'none'})`);
    }
    if (c.from === c.to) problems.push(`connection "${c.id}": from and to are the same anchor`);
  }
  return problems;
}
