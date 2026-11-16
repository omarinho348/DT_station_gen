// Signal tower on a floor pole: red (alarm), amber (waiting), green (running), with a buzzer.
// Ported from the reference LineEquipment.createStackLight.
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, cylinder } from '../../core/primitives.js';
import { createLampMaterial, setLamp } from '../../core/materials.js';

const LAMPS = [
  ['red', 0xe8352b],
  ['amber', 0xf2a516],
  ['green', 0x39d353],
];
const LAMP_PITCH = 0.085; // lamp height 0.08 + 5 mm ring between tiers
const STACK = 0.3; // lamps + buzzer section at the top of the pole
const BASE_RADIUS = 0.06;

defineComponent({
  type: 'stackLight',
  category: 'station',
  summary: 'Three-lamp signal tower on a floor pole: green running, amber waiting, red alarm, with buzzer.',
  params: z.object({
    height: z.number().min(1.2).max(3).default(2.1).describe('Height to the top lamp (m)'),
    buzzer: z.boolean().default(true).describe('Buzzer under the lamps'),
  }),
  footprint: (p) => ({
    x: [-BASE_RADIUS, BASE_RADIUS],
    z: [-BASE_RADIUS, BASE_RADIUS],
    height: p.height + 0.012,
  }),
  mount: 'floor',
  motions: {
    mode: { values: ['off', 'run', 'wait', 'alarm'], default: 'off' },
  },
  build({ params, materials }) {
    const { height, buzzer } = params;
    const root = group(null, 'stackLight');
    cylinder(root, BASE_RADIUS, 0.012, [0, 0.006, 0], materials.frameDark, 'Base', { segments: 20 });
    cylinder(root, 0.015, height - STACK, [0, (height - STACK) / 2, 0], materials.stainless, 'Pole', { segments: 12 });
    // Core tube through the lamp stack. The reference left a 3 cm gap above the buzzer and 5 mm
    // between lamps, so the tiers floated; the core joins pole, buzzer, lamps and cap.
    cylinder(root, 0.03, STACK, [0, height - STACK / 2, 0], materials.plasticBlack, 'Core', { segments: 16 });
    if (buzzer) cylinder(root, 0.042, 0.04, [0, height - STACK, 0], materials.plasticBlack, 'Buzzer', { segments: 20 });

    const lamps = {};
    LAMPS.forEach(([key, color], index) => {
      lamps[key] = createLampMaterial(color);
      cylinder(root, 0.04, 0.08, [0, height - 0.04 - index * LAMP_PITCH, 0], lamps[key], `Lamp ${key}`, { segments: 20 });
    });
    cylinder(root, 0.042, 0.012, [0, height + 0.006, 0], materials.plasticBlack, 'Cap', { segments: 20 });

    return {
      root,
      motions: {
        mode(mode) {
          setLamp(lamps.green, mode === 'run');
          setLamp(lamps.amber, mode === 'wait');
          setLamp(lamps.red, mode === 'alarm');
        },
      },
    };
  },
});
