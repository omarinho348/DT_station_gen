// Basic transport: an AGV (automated guided vehicle) with a roller deck at belt height, so it
// docks at a conveyor end and a unit rolls on or off. Origin at the floor under its centre; it
// drives along +X (a line moves it between stations; its own motions are the deck and the light).
//
// Ports `input` (−X) and `output` (+X) at the deck ends and `deck` (the middle, where a unit rides).
// Motions: `rollers` (deck turn phase) and `light` (off / run / wait: the status light strip).
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, box, cylinder, roundedBox } from '../../core/primitives.js';
import { createLampMaterial, setLamp } from '../../core/materials.js';
import { buildRollerBed, ROLLER_MOTION } from './rollerBed.js';
import { frameColor } from '../frames/common.js';

const WHEEL = 0.07; // wheel radius
const CHASSIS = 0.26; // chassis height above the floor (top)

defineComponent({
  type: 'agvCart',
  category: 'transport',
  summary: 'Basic AGV: a driverless cart with a roller deck at belt height that docks at conveyors; status light strip.',
  params: z.object({
    length: z.number().min(0.6).max(2.0).default(1.0).describe('Along its drive direction, X (m)'),
    width: z.number().min(0.4).max(1.4).default(0.7).describe('Across, Z (m)'),
    color: frameColor('safetyYellow'),
  }),
  footprint: (p, ctx) => ({ x: [-p.length / 2, p.length / 2], z: [-p.width / 2, p.width / 2], height: ctx.beltHeight }),
  mount: 'floor',
  ports: (p, ctx) => ({
    input: { position: [-p.length / 2, ctx.beltHeight, 0], direction: 'in', carries: 'unit' },
    output: { position: [p.length / 2, ctx.beltHeight, 0], direction: 'out', carries: 'unit' },
    deck: { position: [0, ctx.beltHeight, 0], direction: 'work', carries: 'unit' },
  }),
  motions: { rollers: ROLLER_MOTION, light: { values: ['off', 'run', 'wait'] } },
  build({ params: p, materials, beltHeight }) {
    const root = group(null, 'agvCart');
    // Wheels in wheel wells, touching the floor.
    for (const [i, [x, z]] of [[-1, -1], [1, -1], [-1, 1], [1, 1]].entries()) {
      cylinder(root, WHEEL, 0.05, [x * (p.length / 2 - 0.14), WHEEL, z * (p.width / 2 - 0.08)], materials.rubber, `Wheel ${i + 1}`, { axis: 'z', segments: 18 });
    }
    roundedBox(root, [p.length, CHASSIS - WHEEL, p.width], [0, WHEEL + (CHASSIS - WHEEL) / 2, 0], materials[p.color], 'Chassis', 0.02);
    box(root, [p.length * 0.98, 0.02, 0.01], [0, CHASSIS - 0.06, p.width / 2 - 0.006], materials.frameDark, 'Bumper strip front');
    const strip = createLampMaterial(0x2fd0c6);
    strip.name = 'agv status';
    box(root, [0.01, 0.03, p.width * 0.6], [p.length / 2 - 0.006, CHASSIS - 0.04, 0], strip, 'Status light');
    box(root, [0.06, 0.03, 0.06], [-p.length / 2 + 0.08, CHASSIS + 0.015, -p.width / 2 + 0.08], materials.plasticBlack, 'Safety scanner');
    // Deck lifter: a column from the chassis up to the roller deck.
    const deckBottom = beltHeight - 0.11;
    box(root, [p.length * 0.5, deckBottom - CHASSIS, p.width * 0.5], [0, CHASSIS + (deckBottom - CHASSIS) / 2, 0], materials.frameDark, 'Deck column');
    box(root, [p.length - 0.06, 0.02, p.width - 0.06], [0, deckBottom + 0.01, 0], materials.frameDark, 'Deck plate');
    const deck = group(root, 'Roller deck', [0, beltHeight, 0]);
    const rollers = buildRollerBed(deck, materials, { length: p.length - 0.04, width: p.width - 0.08, frameMaterial: materials.frameDark, name: 'Deck' });
    const colours = { off: null, run: 0x2fd0c6, wait: 0xf0b429 };
    const setLight = (v) => {
      if (colours[v]) { strip.color.setHex(colours[v]); strip.emissive.setHex(colours[v]); }
      setLamp(strip, v !== 'off', 1.6);
    };
    setLight('off');
    return { root, motions: { rollers: rollers.setPhase, light: setLight } };
  },
});
