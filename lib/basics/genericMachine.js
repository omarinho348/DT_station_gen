// Generic machine (Claude.md §6.6.5): the fallback for a machine nobody can build yet, neither from
// the catalog nor as a composite. An enclosure of the right size with the right ports, a roof sign
// with its name marked PLACEHOLDER, hazard-stripe trim, a small lamp tower and a progress bar, so
// the line still runs with the right footprint and timing (op `operate`) and nobody mistakes it
// for the real thing. checkFactory lists every one as a warning; the reviewer (Phase 7) reports it.
//
// Two shapes: `passThrough` (the conveyor runs through it: `input` / `output` ports at both ends,
// at belt height, and `work` in the middle) or a cabinet beside the line (one `work` port on its
// front face, +Z, at belt height). Origin at the floor under its centre.
// Motions: `state` (idle / run / wait / alarm: the lamps) and `progress` (0 … 1: the bar).
import * as THREE from 'three';
import { z } from 'zod';
import { defineComponent, registry } from '../registry.js';
import { group, box, cylinder, roundedBox } from '../core/primitives.js';
import { createLampMaterial, setLamp } from '../core/materials.js';
import { canvasTexture, textLabel } from '../core/textures.js';

const SIGN_H = 0.32; // roof sign board height
const SIGN_POST = 0.12;
const TOWER = 0.3; // lamp tower on the roof
const STRIPE = 0.08; // hazard band height under the roof edge
const LAMPS = [['alarm', 0xe8352b], ['wait', 0xf2a516], ['run', 0x39d353]];

const signTop = (p) => p.height + SIGN_POST + SIGN_H;

function hazardTexture() {
  return canvasTexture(256, 32, (c) => {
    c.fillStyle = '#f2b705';
    c.fillRect(0, 0, 256, 32);
    c.fillStyle = '#1b1f22';
    for (let x = -32; x < 256 + 32; x += 32) {
      c.beginPath();
      c.moveTo(x, 32); c.lineTo(x + 16, 32); c.lineTo(x + 32, 0); c.lineTo(x + 16, 0);
      c.fill();
    }
  }, { fallback: [242, 183, 5, 255] });
}

