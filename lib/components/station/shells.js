// Station shells: furniture presets a station names in factory.json (`shell: { type, params }`).
// Lives with the components because it names them; the compiler only calls registry.expandShell.
import { z } from 'zod';
import { defineShell } from '../../registry.js';

// Reference assembly cell (createStationShell + StationBase from the reference printer line):
// slab with boundary and walkway lines, rear guard fence, twin-strand pallet conveyor with work
// stop, return-line lifts at both ports, station sign behind the conveyor, HMI pedestal on the
// walkway and stack light at the exit corner. Station-local frame: flow +X, conveyor at z = 0.
defineShell({
  type: 'assemblyCell',
  summary: 'Reference assembly cell: slab, rear fence, pallet conveyor with work stop and return-line lifts, sign, HMI, stack light.',
  params: z.object({
    code: z.string().min(1).max(4).describe('Station code on the sign, e.g. ST2'),
    title: z.string().min(1).max(40).describe('Station function on the sign'),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#2c5d8f').describe('Sign colour'),
    minZ: z.number().min(-4).max(-0.8).default(-1.5).describe('Rear edge of the slab (m); deeper cells for bigger machines'),
    maxZ: z.number().min(1.2).max(3).default(1.6).describe('Front edge of the slab (m)'),
    walkwayZ: z.number().min(0.6).max(2).default(1.05).describe('Walkway line (m)'),
    panelX: z.number().min(-2.2).max(2.2).default(-1.55).describe('HMI position along the line (m)'),
    conveyorLength: z.number().min(2.4).max(8).default(4.4).describe('Station conveyor length (m)'),
    carrierLength: z.number().min(0.4).max(1.6).default(1.2).describe('Work carrier length (m)'),
  }).refine((p) => p.walkwayZ < p.maxZ - 0.2, { message: 'walkwayZ must be at least 0.2 m inside maxZ', path: ['walkwayZ'] }),
  // Deeper at the rear: the slab edge, fence and sign move back. Front: the slab edge moves out.
  deepen(p, { side, by }) {
    const r = (v) => Math.round(v * 100) / 100;
    if (side === 'rear') {
      const minZ = r((p.minZ ?? -1.5) - Math.ceil(by * 100) / 100);
      return minZ >= -4 ? { ...p, minZ } : null;
    }
    const maxZ = r((p.maxZ ?? 1.6) + Math.ceil(by * 100) / 100);
    return maxZ <= 3 ? { ...p, maxZ } : null;
  },
  build(p) {
    const half = p.conveyorLength / 2 + 0.15; // slab half-length: 2.35 for the reference 4.4 m conveyor
    const depth = p.maxZ - p.minZ;
    const port = (p.conveyorLength - p.carrierLength) / 2; // carrier centre at the ports (±1.6)
    return {
      equipment: [
        { id: 'slab', type: 'floorSlab', params: { length: 2 * half, depth, walkway: (p.walkwayZ - p.minZ) / depth }, position: [0, 0, (p.minZ + p.maxZ) / 2] },
        { id: 'fence', type: 'guardFence', params: { length: 2 * half - 0.6 }, position: [0, 0, p.minZ + 0.25] },
        { id: 'line', type: 'palletConveyor', params: { length: p.conveyorLength, carrierLength: p.carrierLength, workStop: true }, position: [0, 0, 0] },
        { id: 'liftIn', type: 'liftUnit', params: {}, position: [-port, 0, 0] },
        { id: 'liftOut', type: 'liftUnit', params: {}, position: [port, 0, 0] },
        { id: 'sign', type: 'stationSign', params: { code: p.code, title: p.title, color: p.color }, position: [0, 0, p.minZ + 0.45] },
        { id: 'panel', type: 'hmi', params: {}, position: [p.panelX, 0, 0.95], rotationY: 0.3 },
        { id: 'beacon', type: 'stackLight', params: {}, position: [half - 0.4, 0, -0.55] },
      ],
      station: {
        conveyor: 'line',
        ports: { input: { standalone: ['liftIn'] }, output: { standalone: ['liftOut'] } },
        signals: { beacon: { machine: 'beacon' }, display: { machine: 'panel' } },
      },
    };
  },
});
