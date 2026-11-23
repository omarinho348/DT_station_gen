// Selective pallet rack: blue uprights with base plates and frame braces, orange step beams and
// wire decks, in one or more bays. Holds supply stock (empty containers, flat cases). Port of the
// reference factory/SupplyRack.js (createRackFrame), on the shared material library. Origin at the
// centre of the footprint on the floor; length along X, depth along Z. Ports deck1…deckN are the
// deck tops, where stock stands.
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, roundedBox } from '../../core/primitives.js';

const UPRIGHT = 0.07;
const decksOf = (p) => Array.from({ length: p.levels }, (_, i) => p.firstDeck + i * p.deckSpacing);
const heightOf = (p) => decksOf(p).at(-1) + p.topClearance;

defineComponent({
  type: 'palletRack',
  category: 'fixture',
  summary: 'Selective pallet rack (uprights, step beams, wire decks) in one or more bays, holding supply stock on its decks.',
  // Decks are evenly spaced; the uprights reach `topClearance` above the top deck. Defaults: the
  // reference can rack (decks 0.14 / 0.74 / 1.34 m, uprights 1.95 m); its carton rack is
  // { levels: 2, firstDeck: 0.15, deckSpacing: 1.0, topClearance: 1.05, length: 1.8, depth: 1.4 }.
  params: z.object({
    length: z.number().min(0.8).max(6).default(1.95).describe('Length along X (m)'),
    depth: z.number().min(0.5).max(1.6).default(1.35).describe('Depth along Z (m)'),
    bays: z.number().int().min(1).max(4).default(2).describe('Bays along X'),
    levels: z.number().int().min(1).max(6).default(3).describe('Number of decks'),
    firstDeck: z.number().min(0.1).max(1.0).default(0.14).describe('Lowest deck top above the floor (m)'),
    deckSpacing: z.number().min(0.3).max(1.5).default(0.6).describe('Between deck tops (m)'),
    topClearance: z.number().min(0.3).max(1.5).default(0.61).describe('Uprights above the top deck (m)'),
  }),
  footprint: (p) => ({ x: [-(p.length / 2 + 0.08), p.length / 2 + 0.08], z: [-(p.depth / 2 + 0.08), p.depth / 2 + 0.08], height: heightOf(p) }),
  mount: 'floor',
  ports: (p) => Object.fromEntries(decksOf(p).map((y, i) => [`deck${i + 1}`, { position: [0, y, 0], direction: 'work', carries: 'unit' }])),
  motions: {},
  ops: [],
  build({ params: p, materials }) {
    const root = group(null, 'palletRack');
    const height = heightOf(p);
    const bayLength = p.length / p.bays;
    for (let bay = 0; bay <= p.bays; bay += 1) {
      const x = -p.length / 2 + bay * bayLength;
      [-1, 1].forEach((side) => {
        roundedBox(root, [UPRIGHT, height, UPRIGHT], [x, height / 2, side * p.depth / 2], materials.machineBlue, 'Upright', 0.008);
        roundedBox(root, [0.16, 0.012, 0.16], [x, 0.006, side * p.depth / 2], materials.machineBlue, 'Base plate', 0.003);
      });
      for (let y = 0.35; y < height - 0.1; y += 0.5) roundedBox(root, [0.03, 0.03, p.depth], [x, y, 0], materials.machineBlue, 'Frame brace', 0.005);
    }
    decksOf(p).forEach((deckY, i) => {
      [-1, 1].forEach((side) => roundedBox(root, [p.length, 0.1, 0.05], [0, deckY - 0.05, side * p.depth / 2], materials.gantryOrange, `Step beam ${i + 1}`, 0.008));
      roundedBox(root, [p.length - 0.04, 0.02, p.depth - 0.02], [0, deckY - 0.01, 0], materials.aluminium, `Wire deck ${i + 1}`, 0.004);
    });
    return { root, motions: {} };
  },
});
