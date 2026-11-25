// Pick-to-light module: a small housing with a lamp, clipped to the front of a supermarket
// location (tote, cradle lane, nest) to show the operator or robot which part is next.
// Ported from the reference KittingEquipment.js (pickLight). Origin: centre of the housing's
// underside; the lamp faces +Z. Each module has its own lamp material, so lamps switch alone.
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, roundedBox } from '../../core/primitives.js';
import { createLampMaterial, setLamp } from '../../core/materials.js';

const COLORS = { green: 0x39d353, amber: 0xf2a516, red: 0xe5372b, blue: 0x2f8ef0 };
const HOUSING = [0.05, 0.022, 0.018];

defineComponent({
  type: 'pickToLight',
  category: 'fixture',
  summary: 'Pick-to-light module (housing and lamp) marking the next location to pick from.',
  params: z.object({
    color: z.enum(['green', 'amber', 'red', 'blue']).default('green').describe('Lamp colour'),
  }),
  footprint: () => ({ x: [-HOUSING[0] / 2, HOUSING[0] / 2], z: [-HOUSING[2] / 2, HOUSING[2] / 2 + 0.002], height: HOUSING[1] }),
  mount: 'surface',
  motions: { lamp: { values: ['off', 'on'] } },
  recipes: {
    signal: {
      summary: 'Light the lamp to show the operator which part to pick, then switch it off',
      args: z.object({ seconds: z.number().min(0.1).max(30).default(1.5).describe('Lamp on (s)') }),
      ops: ({ machine, args }) => [{ op: 'toolOn', machine, motion: 'lamp', value: 'on', then: 'off', seconds: args.seconds, label: 'Pick light on' }],
    },
  },
  build({ params, materials }) {
    const root = group(null, 'pickToLight');
    const lamp = createLampMaterial(COLORS[params.color]);
    lamp.name = 'pick light lamp';
    roundedBox(root, HOUSING, [0, HOUSING[1] / 2, 0], materials.plasticBlack, 'PTL housing', 0.004);
    roundedBox(root, [0.03, 0.012, 0.004], [0, HOUSING[1] / 2, HOUSING[2] / 2], lamp, 'PTL lamp', 0.002);
    return { root, motions: { lamp: (v) => setLamp(lamp, v === 'on', 2) } };
  },
});
