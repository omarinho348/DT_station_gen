// Floor-standing status monitor: base, column and a screen showing a generic dashboard (title,
// step, gauge bars, an optional heat-map grid, a checklist, a verdict banner, a footer line). Ported from the reference
// LineEquipment.createStatusMonitor; the reference ST4 screen (temperatures + bed mesh) is one
// way to fill the generic dashboard, so no station needs its own drawing code. Faces +Z.
import * as THREE from 'three';
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, addMesh, roundedBox } from '../../core/primitives.js';
import { liveCanvasTexture } from '../../core/textures.js';

const BEZEL = 0.04;
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const Dashboard = z.object({
  title: z.string().max(48),
  step: z.string().max(60).default(''),
  gauges: z.array(z.object({
    label: z.string().max(16),
    value: z.number(),
    target: z.number().positive(),
    unit: z.string().max(6).default(''),
    color: hex.default('#2fd0c6'),
  })).max(4).default([]),
  grid: z.object({
    label: z.string().max(24),
    cols: z.number().int().min(1).max(5),
    values: z.array(z.number().nullable()).max(25),
    range: z.tuple([z.number(), z.number()]).refine(([a, b]) => a < b, 'range: min must be < max'),
  }).nullable().default(null),
  /** Checklist lines that tick off as a check completes (vision / QC screens). */
  checks: z.array(z.object({
    label: z.string().max(40),
    value: z.string().max(12).default(''),
    state: z.enum(['pending', 'pass', 'fail']).default('pending'),
  })).max(8).default([]),
  verdict: z.enum(['PASS', 'REJECT']).nullable().default(null),
  footer: z.string().max(80).default(''),
});

const bezelHalf = (p) => (p.screenHeight + BEZEL) / 2;

defineComponent({
  type: 'statusMonitor',
  category: 'station',
  summary: 'Floor-standing status monitor with a live dashboard: title, step, gauge bars, heat-map grid, footer.',
  params: z.object({
    height: z.number().min(1).max(2).default(1.45).describe('Screen centre height (m)'),
    screenWidth: z.number().min(0.4).max(1.2).default(0.7).describe('Screen width (m)'),
    screenHeight: z.number().min(0.25).max(0.7).default(0.42).describe('Screen height (m)'),
  }),
  footprint: (p) => {
    const half = Math.max(0.18, (p.screenWidth + BEZEL) / 2);
    return { x: [-half, half], z: [-0.15, 0.15], height: p.height + bezelHalf(p) };
  },
  mount: 'floor',
  displays: {
    screen: {
      schema: Dashboard,
      sample: {
        title: 'TEST BENCH · SN 0001',
        step: 'Heat-up',
        gauges: [
          { label: 'Hotend', value: 182, target: 215, unit: '°C', color: '#e8661c' },
          { label: 'Bed', value: 54, target: 60, unit: '°C', color: '#e3a52b' },
        ],
        grid: { label: 'Bed mesh (µm)', cols: 3, values: [12, -8, 20, -30, 0, 14, 41, -22, 6], range: [-80, 80] },
        footer: 'Flatness 71 µm · Cube error 0.08 mm · Print 0 %',
      },
    },
  },
  build({ params, materials }) {
    const { height, screenWidth: sw, screenHeight: sh } = params;
    const root = group(null, 'statusMonitor');
    roundedBox(root, [0.36, 0.02, 0.3], [0, 0.01, 0], materials.brushed, 'Monitor base', 0.006);
    // Column up into the bezel (the reference column stopped 0.2 m under the screen centre, short
    // of small screens' bezels).
    const columnTop = height - bezelHalf(params) + 0.03;
    roundedBox(root, [0.08, columnTop, 0.08], [0, columnTop / 2, 0], materials.stainless, 'Monitor column', 0.01);
    const head = group(root, 'MonitorHead', [0, height, 0]);
    roundedBox(head, [sw + BEZEL, sh + BEZEL, 0.05], [0, 0, 0], materials.plasticBlack, 'Monitor bezel', 0.01);
    const live = liveCanvasTexture(768, Math.round((768 * sh) / sw));
    const screenMaterial = new THREE.MeshBasicMaterial({ map: live.texture, toneMapped: false });
    screenMaterial.name = 'monitor screen';
    addMesh(head, new THREE.PlaneGeometry(sw, sh), screenMaterial, 'Monitor screen', [0, 0, 0.03], { castShadow: false, receiveShadow: false });
    let lastKey = '';
    return {
      root,
      motions: {},
      displays: {
        screen(data) {
          const key = JSON.stringify(data);
          if (key === lastKey) return;
          lastKey = key;
          live.redraw((context, w, h) => drawDashboard(context, w, h, data));
        },
      },
    };
  },
});

