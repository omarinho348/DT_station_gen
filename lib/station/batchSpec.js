// A batch of units as one unit (data only, no three.js): N members in rows. A station that takes
// batches (a case packer taking a 2 × 2 group of cans) says how they stand when they arrive; an
// indexing station's batches are one row (lib/station/indexing.js).
//
// Members stand in `rows` rows across the flow (Z, `rowPitch` apart), each row along +X (`pitch`
// apart), centred on the batch origin. Member order: the rear row (−Z) first, each row along +X
// (`rowsFrom: 'front'`: the front row first, as a row former that pushes the leading pair to the rear).
// Ops reach single members as items `member1` … `memberN` (createBatch).
import { z } from 'zod';

export const BatchSpec = z.object({
  members: z.number().int().min(1).max(12).describe('Units per batch'),
  pitch: z.number().positive().max(2).describe('Distance between the units of a row, along X (m)'),
  rows: z.number().int().min(1).max(4).default(1).describe('Rows across the flow (Z)'),
  rowPitch: z.number().min(0).max(2).default(0).describe('Distance between rows, along Z (m)'),
  rowsFrom: z.enum(['rear', 'front']).default('rear').describe('Which row the member numbers start in (rear = −Z)'),
}).refine((b) => b.members % b.rows === 0, { message: 'members must fill every row equally', path: ['members'] })
  .refine((b) => b.rows === 1 || b.rowPitch > 0, { message: 'several rows need a rowPitch', path: ['rowPitch'] });

/** Item names of a batch's members: member1 … memberN. */
export const memberNames = (members) => Array.from({ length: members }, (_, i) => `member${i + 1}`);

/** Member offsets [x, z] from the batch origin, in member order. */
export function batchOffsets({ members, pitch, rows = 1, rowPitch = 0, rowsFrom = 'rear' }) {
  const perRow = members / rows;
  return Array.from({ length: members }, (_, i) => {
    const n = Math.floor(i / perRow);
    const row = rowsFrom === 'front' ? rows - 1 - n : n;
    const column = i % perRow;
    return [round((column - (perRow - 1) / 2) * pitch), round((row - (rows - 1) / 2) * rowPitch)];
  });
}

function round(v) {
  return Math.round(v * 1e9) / 1e9;
}
