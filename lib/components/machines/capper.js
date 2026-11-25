// Multi-spindle servo capper in a stainless portal over a product conveyor, with an elevated
// vibratory cap feeder and gravity chute behind it. Port of the reference station-1
// CappingMachine.js. The capping head carries one chuck per spindle; each chuck holds a cap at
// its origin (the cap centre). Centred on the spindle row; heights follow the line's belt height.
//
// Hand-over: the chucks screw their caps onto the containers; an op then empties the chucks
// (`caps: empty`) and switches the container's own cap on, and the feeder loads fresh caps
// (`caps: loaded`, `capFeed` 0 → 1 slides them down into the jaws).
import * as THREE from 'three';
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, addMesh, box, cylinder, cylinderBetween, roundedBox } from '../../core/primitives.js';
import { createScrewCap } from '../../core/screwCap.js';
import { buildPortalFrame, buildCabinet, buildRoofBeacon, BEACON_MOTION, BEACON_HEIGHT, headXs } from './portalCommon.js';

const HALF_Z = 0.5;
// Cabinet underside above the belt: 1.19 m as the reference, higher only when a long stroke needs
// the room for the raised head (plate, servos).
const cabinetAboveBelt = (p) => Math.max(1.19, p.seatHeight + p.stroke + 0.53);
const CABINET_HEIGHT = 0.36;
const GUARD_ABOVE_BELT = 0.12;
const PLATE_Y = 0.42; // head plate centre above the cap centre
const CAP_FEED_OFFSET = 0.06; // a freshly fed cap waits this far up inside the chuck sleeve
const FEEDER = { x: 0.55, z: -1.25, bowlRadius: 0.28 };
const CAP_COLORS = { blue: 0x1f5ea8, yellow: 0xf5c600 };

const geometryOf = (p) => {
  const xs = headXs(p.heads, p.pitch);
  const maxAbs = Math.max(...xs.map(Math.abs));
  // Lift cylinders sit in the gaps next to the outer spindles (reference); with one or two
  // spindles there is no such gap, so they go outside them.
  const sorted = [...xs].sort((a, b) => a - b);
  const liftX = sorted.length > 2 ? (sorted[sorted.length - 1] + sorted[sorted.length - 2]) / 2 : maxAbs + 0.2;
  const plateHalf = Math.max(maxAbs + 0.1, 0.7);
  const halfX = Math.max(0.85, Math.max(plateHalf, liftX + 0.05) + 0.15);
  return { xs, liftX, plateHalf, halfX };
};

