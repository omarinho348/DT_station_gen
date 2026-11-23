// Supply stock of a station (data only): identical items standing on a machine's decks (empty
// containers in a rack, flat cases), drawn one by one as the station brings units in or makes
// items. Drawn as instanced stock (lib/core/instancedStock.js), so a rack of 100+ items costs a few
// draw calls. Port of the reference factory's supply racks (factory/SupplyRack.js, the jerry-can
// and carton racks of LubricantFactory). Played by StationCycle (lib/station/StationCycle.js).
//
// It shows the supply being used up; it does not hold the line back when it runs out (a line's run
// size decides how many units are released).
import { z } from 'zod';
import { id } from '../ops/args.js';

const product = z.object({
  type: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({}),
  stage: z.string().optional().describe('Stage the stock items show'),
});

export const Supplies = z.record(id, z.object({
  machine: id.describe('Machine holding the stock (a rack)'),
  decks: z.array(id).min(1).max(8).describe('Its ports the stock stands on, filled in this order (lowest first)'),
  product: product.optional().describe('What the items are (default: the station\'s units, at its input stage)'),
  columns: z.array(z.number()).min(1).max(12).describe('Item offsets along the machine X (m)'),
  rows: z.array(z.number()).min(1).max(12).describe('Item offsets along the machine Z (m)'),
  layers: z.number().int().min(1).max(6).default(1).describe('Items stacked on each deck'),
  layerHeight: z.number().min(0).max(2).default(0).describe('Height of one layer (m)'),
  turn: z.number().min(-Math.PI).max(Math.PI).default(0).describe('Items turned about Y (rad)'),
  draws: z.union([
    z.literal('units').describe('one item per unit (batch member) the station brings in from outside'),
    z.object({ made: id.describe('one item each time an op makes an item of this name (spawn)') }),
  ]),
})).default({});

/** Item poses in the machine frame, in fill order: deck by deck, layer, row, column (the last one is taken first). */
export function supplySlots(supply, deckPoint) {
  const slots = [];
  for (const deck of supply.decks) {
    const at = deckPoint(deck);
    for (let layer = 0; layer < supply.layers; layer += 1) {
      for (const z of supply.rows) {
        for (const x of supply.columns) {
          slots.push({ position: [at[0] + x, at[1] + layer * supply.layerHeight, at[2] + z], turn: supply.turn });
        }
      }
    }
  }
  return slots;
}

/** Problems with supplies against the station's machines (instances or specs, both list ports). */
export function supplyProblems(supplies, machines) {
  const problems = [];
  for (const [name, s] of Object.entries(supplies ?? {})) {
    const spec = machines[s.machine];
    if (!spec) { problems.push(`supply "${name}": unknown machine "${s.machine}"`); continue; }
    for (const deck of s.decks) {
      if (!spec.ports?.[deck]) problems.push(`supply "${name}": machine "${s.machine}" has no port "${deck}" (ports: ${Object.keys(spec.ports ?? {}).join(', ') || 'none'})`);
    }
  }
  return problems;
}
