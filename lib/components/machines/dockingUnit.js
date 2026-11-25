// Docking unit: a pneumatic cylinder on a floor stand pushes a power / data connector into the
// unit under test (end-of-line test benches). Ported from the reference ST4
// CalibrationEquipment.js (DockingUnit). Origin on the floor under the cylinder's back face; the
// plug extends along +Z.
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, box, cylinder, roundedBox } from '../../core/primitives.js';

const BODY = 0.12; // cylinder body cross-section
const HEAD = 0.03; // connector head depth

/** Body length from the stroke: long enough to hold the piston rod at both ends of travel. */
const bodyLength = (p) => p.stroke + 0.08;

defineComponent({
  type: 'dockingUnit',
  category: 'machine',
  summary: 'Pneumatic docking unit: a cylinder on a floor stand pushes a power/data connector into the unit under test.',
  params: z.object({
    axisHeight: z.number().min(0.5).max(1.6).default(1.0).describe('Connector height (m)'),
    stroke: z.number().min(0.05).max(0.5).default(0.3).describe('Plug stroke (m)'),
  }),
  footprint: (p) => ({ x: [-0.08, 0.08], z: [-0.16, bodyLength(p) + HEAD + p.stroke], height: p.axisHeight + BODY / 2 }),
  mount: 'floor',
  // The retracted connector face; the `plug` motion moves it `stroke` metres along +Z.
  ports: (p) => ({ connector: { position: [0, p.axisHeight, bodyLength(p) + HEAD], direction: 'work', carries: 'unit' } }),
  motions: (p) => ({ plug: { range: [0, p.stroke], default: 0 } }),
  // Fitted to the unit: the connector at its mid-height. The plug reaches into the line (+Z).
  fit: ({ unit, ctx }) => ({ axisHeight: Math.min(1.6, Math.max(0.5, Math.round((ctx.beltHeight + unit.size[1] / 2) * 1000) / 1000)) }),
  reach: () => ({ port: 'connector', motion: 'plug', toward: [0, 0, 1], param: 'stroke' }),
  recipes: {
    dock: {
      summary: 'Dock the connector into the unit, hold it for the test time, and pull it back',
      args: z.object({ seconds: z.number().min(0.5).max(600).default(4).describe('Time docked (s)') }),
      ops: ({ machine, args, spec, reachTo }) => [
        { op: 'move', machine, to: { plug: reachTo === null || reachTo === undefined ? spec.motions.plug.range[1] : Math.round(Math.min(spec.motions.plug.range[1], Math.max(0, reachTo)) * 1000) / 1000 }, seconds: 0.5, label: 'Connector docking', state: 'TESTING' },
        { op: 'wait', seconds: args.seconds, label: 'Docked · testing', state: 'TESTING' },
        { op: 'move', machine, to: { plug: 0 }, seconds: 0.4, label: 'Connector retracting', state: 'TESTING' },
      ],
    },
  },
  build({ params, materials }) {
    const { axisHeight, stroke } = params;
    const L = bodyLength(params);
    const root = group(null, 'dockingUnit');
    roundedBox(root, [0.16, 0.012, 0.16], [0, 0.006, 0.08], materials.frameDark, 'Dock foot', 0.004);
    const standTop = axisHeight - BODY / 2;
    box(root, [0.06, standTop, 0.06], [0, standTop / 2, 0.08], materials.frame, 'Dock stand');
    roundedBox(root, [BODY, BODY, L], [0, axisHeight, L / 2], materials.machineGrey, 'Dock cylinder', 0.01);
    // Supply cable out of the back of the cylinder, down to the floor.
    cylinder(root, 0.006, 0.14, [0.03, axisHeight + 0.02, -0.07], materials.cableBlack, 'Plug cable', { axis: 'z', segments: 8 });
    cylinder(root, 0.006, axisHeight + 0.02, [0.03, (axisHeight + 0.02) / 2, -0.14], materials.cableBlack, 'Plug cable drop', { segments: 8 });

    // Plug group origin = connector face; retracted, the head sits just in front of the body.
    const plug = group(root, 'Plug', [0, axisHeight, L + HEAD]);
    const rodLength = stroke + 0.05; // its back end stays inside the body at full stroke
    cylinder(plug, 0.012, rodLength, [0, 0, -HEAD - rodLength / 2], materials.chrome, 'Piston rod', { axis: 'z', segments: 12 });
    roundedBox(plug, [0.034, 0.02, HEAD], [0, 0, -HEAD / 2], materials.machineBlue, 'Connector head', 0.004);
    return { root, motions: { plug: (v) => { plug.position.z = L + HEAD + v; } } };
  },
});
