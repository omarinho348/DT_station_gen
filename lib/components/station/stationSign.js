// Overhead station sign: code and function on a double-sided panel on two posts.
// Ported from the reference LineEquipment.createStationSign. The panel is ONE box whose front and
// back faces carry the text texture: a separate text plane 1 mm in front of a frame flickered
// (z-fighting) at viewing distance in the reference's earlier version.
import * as THREE from 'three';
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, cylinder } from '../../core/primitives.js';
import { canvasTexture } from '../../core/textures.js';

const PANEL_HEIGHT = 0.46;
const PANEL_DEPTH = 0.04;

defineComponent({
  type: 'stationSign',
  category: 'station',
  summary: 'Overhead double-sided station sign with the station code and function, on two posts.',
  params: z.object({
    code: z.string().min(1).max(4).default('ST1').describe('Station code'),
    title: z.string().min(1).max(40).default('Station').describe('Function'),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#2c5d8f').describe('Colour (#rrggbb)'),
    width: z.number().min(1.2).max(3).default(2).describe('Panel width (m)'),
    height: z.number().min(2.2).max(4).default(3.1).describe('Panel centre height (m)'),
    // Smaller signs (e.g. a reject bay) are the same sign scaled down, as in the reference.
    scale: z.number().min(0.4).max(1).default(1).describe('Overall scale'),
  }),
  footprint: (p) => ({
    x: [-p.scale * p.width / 2, p.scale * p.width / 2],
    z: [-p.scale * 0.06, p.scale * PANEL_DEPTH / 2],
    height: p.scale * (p.height + PANEL_HEIGHT / 2),
  }),
  mount: 'floor',
  build({ params, materials }) {
    const { code, title, color, width, height } = params;
    const root = group(null, 'stationSign');
    const body = group(root, 'Sign body');
    body.scale.setScalar(params.scale);
    const texture = canvasTexture(1024, 236, (context, w, h) => drawSign(context, w, h, code, title, color), { fallback: [244, 246, 248, 255] });
    texture.anisotropy = 8;
    const face = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.6 });
    const edge = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.2 });
    face.name = 'sign face';
    edge.name = 'sign edge';
    // BoxGeometry material order: +X, −X, +Y, −Y, +Z (front), −Z (back). The back face's UVs read
    // correctly from behind, so the same texture works on both sides.
    const panel = new THREE.Mesh(new THREE.BoxGeometry(width, PANEL_HEIGHT, PANEL_DEPTH), [edge, edge, edge, edge, face, face]);
    panel.name = 'Sign panel';
    panel.position.y = height;
    panel.castShadow = true;
    body.add(panel);
    const postHeight = height - PANEL_HEIGHT / 2;
    [-1, 1].forEach((side) => cylinder(body, 0.025, postHeight, [side * (width / 2 - 0.1), postHeight / 2, -0.035], materials.frame, 'Sign post', { segments: 12 }));
    return { root, motions: {} };
  },
});

function drawSign(context, w, h, code, title, color) {
  context.fillStyle = color;
  context.fillRect(0, 0, w, h);
  context.fillStyle = '#f4f6f8';
  context.fillRect(14, 14, w - 28, h - 28);
  context.fillStyle = color;
  context.fillRect(14, 14, 150, h - 28);
  context.fillStyle = '#ffffff';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = 'bold 84px Arial, sans-serif';
  context.fillText(code, 89, h / 2 + 4);
  context.fillStyle = '#15212b';
  let size = 76;
  const text = title.toUpperCase();
  context.font = `bold ${size}px Arial, sans-serif`;
  const room = w - 164 - 50;
  const measured = context.measureText(text).width;
  if (measured > room) {
    size = Math.floor((size * room) / measured);
    context.font = `bold ${size}px Arial, sans-serif`;
  }
  context.fillText(text, 164 + (w - 164) / 2, h / 2 + 4);
}
