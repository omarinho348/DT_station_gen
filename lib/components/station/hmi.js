// Pedestal HMI: tilted stainless enclosure with a live process screen, start/stop buttons,
// key switch and E-stop. Faces +Z (the walkway). Ported from the reference ControlPanel.js;
// the screen is generic (title, state, step, rows, bar) instead of one drawing per station.
import * as THREE from 'three';
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, addMesh, cylinder, roundedBox } from '../../core/primitives.js';
import { liveCanvasTexture } from '../../core/textures.js';

const TILT = -0.32; // enclosure tilted back towards the operator (rad)

/** Colours for the generic cycle states; any other (work) state uses the accent colour. */
export const HMI_STATE_COLORS = Object.freeze({
  IDLE: '#f2a516',
  WAITING: '#f2a516',
  HOLDING: '#f2a516',
  INFEED: '#4fb3e8',
  OUTPUT: '#39c46a',
  ALARM: '#e8352b',
});
const WORK_COLOR = '#2fd0c6';

const Screen = z.object({
  title: z.string().max(48),
  state: z.string().max(24),
  step: z.string().max(60).default(''),
  rows: z.array(z.tuple([z.string().max(24), z.union([z.string().max(24), z.number()])])).max(6).default([]),
  bar: z.object({ fraction: z.number().min(0).max(1), label: z.string().max(60) }).nullable().default(null),
});

defineComponent({
  type: 'hmi',
  category: 'station',
  summary: 'Pedestal operator panel (HMI) with a live status screen, start/stop buttons, key switch and E-stop.',
  params: z.object({
    height: z.number().min(0.9).max(1.5).default(1.2).describe('Enclosure centre height (m)'),
  }),
  footprint: (p) => ({ x: [-0.31, 0.31], z: [-0.16, 0.18], height: p.height + 0.26 }),
  mount: 'floor',
  displays: {
    screen: {
      schema: Screen,
      sample: {
        title: 'STATION · STATUS',
        state: 'IDLE',
        step: 'Ready',
        rows: [['Conveyor', 'STOPPED'], ['Unit', '—'], ['Completed', 0], ['Cycles', 0]],
        bar: { fraction: 0, label: 'Speed 1×' },
      },
    },
  },
  build({ params, materials }) {
    const { height } = params;
    const root = group(null, 'hmi');
    roundedBox(root, [0.36, 0.02, 0.3], [0, 0.01, 0], materials.brushed, 'Pedestal base', 0.006);
    const columnTop = height - 0.2;
    roundedBox(root, [0.12, columnTop - 0.02, 0.12], [0, 0.02 + (columnTop - 0.02) / 2, 0], materials.stainless, 'Pedestal column', 0.02);

    const enclosure = group(root, 'HMIEnclosure', [0, height, 0]);
    enclosure.rotation.x = TILT;
    roundedBox(enclosure, [0.62, 0.46, 0.16], [0, 0, 0], materials.stainless, 'Enclosure', 0.025);
    roundedBox(enclosure, [0.5, 0.31, 0.012], [0, 0.04, 0.081], materials.plasticBlack, 'Screen bezel', 0.01);

    const live = liveCanvasTexture(640, 420);
    const screenMaterial = new THREE.MeshBasicMaterial({ map: live.texture, toneMapped: false });
    screenMaterial.name = 'hmi screen';
    addMesh(enclosure, new THREE.PlaneGeometry(0.46, 0.28), screenMaterial, 'HMI screen', [0, 0.04, 0.088], { castShadow: false, receiveShadow: false });

    const buttons = group(enclosure, 'Buttons', [0, -0.17, 0.08]);
    cylinder(buttons, 0.022, 0.016, [-0.18, 0, 0.008], materials.buttonGreen, 'Start button', { axis: 'z', segments: 20 });
    cylinder(buttons, 0.022, 0.016, [-0.1, 0, 0.008], materials.plasticBlack, 'Stop button', { axis: 'z', segments: 20 });
    cylinder(buttons, 0.018, 0.02, [-0.02, 0, 0.01], materials.brushed, 'Key switch', { axis: 'z', segments: 20 });
    roundedBox(buttons, [0.09, 0.09, 0.006], [0.16, 0, 0.003], materials.safetyYellow, 'E-stop collar', 0.01);
    cylinder(buttons, 0.012, 0.02, [0.16, 0, 0.014], materials.plasticBlack, 'E-stop stem', { axis: 'z', segments: 16 });
    const mushroom = addMesh(buttons, new THREE.SphereGeometry(0.03, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), materials.emergency, 'E-stop mushroom', [0.16, 0, 0.024]);
    mushroom.rotation.x = Math.PI / 2;
    mushroom.scale.y = 0.5;

    let lastKey = '';
    return {
      root,
      motions: {},
      displays: {
        screen(data) {
          const key = JSON.stringify(data);
          if (key === lastKey) return; // redraw only when the content changes
          lastKey = key;
          live.redraw((context, w, h) => drawScreen(context, w, h, data));
        },
      },
    };
  },
});

function drawScreen(context, width, height, data) {
  context.fillStyle = '#0d171e';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#16303f';
  context.fillRect(0, 0, width, 54);
  context.fillStyle = '#d6e4ec';
  context.font = 'bold 26px Arial, sans-serif';
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  context.fillText(data.title, 18, 36);

  context.fillStyle = HMI_STATE_COLORS[data.state] ?? WORK_COLOR;
  context.fillRect(18, 72, 12, 64);
  context.font = 'bold 46px Arial, sans-serif';
  context.fillText(data.state.replace(/_/g, ' '), 44, 118);
  context.fillStyle = '#9fb4c0';
  context.font = '24px Arial, sans-serif';
  context.fillText(data.step || '—', 44, 158);

  context.font = '22px Arial, sans-serif';
  data.rows.forEach(([label, value], index) => {
    const y = 204 + index * 34;
    context.fillStyle = '#7f95a2';
    context.fillText(label, 18, y);
    context.fillStyle = '#e6eef2';
    context.fillText(String(value), 250, y);
  });

  if (data.bar) {
    const barX = 18;
    const barY = height - 46;
    const barWidth = width - 36;
    context.fillStyle = '#1b2c36';
    context.fillRect(barX, barY, barWidth, 22);
    context.fillStyle = '#c98d16';
    context.fillRect(barX, barY, barWidth * data.bar.fraction, 22);
    context.fillStyle = '#d6e4ec';
    context.font = '18px Arial, sans-serif';
    context.fillText(data.bar.label, barX + 6, barY - 8);
  }
}
