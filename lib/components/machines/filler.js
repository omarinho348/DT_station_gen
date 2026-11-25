// Multi-head volumetric filler in a stainless portal over a product conveyor. Port of the reference
// station-1 FillingMachine.js. The filling head (manifold, valves and nozzles) rides a vertical
// pneumatic actuator, so all nozzles move together. Centred on the nozzle row (x = 0 between the
// outer heads, z = 0 the conveyor centre line); all heights follow the line's belt height.
import * as THREE from 'three';
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, addMesh, cylinder, roundedBox } from '../../core/primitives.js';
import { buildPortalFrame, buildCabinet, buildRoofBeacon, BEACON_MOTION, BEACON_HEIGHT, headXs } from './portalCommon.js';

const HALF_Z = 0.5;
// Cabinet underside above the belt: 1.19 m as the reference (2.05 m at belt 0.86), higher only when
// a long stroke needs the room for the raised head (clevis and rod in the actuator barrel).
const cabinetAboveBelt = (p) => Math.max(1.19, p.tipHeight + p.stroke + 0.57);
const CABINET_HEIGHT = 0.32;
const GUARD_ABOVE_BELT = 0.12;
const MANIFOLD_Y = 0.3; // manifold centre above the nozzle tips
const STREAM_RADIUS = 0.0055;
const MAX_JET = 0.6;

const halfSpanOf = (p) => Math.max(0.3, Math.max(...headXs(p.heads, p.pitch).map(Math.abs)) + 0.14);
const halfXOf = (p) => Math.max(0.95, halfSpanOf(p) + 0.21);