defineComponent({
  type: 'capper',
  category: 'machine',
  summary: 'Servo screw capper in a guarded portal over a belt conveyor: chucks screw caps onto container necks; vibratory cap feeder behind.',
  params: z.object({
    heads: z.number().int().min(1).max(8).default(4).describe('Number of capping spindles'),
    pitch: z.number().min(0.12).max(0.6).default(0.4).describe('Distance between spindles (m), the container pitch on the belt'),
    seatHeight: z.number().min(0.15).max(0.6).default(0.388).describe('Cap centre height above the belt when screwed on (m)'),
    stroke: z.number().min(0.1).max(0.35).default(0.26).describe('Head travel (m)'),
    capRadius: z.number().min(0.012).max(0.034).default(0.027).describe('Cap radius (m); the chuck takes up to 34 mm'),
    capHeight: z.number().min(0.01).max(0.05).default(0.032).describe('Cap height (m)'),
    capColor: z.enum(['blue', 'yellow']).default('blue').describe('Cap colour'),
  }),
  footprint: (p, ctx) => {
    const { halfX } = geometryOf(p);
    return {
      x: [-(halfX + 0.09), halfX + 0.09],
      z: [FEEDER.z - FEEDER.bowlRadius - 0.005, HALF_Z + 0.09],
      height: ctx.beltHeight + cabinetAboveBelt(p) + CABINET_HEIGHT + BEACON_HEIGHT,
    };
  },
  mount: 'overConveyor',
  ports: (p, ctx) => ({
    work: { position: [0, ctx.beltHeight, 0], direction: 'work', carries: 'batch' },
    ...Object.fromEntries(headXs(p.heads, p.pitch).map((x, i) => [`head${i + 1}`, { position: [x, ctx.beltHeight, 0], direction: 'work', carries: 'unit' }])),
  }),
  motions: {
    headTravel: { range: [0, 1] }, // 0 = raised, 1 = caps at seatHeight (screwed on)
    spin: { range: [0, 1], wrap: true, angle: 2 * Math.PI }, // chuck turn phase (0…1 = one turn)
    caps: { values: ['loaded', 'empty'], default: 'loaded' }, // a cap in every chuck, or none (handed over)
    capFeed: { range: [0, 1], default: 1 }, // 0 = fresh caps up in the sleeves, 1 = seated in the jaws
    beacon: BEACON_MOTION,
  },
  ops: ['cap'],
  // One bottle at a time: one spindle, at x = 0, over the bottle.
  singleUnit: { heads: 1 },
  build({ params, materials, beltHeight }) {
    const { stroke, seatHeight, capRadius, capHeight } = params;
    const { xs, liftX, plateHalf, halfX } = geometryOf(params);
    const cabinetBottom = beltHeight + cabinetAboveBelt(params);
    const cabinetTop = cabinetBottom + CABINET_HEIGHT;
    const seatY = beltHeight + seatHeight;
    const root = group(null, 'capper');
    buildPortalFrame(root, materials, { halfX, halfZ: HALF_Z, top: cabinetBottom, guardBottom: beltHeight + GUARD_ABOVE_BELT });
    buildCabinet(root, materials, { halfX, halfZ: HALF_Z, bottom: cabinetBottom, height: CABINET_HEIGHT, doors: [{ x: 0, width: Math.min(1.5, halfX * 2 - 0.2) }] });

    // Two pneumatic lift cylinders hanging from the cabinet.
    const lift = group(root, 'Lift cylinders');
    [-liftX, liftX].forEach((x) => {
      cylinder(lift, 0.045, 0.3, [x, cabinetBottom - 0.15, 0], materials.aluminium, 'Cylinder barrel', { segments: 24 });
      cylinder(lift, 0.05, 0.03, [x, cabinetBottom - 0.3, 0], materials.frameDark, 'Cylinder end cap', { segments: 24 });
    });

    // Moving capping head; its origin is the cap centre.
    const head = group(root, 'Capping head', [0, seatY + stroke, 0]);
    roundedBox(head, [plateHalf * 2, 0.06, 0.22], [0, PLATE_Y, 0], materials.stainless, 'Head plate', 0.015);
    [-liftX, liftX].forEach((x) => cylinder(head, 0.018, 0.45, [x, PLATE_Y + 0.03 + 0.225, 0], materials.chrome, 'Piston rod', { segments: 16 }));

    const capMaterial = new THREE.MeshStandardMaterial({ color: CAP_COLORS[params.capColor], metalness: 0.05, roughness: 0.4 });
    capMaterial.name = 'cap';
    const makeCap = () => createScrewCap({ radius: capRadius, height: capHeight, material: capMaterial });
    const chucks = xs.map((x, i) => {
      const spindle = group(head, `Spindle ${i + 1}`, [x, 0, 0]);
      cylinder(spindle, 0.036, 0.14, [0, PLATE_Y + 0.1, 0], materials.frameDark, 'Servo motor', { segments: 24 });
      cylinder(spindle, 0.038, 0.02, [0, PLATE_Y + 0.17, 0], materials.brushed, 'Encoder cover', { segments: 24 });
      // The shaft reaches into the chuck sleeve (the reference's stopped 8 mm above it).
      cylinder(spindle, 0.012, PLATE_Y - 0.07, [0, (PLATE_Y + 0.07) / 2, 0], materials.chrome, 'Spindle shaft', { segments: 16 });
      const chuck = group(spindle, `Chuck ${i + 1}`);
      cylinder(chuck, 0.036, 0.09, [0, 0.037, 0], materials.stainless, 'Chuck sleeve', { segments: 28 });
      addMesh(chuck, new THREE.TorusGeometry(0.033, 0.005, 8, 28).rotateX(Math.PI / 2), materials.rubber, 'Grip insert', [0, -0.006, 0]);
      box(chuck, [0.01, 0.06, 0.074], [0, 0.045, 0], materials.brushed, 'Chuck flat'); // makes the turning visible
      const cap = makeCap();
      chuck.add(cap);
      return { chuck, cap };
    });

    // Cap supply: elevated vibratory bowl with a gravity chute into the back of the cabinet.
    const bowlY = cabinetTop - 0.07;
    const feeder = group(root, 'Cap feeder', [FEEDER.x, 0, FEEDER.z]);
    cylinder(feeder, 0.05, bowlY - 0.14, [0, (bowlY - 0.14) / 2, 0], materials.stainless, 'Feeder column', { segments: 20 });
    roundedBox(feeder, [0.4, 0.02, 0.4], [0, 0.01, 0], materials.brushed, 'Feeder base', 0.005);
    cylinder(feeder, 0.16, 0.14, [0, bowlY - 0.07, 0], materials.motor, 'Vibratory drive', { segments: 28 });
    const bowlProfile = [[0, 0], [0.24, 0], [0.27, 0.04], [0.28, 0.16], [0.27, 0.16], [0.26, 0.05], [0.23, 0.012], [0, 0.012]].map(([x, y]) => new THREE.Vector2(x, y));
    const bowlMaterial = materials.stainless.clone();
    bowlMaterial.side = THREE.DoubleSide;
    bowlMaterial.name = 'feeder bowl';
    addMesh(feeder, new THREE.LatheGeometry(bowlProfile, 40), bowlMaterial, 'Feeder bowl', [0, bowlY, 0]);
    for (let i = 0; i < 18; i += 1) {
      // Loose caps in the bowl: a fixed spiral, so every build looks the same.
      const angle = i * 2.4;
      const radius = 0.06 + (i % 6) * 0.03;
      const cap = makeCap();
      cap.name = `Bowl cap ${i + 1}`;
      cap.position.set(Math.cos(angle) * radius, bowlY + 0.012 + capHeight / 2 + (i % 3) * 0.012, Math.sin(angle) * radius);
      cap.rotation.set(i % 2 ? 0.3 : 0, angle, i % 3 ? 0.2 : 0);
      feeder.add(cap);
    }
    const chuteStart = [0.2, bowlY + 0.08, 0.18];
    const chuteEnd = [-FEEDER.x, cabinetTop - 0.02, -FEEDER.z - HALF_Z - 0.06];
    [-0.035, 0.035].forEach((offset) => {
      cylinderBetween(feeder, [chuteStart[0], chuteStart[1], chuteStart[2] + offset], [chuteEnd[0], chuteEnd[1], chuteEnd[2] + offset], 0.006, materials.stainless, 'Chute rail');
    });

    const setBeacon = buildRoofBeacon(root, materials, [halfX - 0.05, cabinetTop, HALF_Z - 0.05]);

    let feed = 1;
    return {
      root,
      motions: {
        headTravel(t) { head.position.y = seatY + stroke * (1 - t); },
        spin(v) { chucks.forEach(({ chuck }) => { chuck.rotation.y = v * 2 * Math.PI; }); },
        caps(v) { chucks.forEach(({ cap }) => { cap.visible = v === 'loaded'; }); },
        capFeed(v) {
          feed = v;
          chucks.forEach(({ cap }) => { cap.position.y = CAP_FEED_OFFSET * (1 - feed); });
        },
        beacon: setBeacon,
      },
    };
  },
});
