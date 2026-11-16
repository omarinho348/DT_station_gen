// Scene content that needs no renderer: background, fog, lights, floor and grid.
// Headless-safe (no DOM, no WebGL), so Vitest can build it in Node.
// Phase 1 replaces the look with lib/core/environment.js (ported from the reference repo);
// this module only gives the twin page a neutral, well-lit empty stage.
import {
  Scene,
  Color,
  Fog,
  HemisphereLight,
  DirectionalLight,
  Mesh,
  PlaneGeometry,
  MeshStandardMaterial,
  BufferGeometry,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  Group,
  ArrowHelper,
  Vector3,
} from 'three';

export const STAGE_DEFAULTS = Object.freeze({
  background: 0x15181c,
  floorColor: 0x262b31,
  floorSize: 300, // metres; far larger than the fog distance so the edge is never visible
  fogNear: 25,
  fogFar: 90,
  gridSize: 100, // metres; edge sits inside the fog
  // Dark seams: the lit floor renders lighter than its base colour, so darker lines contrast at every distance.
  gridMajor: 0x101316,
  gridMinor: 0x171b1f,
  accent: 0x009999, // Siemens petrol, used for the +X flow marker
});

export function createStage(opts = {}) {
  const o = { ...STAGE_DEFAULTS, ...opts };

  const scene = new Scene();
  scene.name = 'scene';
  scene.background = new Color(o.background);
  scene.fog = new Fog(o.background, o.fogNear, o.fogFar);

  // Lights: soft sky/ground fill + one shadow-casting key light + a weak rim from behind.
  const hemi = new HemisphereLight(0xdfe8f0, 0x1a1d21, 0.9);
  hemi.name = 'light.hemi';
  hemi.position.set(0, 20, 0);

  const key = new DirectionalLight(0xffffff, 2.2);
  key.name = 'light.key';
  key.position.set(8, 14, 10);
  key.target.name = 'light.key.target';
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  const s = 14; // shadow box half-size in metres; enough for one station, widened for lines later
  Object.assign(key.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 50 });

  const rim = new DirectionalLight(0x9fd6d6, 0.6);
  rim.name = 'light.rim';
  rim.position.set(-10, 8, -12);

  scene.add(hemi, key, key.target, rim);

  // Floor at y = 0 (everything rests on it; nothing goes below).
  const floor = new Mesh(
    new PlaneGeometry(o.floorSize, o.floorSize),
    // polygonOffset pushes the floor back in depth so grid lines and decals never z-fight with it.
    new MeshStandardMaterial({
      color: o.floorColor,
      roughness: 0.92,
      metalness: 0.0,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }),
  );
  floor.name = 'floor';
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // 1 m grid, lifted 1 mm above the floor.
  const grid = createGrid(o.gridSize, o.gridMajor, o.gridMinor);
  grid.position.y = 0.001;
  scene.add(grid);

  // Origin marker: product flow direction is +X (constitution convention).
  const origin = new Group();
  origin.name = 'originMarker';
  // Raised by the cone radius (headWidth / 2) so the arrowhead does not dip below the floor.
  const flow = new ArrowHelper(new Vector3(1, 0, 0), new Vector3(0, 0.06, 0), 1.0, o.accent, 0.18, 0.1);
  flow.name = 'originMarker.flowX';
  flow.line.name = 'originMarker.flowX.shaft';
  flow.cone.name = 'originMarker.flowX.head';
  origin.add(flow);
  scene.add(origin);

  // Content root: lines, stations and gallery components are added here, never to the scene directly.
  const content = new Group();
  content.name = 'content';
  scene.add(content);

  return { scene, content, lights: { hemi, key, rim }, floor, grid, origin };
}

/**
 * Square grid with 1 m cells, built from 1 m segments rather than full-length lines.
 * Long lines that cross the camera's near plane are dropped by SwiftShader (the headless
 * renderer used for golden screenshots); short segments render correctly everywhere.
 * Every 5th line is a major line.
 */
export function createGrid(size, majorColor, minorColor) {
  const half = size / 2;
  const major = new Color(majorColor);
  const minor = new Color(minorColor);
  const pos = [];
  const col = [];
  for (let i = -half; i <= half; i++) {
    const c = i % 5 === 0 ? major : minor;
    for (let j = -half; j < half; j++) {
      pos.push(i, 0, j, i, 0, j + 1); // line along Z at x = i
      pos.push(j, 0, i, j + 1, 0, i); // line along X at z = i
      for (let k = 0; k < 4; k++) col.push(c.r, c.g, c.b);
    }
  }
  const geom = new BufferGeometry();
  geom.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geom.setAttribute('color', new Float32BufferAttribute(col, 3));
  const mat = new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false });
  const grid = new LineSegments(geom, mat);
  grid.name = 'grid';
  return grid;
}