defineComponent({
  type: 'genericMachine',
  category: 'machine',
  summary: 'Placeholder for a machine not in the catalog: an enclosure with the right size, ports and timing, a PLACEHOLDER sign, lamps and a progress bar.',
  params: z.object({
    name: z.string().min(1).max(28).default('MACHINE').describe('What it stands for (on its sign)'),
    note: z.string().max(40).default('').describe('Second line on the sign'),
    length: z.number().min(0.6).max(6).default(1.6).describe('Along the flow, X (m)'),
    depth: z.number().min(0.6).max(3).default(1.2).describe('Across the flow, Z (m)'),
    height: z.number().min(1.0).max(3).default(1.9).describe('Roof height (m)'),
    passThrough: z.boolean().default(true).describe('The conveyor runs through it (else a cabinet beside the line with a work port on its front)'),
    carries: z.enum(['unit', 'batch', 'case', 'pallet']).default('unit').describe('What its ports take'),
  }),
  footprint: (p) => ({ x: [-p.length / 2, p.length / 2], z: [-p.depth / 2, p.depth / 2], height: Math.max(signTop(p), p.height + TOWER) }),
  mount: 'floor',
  ports: (p, ctx) => (p.passThrough
    ? {
      input: { position: [-p.length / 2, ctx.beltHeight, 0], direction: 'in', carries: p.carries },
      work: { position: [0, ctx.beltHeight, 0], direction: 'work', carries: p.carries },
      output: { position: [p.length / 2, ctx.beltHeight, 0], direction: 'out', carries: p.carries },
    }
    : { work: { position: [0, ctx.beltHeight, p.depth / 2], direction: 'work', carries: p.carries } }),
  motions: { state: { values: ['idle', 'run', 'wait', 'alarm'], default: 'idle' }, progress: { range: [0, 1], default: 0 } },
  recipes: {
    work: {
      summary: 'Work on the unit for a fixed time: run lamp on and the progress bar filling, then idle',
      args: z.object({
        seconds: z.number().min(0.5).max(3600).default(10).describe('Work time (s)'),
        task: z.string().min(1).max(60).default('Working').describe('What it does, shown on the HMI'),
      }),
      ops: ({ machine, args }) => [{ op: 'operate', machine, seconds: args.seconds, label: args.task }],
    },
  },
  build({ params: p, materials, beltHeight }) {
    const root = group(null, 'genericMachine');
    const hx = p.length / 2;
    const hz = p.depth / 2;
    if (p.passThrough) {
      // The housing is the basic enclosure, its openings sized for what passes.
      const housing = registry.buildComponent('enclosureFrame', {
        length: p.length,
        depth: p.depth,
        height: p.height,
        openingWidth: Math.min(p.depth - 0.16, Math.max(0.3, p.depth * 0.5)),
        openingTop: Math.min(p.height - 0.15, beltHeight + 0.45),
        color: 'machineWhite',
      }, { materials, beltHeight });
      housing.root.name = 'Housing';
      root.add(housing.root);
    } else {
      roundedBox(root, [p.length - 0.02, p.height - 0.04, p.depth - 0.02], [0, (p.height - 0.04) / 2, 0], materials.machineWhite, 'Cabinet', 0.01);
      box(root, [p.length, 0.04, p.depth], [0, p.height - 0.02, 0], materials.machineGrey, 'Cabinet roof');
    }
    // Outer faces the trim sits on: the enclosure's glass and end walls, or the cabinet's sides.
    const frontZ = p.passThrough ? hz - 0.019 : hz - 0.01;
    const endX = p.passThrough ? hx - 0.019 : hx - 0.01;
    if (!p.passThrough) {
      // The work window on the front, at belt height.
      box(root, [Math.min(0.6, p.length * 0.6), 0.3, 0.01], [0, beltHeight, frontZ + 0.005], materials.darkPanel, 'Work window');
    }
    // Hazard band round the top of the housing (just inside its outline, under the roof edge).
    const hazard = new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.6 });
    hazard.name = 'placeholder hazard band';
    const bandY = p.height - 0.04 - STRIPE / 2;
    for (const [side, size, pos] of [
      ['front', [2 * endX, STRIPE, 0.006], [0, bandY, frontZ + 0.003]],
      ['rear', [2 * endX, STRIPE, 0.006], [0, bandY, -frontZ - 0.003]],
      ['in', [0.006, STRIPE, 2 * frontZ], [-endX - 0.003, bandY, 0]],
      ['out', [0.006, STRIPE, 2 * frontZ], [endX + 0.003, bandY, 0]],
    ]) box(root, size, pos, hazard, `Hazard band ${side}`);
    // Roof sign: the name and PLACEHOLDER, readable from both sides (two faces back to back).
    const signW = Math.min(p.length * 0.8, 2.2);
    for (const side of [-1, 1]) box(root, [0.03, SIGN_POST, 0.03], [side * signW * 0.4, p.height + SIGN_POST / 2, 0], materials.frameDark, `Sign post ${side > 0 ? 'out' : 'in'}`);
    const label = new THREE.MeshStandardMaterial({
      map: textLabel({ width: 768, height: 128, background: '#1b1f22', color: '#f2b705', border: '#f2b705', lines: [
        { text: p.name.toUpperCase(), size: 54, y: 0.38 },
        { text: `PLACEHOLDER${p.note ? ` · ${p.note}` : ''}`, size: 30, y: 0.76, bold: false },
      ] }),
      roughness: 0.7,
    });
    label.name = 'placeholder sign';
    box(root, [signW, SIGN_H, 0.02], [0, p.height + SIGN_POST + SIGN_H / 2, 0], materials.frameDark, 'Sign board');
    for (const side of [-1, 1]) {
      const face = new THREE.Mesh(new THREE.PlaneGeometry(signW - 0.02, SIGN_H - 0.02), label);
      face.name = `Sign face ${side > 0 ? 'front' : 'rear'}`;
      face.position.set(0, p.height + SIGN_POST + SIGN_H / 2, side * 0.0105);
      face.rotation.y = side > 0 ? 0 : Math.PI;
      root.add(face);
    }
    // Lamp tower on the roof, rear outfeed corner.
    const tx = hx - 0.1;
    const tz = -hz + 0.1;
    cylinder(root, 0.03, TOWER - 0.012, [tx, p.height + (TOWER - 0.012) / 2, tz], materials.plasticBlack, 'Lamp core', { segments: 16 });
    const lamps = {};
    LAMPS.forEach(([key, color], i) => {
      lamps[key] = createLampMaterial(color);
      cylinder(root, 0.04, 0.07, [tx, p.height + TOWER - 0.047 - i * 0.075, tz], lamps[key], `Lamp ${key}`, { segments: 20 });
    });
    cylinder(root, 0.042, 0.012, [tx, p.height + TOWER - 0.006, tz], materials.plasticBlack, 'Lamp cap', { segments: 20 });
    // Progress bar on the front, under the hazard band.
    const barW = Math.min(0.5, p.length * 0.5);
    const barY = bandY - STRIPE / 2 - 0.06;
    box(root, [barW + 0.04, 0.06, 0.008], [0, barY, frontZ + 0.004], materials.darkPanel, 'Progress panel');
    const glow = createLampMaterial(0x2fd0c6);
    glow.name = 'progress';
    setLamp(glow, true, 1.2);
    const fill = group(root, 'Progress fill', [-barW / 2, barY, frontZ + 0.009]);
    const bar = box(fill, [1, 0.03, 0.002], [0.5, 0, 0], glow, 'Progress bar');
    return {
      root,
      motions: {
        state: (v) => LAMPS.forEach(([key]) => setLamp(lamps[key], v === key)),
        progress: (v) => { fill.scale.x = Math.max(1e-3, v) * barW; bar.visible = v > 0; },
      },
    };
  },
});