defineComponent({
  type: 'filler',
  category: 'machine',
  summary: 'Volumetric multi-head filler in a guarded portal over a belt conveyor: nozzles dive into container necks and dispense.',
  params: z.object({
    heads: z.number().int().min(1).max(8).default(4).describe('Number of filling heads'),
    pitch: z.number().min(0.12).max(0.6).default(0.4).describe('Distance between heads (m), the container pitch on the belt'),
    tipHeight: z.number().min(0.26).max(0.45).default(0.353).describe('Nozzle tip height above the belt when lowered (m): neck rim minus insertion'),
    stroke: z.number().min(0.1).max(0.35).default(0.25).describe('Head travel (m)'),
  }),
  footprint: (p, ctx) => ({
    x: [-(halfXOf(p) + 0.09), halfXOf(p) + 0.09],
    z: [-(HALF_Z + 0.09), HALF_Z + 0.09],
    height: ctx.beltHeight + cabinetAboveBelt(p) + CABINET_HEIGHT + BEACON_HEIGHT,
  }),
  mount: 'overConveyor',
  // work: the batch under the machine; head<i>: the nozzle axis at belt height (a container's neck goes here).
  ports: (p, ctx) => ({
    work: { position: [0, ctx.beltHeight, 0], direction: 'work', carries: 'batch' },
    ...Object.fromEntries(headXs(p.heads, p.pitch).map((x, i) => [`head${i + 1}`, { position: [x, ctx.beltHeight, 0], direction: 'work', carries: 'unit' }])),
  }),
  motions: {
    headTravel: { range: [0, 1] }, // 0 = raised, 1 = tips lowered to tipHeight (inside the necks)
    jetStart: { range: [0, MAX_JET] }, // top of the oil stream below the tips (m): grows as the last oil falls after the valves close
    jetEnd: { range: [0, MAX_JET] }, // bottom of the stream below the tips (m): the oil surface while dispensing; no stream when ≤ jetStart
    beacon: BEACON_MOTION,
  },
  ops: ['fill'],
  // One bottle at a time: one nozzle, at x = 0, over the bottle (4 heads miss a single bottle).
  singleUnit: { heads: 1 },
  // Where hoses land: on the moving manifold, on the cabinet underside, and the rear supply inlet.
  // tip: the nozzle tips (the head's origin), where the oil streams start.
  anchors: ['tip', 'productInlet', 'airInlet', 'productBulkhead', 'airBulkhead', 'rearInlet'],
  build({ params, materials, beltHeight }) {
    const { heads, pitch, tipHeight, stroke } = params;
    const halfX = halfXOf(params);
    const halfSpan = halfSpanOf(params);
    const cabinetBottom = beltHeight + cabinetAboveBelt(params);
    const tipLowered = beltHeight + tipHeight;
    const root = group(null, 'filler');
    buildPortalFrame(root, materials, { halfX, halfZ: HALF_Z, top: cabinetBottom, guardBottom: beltHeight + GUARD_ABOVE_BELT });
    buildCabinet(root, materials, { halfX, halfZ: HALF_Z, bottom: cabinetBottom, height: CABINET_HEIGHT, doors: [{ x: -0.5, width: 0.9 }, { x: 0.5, width: 0.9 }].map((d) => ({ x: d.x * halfX / 0.95, width: d.width * halfX / 0.95 })) });

    // Vertical actuator: fixed barrel and guide bushings under the cabinet.
    const guideX = Math.min(0.6, halfSpan - 0.06);
    const actuator = group(root, 'Vertical actuator');
    roundedBox(actuator, [0.11, 0.42, 0.11], [0, cabinetBottom - 0.21, 0], materials.aluminium, 'Actuator barrel', 0.02);
    roundedBox(actuator, [0.13, 0.03, 0.13], [0, cabinetBottom - 0.43, 0], materials.frameDark, 'Rod-end cap', 0.008);
    [-guideX, guideX].forEach((x) => cylinder(actuator, 0.03, 0.09, [x, cabinetBottom - 0.045, 0], materials.frameDark, 'Linear bushing', { segments: 20 }));

    // Moving filling head; its origin is the nozzle tip height.
    const head = group(root, 'Filling head', [0, tipLowered + stroke, 0]);
    roundedBox(head, [halfSpan * 2, 0.09, 0.12], [0, MANIFOLD_Y, 0], materials.stainless, 'Product manifold', 0.02);
    roundedBox(head, [0.16, 0.04, 0.16], [0, MANIFOLD_Y + 0.065, 0], materials.brushed, 'Actuator clevis', 0.01);
    cylinder(head, 0.02, 0.55, [0, MANIFOLD_Y + 0.045 + 0.275, 0], materials.chrome, 'Piston rod', { segments: 20 });
    [-guideX, guideX].forEach((x) => {
      cylinder(head, 0.016, 0.5, [x, MANIFOLD_Y + 0.045 + 0.25, 0], materials.chrome, 'Guide shaft', { segments: 16 });
      roundedBox(head, [0.07, 0.03, 0.07], [x, MANIFOLD_Y + 0.06, 0], materials.brushed, 'Guide clamp', 0.008);
    });
    const productInlet = group(head, 'Product inlet', [-halfSpan - 0.01, MANIFOLD_Y, 0]);
    cylinder(productInlet, 0.026, 0.04, [0, 0, 0], materials.brushed, 'Inlet fitting', { axis: 'x', segments: 20 });
    const airInlet = group(head, 'Air inlet', [halfSpan - 0.04, MANIFOLD_Y + 0.045, 0.03]);
    cylinder(airInlet, 0.01, 0.03, [0, 0.01, 0], materials.brushed, 'Air manifold fitting', { segments: 12 });

    // Oil: one stream material per machine (the shared library has no liquids).
    const oil = new THREE.MeshPhysicalMaterial({ color: 0xd49a1c, emissive: 0x3a2200, metalness: 0, roughness: 0.06, clearcoat: 1 });
    oil.name = 'oil stream';
    const streamGeometry = new THREE.CylinderGeometry(STREAM_RADIUS, STREAM_RADIUS * 0.8, 1, 12, 1, true).translate(0, -0.5, 0);
    const splashGeometry = new THREE.TorusGeometry(0.018, 0.003, 6, 24).rotateX(Math.PI / 2);
    const jets = headXs(heads, pitch).map((x, i) => {
      const nozzle = group(head, `Nozzle ${i + 1}`, [x, 0, 0]);
      cylinder(nozzle, 0.0085, 0.165, [0, 0.0825, 0], materials.stainless, 'Nozzle tube', { radiusBottom: 0.0075, segments: 16 });
      cylinder(nozzle, 0.013, 0.018, [0, 0.165, 0], materials.brushed, 'Nozzle collar', { segments: 6 });
      cylinder(nozzle, 0.026, 0.09, [0, 0.21, 0], materials.stainless, 'Valve body', { segments: 24 });
      cylinder(nozzle, 0.016, 0.055, [0, 0.215, 0.05], materials.brushed, 'Valve actuator', { axis: 'z', segments: 16 });
      cylinder(nozzle, 0.006, 0.02, [0, 0.215, 0.085], materials.airLine, 'Air fitting', { axis: 'z', segments: 10 });
      const stream = addMesh(nozzle, streamGeometry, oil, 'Oil stream', [0, 0, 0], { castShadow: false });
      stream.renderOrder = 1;
      const splash = addMesh(nozzle, splashGeometry, oil, 'Oil splash', [0, 0, 0], { castShadow: false });
      return { stream, splash };
    });

    // Fixed hose bulkheads on the cabinet underside; the rigid supply enters the cabinet at the rear.
    const productBulkhead = group(root, 'Product bulkhead', [-halfSpan - 0.06, cabinetBottom - 0.02, -0.08]);
    cylinder(productBulkhead, 0.03, 0.04, [0, 0, 0], materials.brushed, 'Bulkhead fitting', { segments: 20 });
    const airBulkhead = group(root, 'Air bulkhead', [halfSpan + 0.02, cabinetBottom - 0.015, -0.05]);
    cylinder(airBulkhead, 0.012, 0.03, [0, 0, 0], materials.brushed, 'Air bulkhead', { segments: 12 });
    const rearInlet = group(root, 'Rear inlet', [-0.4, cabinetBottom + 0.16, -(HALF_Z + 0.06)]);

    const setBeacon = buildRoofBeacon(root, materials, [halfX - 0.05, cabinetBottom + CABINET_HEIGHT, HALF_Z - 0.05]);

    // Flexible hoses from the cabinet bulkheads down to the moving manifold (product and air), as
    // spline tubes rebuilt whenever the head moves (reference OilHoses.addFlexible, same shapes).
    const hoses = [
      { name: 'Product hose', from: productBulkhead, to: productInlet, radius: 0.019, material: materials.hose, sag: [-0.2, 0, 0], start: [0, -0.14, 0], end: [-0.14, 0, 0] },
      { name: 'Pneumatic line', from: airBulkhead, to: airInlet, radius: 0.007, material: materials.airLine, sag: [0.16, 0, 0], start: [0, -0.1, 0], end: [0, 0.1, 0] },
    ].map((h) => ({ ...h, mesh: addMesh(root, new THREE.BufferGeometry(), h.material, h.name) }));
    const layHoses = () => {
      for (const h of hoses) {
        const a = h.from.position.clone();
        const b = h.to.position.clone().add(head.position); // the inlets ride on the head
        const v = (p) => new THREE.Vector3(...p);
        const curve = new THREE.CatmullRomCurve3([a, a.clone().add(v(h.start)), a.clone().lerp(b, 0.5).add(v(h.sag)), b.clone().add(v(h.end)), b], false, 'centripetal');
        h.mesh.geometry.dispose();
        h.mesh.geometry = new THREE.TubeGeometry(curve, 48, h.radius, 10, false);
      }
    };

    let jetStart = 0;
    let jetEnd = 0;
    const showJets = () => {
      const length = jetEnd - jetStart;
      const streamOn = length > 0.002;
      const splashOn = streamOn && jetEnd > 0.02 && jetStart < jetEnd - 0.02;
      jets.forEach(({ stream, splash }) => {
        stream.visible = streamOn;
        splash.visible = splashOn;
        if (streamOn) {
          stream.position.y = -jetStart;
          stream.scale.set(1, length, 1);
        }
        if (splashOn) splash.position.y = -jetEnd + 0.002;
      });
    };

    return {
      root,
      anchors: { tip: head, productInlet, airInlet, productBulkhead, airBulkhead, rearInlet },
      motions: {
        headTravel(t) { head.position.y = tipLowered + stroke * (1 - t); layHoses(); },
        jetStart(v) { jetStart = v; showJets(); },
        jetEnd(v) { jetEnd = v; showJets(); },
        beacon: setBeacon,
      },
    };
  },
});
