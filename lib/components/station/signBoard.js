// Area sign: a board on a tall post, readable from both sides (raw materials, dispatch…). Port of
// the reference factory/SupplyRack.js (createSign). Origin on the floor at the post; the board faces
// ±Z.
import * as THREE from 'three';
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, addMesh, roundedBox } from '../../core/primitives.js';
import { canvasTexture } from '../../core/textures.js';

const POST = 0.07;
const ASPECT = 300 / 1024;

defineComponent({
  type: 'signBoard',
  category: 'station',
  summary: 'Area sign on a tall post, readable from both sides: title, subtitle and an accent bar.',
  params: z.object({
    title: z.string().min(1).max(28).default('RAW MATERIALS').describe('Title'),
    subtitle: z.string().max(40).default('').describe('Second line'),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#e0a521').describe('Accent bar colour'),
    height: z.number().min(1.5).max(4.5).default(3.1).describe('Post height (m)'),
    width: z.number().min(0.6).max(4).default(2.2).describe('Board width (m)'),
  }),
  footprint: (p) => ({ x: [-p.width / 2, p.width / 2], z: [-POST / 2 - 0.002, POST / 2 + 0.002], height: p.height + 0.05 + (p.width * ASPECT) / 2 }),
  mount: 'floor',
  motions: {},
  ops: [],
  build({ params: p, materials }) {
    const root = group(null, 'signBoard');
    const texture = canvasTexture(1024, 300, (ctx, w, h) => {
      ctx.fillStyle = '#16232b';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = p.accent;
      ctx.fillRect(0, 0, 18, h);
      ctx.fillStyle = '#eef3f5';
      ctx.font = 'bold 92px Arial, sans-serif';
      ctx.fillText(p.title, 52, 140);
      ctx.fillStyle = '#9fb4c0';
      ctx.font = '54px Arial, sans-serif';
      ctx.fillText(p.subtitle, 52, 232);
    }, { fallback: [22, 35, 43, 255] });
    const face = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.6, metalness: 0.1 });
    face.name = 'sign face';
    roundedBox(root, [POST, p.height, POST], [0, p.height / 2, 0], materials.frame, 'Sign post', 0.01);
    // Two faces back to back on the post (the reference used one double-sided plane, mirrored from
    // behind, 5 mm off the post).
    const geometry = new THREE.PlaneGeometry(p.width, p.width * ASPECT);
    const y = p.height + 0.05;
    addMesh(root, geometry, face, 'Sign board front', [0, y, POST / 2 + 0.002], { castShadow: false }); // 2 mm off the post: no z-fighting with it
    const back = addMesh(root, geometry, face, 'Sign board back', [0, y, -POST / 2 - 0.002], { castShadow: false });
    back.rotation.y = Math.PI;
    return { root, motions: {} };
  },
});