/** Generic dashboard; layout from the reference ST4 test monitor. */
function drawDashboard(context, width, height, data) {
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  context.fillStyle = '#0d171e';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#16303f';
  context.fillRect(0, 0, width, 56);
  context.fillStyle = '#d6e4ec';
  context.font = 'bold 28px Arial, sans-serif';
  context.fillText(data.title, 18, 38);
  context.font = '24px Arial, sans-serif';
  context.fillStyle = '#9fb4c0';
  context.fillText(data.step || '—', 18, 92);

  const gridWidth = data.grid ? data.grid.cols * 64 + 30 : 0;
  // Bar + "value / target unit" text (~170 px) must end before the grid.
  const barWidth = Math.max(120, width - gridWidth - 320);
  data.gauges.forEach((g, index) => {
    const y = 130 + index * 58;
    context.fillStyle = '#7f95a2';
    context.fillText(g.label, 18, y + 20);
    context.fillStyle = '#1b2c36';
    context.fillRect(120, y, barWidth, 26);
    context.fillStyle = g.color;
    context.fillRect(120, y, barWidth * THREE.MathUtils.clamp(g.value / g.target, 0, 1), 26);
    context.fillStyle = '#e6eef2';
    context.fillText(`${Math.round(g.value)} / ${g.target} ${g.unit}`.trim(), 134 + barWidth, y + 20);
  });

  if (data.grid) {
    const { cols, values, range, label } = data.grid;
    const cell = 64;
    const x0 = width - cell * cols - 30;
    const y0 = 110;
    context.fillStyle = '#7f95a2';
    context.fillText(label, x0, y0 - 14);
    values.forEach((value, index) => {
      const cx = x0 + (index % cols) * cell;
      const cy = y0 + Math.floor(index / cols) * cell;
      if (value === null) {
        context.fillStyle = '#1b2c36';
      } else {
        const t = THREE.MathUtils.clamp((value - range[0]) / (range[1] - range[0]), 0, 1);
        context.fillStyle = `rgb(${Math.round(60 + 190 * t)}, ${Math.round(150 - 40 * Math.abs(t - 0.5))}, ${Math.round(220 - 190 * t)})`;
      }
      context.fillRect(cx + 2, cy + 2, cell - 4, cell - 4);
      if (value !== null) {
        context.fillStyle = '#0d171e';
        context.font = 'bold 20px Arial, sans-serif';
        context.fillText(String(value), cx + 12, cy + 38);
        context.font = '24px Arial, sans-serif';
      }
    });
  }
  // Checklist below the gauges (reference ST5 vision screen).
  const checksTop = 128 + data.gauges.length * 58;
  const valueX = data.grid ? width - data.grid.cols * 64 - 130 : width - 150;
  context.font = '22px Arial, sans-serif';
  data.checks.forEach((c, index) => {
    const y = checksTop + index * 26;
    const done = c.state !== 'pending';
    context.fillStyle = c.state === 'fail' ? '#c8231d' : done ? '#2f9a4a' : '#1b2c36';
    context.fillRect(18, y - 16, 18, 18);
    context.fillStyle = done ? '#e6eef2' : '#5f7480';
    context.fillText(c.label, 46, y);
    context.fillText(done ? c.value : '…', valueX, y);
  });
  context.font = '24px Arial, sans-serif';
  context.fillStyle = '#e6eef2';
  context.fillText(data.footer, 18, height - 30);

  if (data.verdict) {
    context.fillStyle = data.verdict === 'PASS' ? '#2f9a4a' : '#c8231d';
    context.globalAlpha = 0.92;
    context.fillRect(width - 300, 64, 282, 50);
    context.globalAlpha = 1;
    context.fillStyle = '#ffffff';
    context.font = 'bold 36px Arial, sans-serif';
    context.textAlign = 'center';
    context.fillText(data.verdict, width - 159, 101);
    context.textAlign = 'left';
  }
}
