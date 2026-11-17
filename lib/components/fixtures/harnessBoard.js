// Harness board: a tilted board on two posts where cable harnesses are laid out, built and
// tested; the wires run between connectors and are held off the board by harness forks.
// Ported from the reference ST3 WiringEquipment.js (createHarnessBoard). Origin at floor,
// centre between the posts; the board faces +Z and leans back by `tilt`.
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, box, cylinder, roundedBox } from '../../core/primitives.js';

const WIRE_COLORS = ['cableBlack', 'cableRed', 'cableBlue', 'cableYellow', 'cableWhite']; // reference order
const POST = 0.05;
const PANEL = 0.03;
const STANDOFF = 0.02; // wire centre in front of the board face (reference: ~2.5 cm)
const WIRE_PITCH = 0.11;

defineComponent({
  type: 'harnessBoard',
  category: 'fixture',
  summary: 'Tilted harness board on two posts with cable harnesses laid between connectors on forks.',
  params: z.object({
    width: z.number().min(0.6).max(2.5).default(1.3).describe('Board width (m)'),
    boardHeight: z.number().min(0.4).max(1.2).default(0.8).describe('Board height (m)'),
    topHeight: z.number().min(1.1).max(2.2).default(1.5).describe('Height of the board top (m)'),
    tilt: z.number().min(0).max(0.4).default(0.15).describe('Lean back (rad)'),
    wires: z.number().int().min(0).max(8).default(5).describe('Harness wires laid out'),
  }).superRefine((p, ctx) => {
    if ((p.wires - 1) * WIRE_PITCH > p.boardHeight - 0.12) ctx.addIssue({ code: 'custom', path: ['wires'], message: 'too many wires for the board height' });
    if (p.topHeight - p.boardHeight < 0.3) ctx.addIssue({ code: 'custom', path: ['boardHeight'], message: 'board must end at least 0.3 m above the floor' });
  }),
  footprint: (p) => {
    const half = p.boardHeight / 2;
    // Tilted board: its corners reach back / forward by half·sin(tilt) plus the thickness.
    const reach = half * Math.sin(p.tilt) + PANEL + STANDOFF + 0.02;
    return { x: [-(p.width / 2 + POST / 2), p.width / 2 + POST / 2], z: [-Math.max(reach, POST / 2), Math.max(reach, POST / 2) + 0.02], height: p.topHeight };
  },
  mount: 'floor',
  build({ params, materials }) {
    const { width, boardHeight, topHeight, tilt, wires } = params;
    const root = group(null, 'harnessBoard');
    // The tilted panel's top front corner is the highest point: half-height·cos + half-thickness·sin.
    const centreY = topHeight - (boardHeight / 2) * Math.cos(tilt) - (PANEL / 2) * Math.sin(tilt);
    [-1, 1].forEach((side) => roundedBox(root, [POST, topHeight, POST], [side * (width / 2), topHeight / 2, 0], materials.frame, 'Board post', 0.006));
    const board = group(root, 'Board', [0, centreY, 0.02]); // reference: 2 cm in front of the posts' axis
    board.rotation.x = -tilt; // top leans back (−Z)
    // Fitted between the posts. (The reference board spanned the post centres; leaning back, its
    // upper half passed behind the posts and its lower half in front, so the posts cut through
    // its edges.)
    const panelWidth = width - POST;
    roundedBox(board, [panelWidth, boardHeight, PANEL], [0, 0, 0], materials.machineWhite, 'Harness board', 0.01);
    const face = PANEL / 2;
    const span = width * 0.77; // connector to connector (1.0 m on the 1.3 m board, as in the reference)
    for (let i = 0; i < wires; i += 1) {
      const y = -(wires - 1) * WIRE_PITCH / 2 + i * WIRE_PITCH;
      const wz = face + STANDOFF;
      box(board, [span, 0.006, 0.006], [0, y, wz], materials[WIRE_COLORS[i % WIRE_COLORS.length]], 'Harness on board');
      [-1, 1].forEach((s) => box(board, [0.02, 0.014, 0.012], [s * span / 2, y, wz + 0.005], materials.guide, 'Board connector'));
      // Harness forks hold the wire off the board (the reference wires floated in front of it).
      [-span / 4, 0, span / 4].forEach((x) => {
        cylinder(board, 0.003, STANDOFF + 0.003, [x, y - 0.006, face + (STANDOFF + 0.003) / 2], materials.chrome, 'Harness fork', { axis: 'z', segments: 8 });
      });
    }
    return { root, motions: {} };
  },
});
