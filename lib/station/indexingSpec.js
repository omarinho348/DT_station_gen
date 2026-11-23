// The indexing-station block of a station (data only, no three.js), so the factory schema can use
// it without loading geometry code. Semantics and the runtime: indexing.js, IndexingCycle.js.
import { z } from 'zod';
import { id, opEntry } from '../ops/args.js';

export const IndexingSpec = z.object({
  members: z.number().int().min(1).max(12).describe('Units per batch'),
  pitch: z.number().positive().max(2).describe('Distance between the units of a batch, along X (m)'),
  positions: z.array(z.object({ name: id, x: z.number() })).min(2).max(12)
    .describe('Batch-centre places along the conveyor, in flow order, evenly spaced (station frame, m)'),
  enter: id.describe('Position where a new batch is taken in (before the index moves it on)'),
  exit: id.describe('Position the exit phase takes a batch from'),
  index: z.array(opEntry).min(1).describe('Ops of the index phase; one indexBatches moves the batches'),
  exitOps: z.array(opEntry).min(1).describe('Ops that take the batch at `exit` away (e.g. dischargeBatch)'),
  work: z.array(z.object({ at: id, ops: z.array(opEntry).min(1) })).default([]).describe('Work at positions, e.g. filling, capping'),
  order: z.array(id).optional().describe('Phase order in a machine cycle: "index", "exit" and work positions (default: index, exit, then work in order)'),
  preload: z.array(id).default([]).describe('Positions that hold a batch when the station is reset (the reference filling line starts with one at staging)'),
  startWhen: z.enum(['always', 'downstreamEmpty']).default('always').describe('downstreamEmpty: a machine cycle (the index) only starts while the next station holds no unit (the reference factory holds its filling line so)'),
}).superRefine((s, ctx) => {
  const names = s.positions.map((p) => p.name);
  const issue = (path, message) => ctx.addIssue({ code: 'custom', path, message });
  if (new Set(names).size !== names.length) issue(['positions'], 'position names must be unique');
  for (const key of ['enter', 'exit']) if (!names.includes(s[key])) issue([key], `unknown position "${s[key]}" (positions: ${names.join(', ')})`);
  s.work.forEach((w, i) => { if (!names.includes(w.at)) issue(['work', i, 'at'], `unknown position "${w.at}"`); });
  s.preload.forEach((p, i) => { if (!names.includes(p)) issue(['preload', i], `unknown position "${p}"`); });
  const gaps = s.positions.slice(1).map((p, i) => p.x - s.positions[i].x);
  if (gaps.some((g) => g <= 0)) issue(['positions'], 'positions must run along +X in flow order');
  else if (gaps.some((g) => Math.abs(g - gaps[0]) > 1e-6)) issue(['positions'], `positions must be evenly spaced (one index moves every batch the same distance); gaps: ${gaps.map((g) => g.toFixed(3)).join(', ')}`);
  if (s.order) {
    const allowed = new Set(['index', 'exit', ...s.work.map((w) => w.at)]);
    s.order.forEach((p, i) => { if (!allowed.has(p)) issue(['order', i], `unknown phase "${p}" (phases: ${[...allowed].join(', ')})`); });
    if (!s.order.includes('index')) issue(['order'], 'the order must include "index"');
  }
});
