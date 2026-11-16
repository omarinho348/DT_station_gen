// Dev-only check scene for lib/core: every shared material as a swatch, the shape helpers,
// lamps, and a carriage driven by StepSequencer + the trapezoid profile.
// Open with #/twin?demo=core. The component gallery (next step) replaces this.
import { createMaterials, createLampMaterial, setLamp, disposeMaterials } from '../../lib/core/materials.js';
import { group, box, roundedBox, cylinder, cylinderBetween, pipeRun, flange, addMesh } from '../../lib/core/primitives.js';
import { trapezoidDuration, trapezoidTravel, smoother } from '../../lib/core/motion.js';
import { StepSequencer } from '../../lib/core/StepSequencer.js';
import { SphereGeometry, PlaneGeometry } from 'three';

export function createCoreDemo() {
  const m = createMaterials();
  const root = group(null, 'coreDemo');

  // ── Material swatches: two rows of spheres resting on the floor ──
  const swatches = group(root, 'swatches', [0, 0, 1.3]);
  const keys = Object.keys(m).filter((k) => k !== 'floor' && k !== 'floorLine');
  const perRow = Math.ceil(keys.length / 2);
  const sphere = new SphereGeometry(0.16, 40, 24);
  keys.forEach((key, i) => {
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    addMesh(swatches, sphere, m[key], `swatch ${key}`, [(col - (perRow - 1) / 2) * 0.42, 0.16, row * 0.5]);
  });

  // ── Slab with floor markings ──
  box(root, [5.4, 0.02, 1.9], [0, 0.01, -0.6], m.floor, 'slab');
  box(root, [5.2, 0.002, 0.06], [0, 0.021, 0.25], m.floorLine, 'slab line front');
  box(root, [5.2, 0.002, 0.06], [0, 0.021, -1.45], m.floorLine, 'slab line back');

  // ── Conveyor-like bench: frame, legs, belt, rollers ──
  const bench = group(root, 'bench', [-1.1, 0.02, -0.5]);
  const legs = [-1.1, 1.1].flatMap((x) => [-0.22, 0.22].map((z) => [x, z]));
  legs.forEach(([x, z], i) => {
    roundedBox(bench, [0.06, 0.74, 0.06], [x, 0.37, z], m.frame, `bench leg ${i + 1}`, 0.006);
    cylinder(bench, 0.045, 0.012, [x, 0.006, z], m.rubber, `bench foot ${i + 1}`);
  });
  roundedBox(bench, [2.4, 0.08, 0.05], [0, 0.76, 0.25], m.aluminium, 'bench rail front', 0.008);
  roundedBox(bench, [2.4, 0.08, 0.05], [0, 0.76, -0.25], m.aluminium, 'bench rail back', 0.008);
  const belt = box(bench, [2.3, 0.012, 0.44], [0, 0.806, 0], m.belt, 'bench belt');
  box(bench, [2.3, 0.05, 0.44], [0, 0.775, 0], m.beltReturn, 'bench belt bed');
  m.belt.map.repeat.set(6, 1);
  cylinder(bench, 0.04, 0.46, [-1.17, 0.772, 0], m.brushed, 'bench roller in', { axis: 'z' });
  cylinder(bench, 0.04, 0.46, [1.17, 0.772, 0], m.brushed, 'bench roller out', { axis: 'z' });
  roundedBox(bench, [0.16, 0.14, 0.2], [1.0, 0.62, 0.38], m.motor, 'bench motor', 0.02);

  // Carriage riding the belt (moved by the sequencer below)
  const carriage = group(bench, 'carriage', [-0.8, 0.812, 0]);
  roundedBox(carriage, [0.3, 0.02, 0.3], [0, 0.01, 0], m.aluminium, 'carriage plate', 0.004);
  roundedBox(carriage, [0.2, 0.16, 0.2], [0, 0.1, 0], m.guide, 'carriage load', 0.02);

  // ── Pipework with flanges ──
  const pipes = group(root, 'pipes', [1.6, 0.02, -0.9]);
  roundedBox(pipes, [0.5, 0.9, 0.4], [-0.5, 0.45, 0], m.stainless, 'pipes tank', 0.04);
  pipeRun(pipes, [[-0.25, 0.7, 0], [0.3, 0.7, 0], [0.3, 0.25, 0], [0.9, 0.25, 0], [0.9, 0, 0]], 0.03, m.chrome, 'pipes run');
  flange(pipes, 0.055, [-0.24, 0.7, 0], m.brushed, 'pipes flange tank', 'x');
  flange(pipes, 0.055, [0.6, 0.25, 0], m.brushed, 'pipes flange mid', 'x');
  cylinderBetween(pipes, [-0.5, 0.9, 0.1], [-0.2, 1.25, 0.1], 0.012, m.airLine, 'pipes air line');
  cylinderBetween(pipes, [-0.2, 1.25, 0.1], [-0.2, 0, 0.3], 0.012, m.hose, 'pipes hose');

  // ── Fence and guard panels on posts ──
  const guards = group(root, 'guards', [0, 0.02, -1.4]);
  [-2.5, -1.25, 0, 1.25, 2.5].forEach((x, i) =>
    roundedBox(guards, [0.05, 1.3, 0.05], [x, 0.65, 0], m.safetyYellow, `guards post ${i + 1}`, 0.006),
  );
  const panel = new PlaneGeometry(1.2, 1.1);
  m.fence.map.repeat.set(10, 9);
  addMesh(guards, panel, m.fence, 'guards fence 1', [-1.875, 0.7, 0]);
  addMesh(guards, panel, m.fence, 'guards fence 2', [-0.625, 0.7, 0]);
  addMesh(guards, panel, m.guard, 'guards glass 1', [0.625, 0.7, 0], { castShadow: false });
  addMesh(guards, panel, m.guard, 'guards glass 2', [1.875, 0.7, 0], { castShadow: false });

  // ── Lamps and buttons on a small panel ──
  const panelBox = group(root, 'controls', [0.55, 0.02, -0.15]);
  roundedBox(panelBox, [0.06, 0.9, 0.06], [0, 0.45, 0], m.frameDark, 'controls post', 0.006);
  roundedBox(panelBox, [0.34, 0.24, 0.1], [0, 1.0, 0], m.plasticBlack, 'controls box', 0.015);
  const lamps = [0xd92b21, 0xf2a516, 0x2fbf4f].map((color, i) => {
    const material = createLampMaterial(color);
    cylinder(panelBox, 0.028, 0.03, [-0.1 + i * 0.1, 1.05, 0.055], material, `controls lamp ${i + 1}`, { axis: 'z' });
    return material;
  });
  cylinder(panelBox, 0.03, 0.035, [-0.08, 0.95, 0.06], m.emergency, 'controls e-stop', { axis: 'z' });
  cylinder(panelBox, 0.022, 0.025, [0.06, 0.95, 0.055], m.buttonGreen, 'controls start', { axis: 'z' });

  // ── Motion: the carriage shuttles with the trapezoid profile; lamps follow the step state ──
  const SPEED = 0.4;
  const RAMP = 0.4;
  let at = -0.8;
  const show = (state) => lamps.forEach((lamp, i) => setLamp(lamp, i === { stop: 0, wait: 1, run: 2 }[state]));
  const sequencer = new StepSequencer({
    onStepStart: (step) => show(step.state),
    plan: () => {
      const to = at < 0 ? 0.8 : -0.8;
      const from = at;
      const distance = to - from;
      const duration = trapezoidDuration(distance, SPEED, RAMP);
      sequencer.queue('wait', 'Dwell', 0.8);
      sequencer.queue('run', 'Travel', duration, {}, {
        onUpdate: (progress, previous) => {
          const now = trapezoidTravel(progress * duration, distance, SPEED, RAMP);
          const before = trapezoidTravel(previous * duration, distance, SPEED, RAMP);
          carriage.position.x = from + now;
          m.belt.map.offset.x -= ((now - before) / 2.3) * 6; // belt scrolls with the load
        },
        onEnd: () => (at = to),
      });
      sequencer.queue('stop', 'Settle', 0.5, {}, {
        onUpdate: (progress) => (carriage.position.y = 0.812 + 0.02 * Math.sin(Math.PI * smoother(progress))),
      });
    },
  });
  show('wait');

  return {
    root,
    update: (dt) => sequencer.advance(dt),
    dispose() {
      disposeMaterials(m);
      lamps.forEach((lamp) => lamp.dispose());
    },
    belt,
  };
}
