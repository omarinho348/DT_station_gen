// The reviewer's geometry check (Claude.md §7.3 "no footprint overlaps", step 7.2): the line is
// built headless (Box3 in Node) and the solid parts of every two pieces of equipment are tested
// against each other, within a station, between stations, and for the transfer conveyors.
//
// Why meshes and not footprints: a footprint is the envelope a component promises to stay inside
// (a fence's whole run, a portal gantry's span over the belt, a robot's base and arm), so footprints
// of neighbours overlap all the time on a well-built line (about 300 times on the three example
// lines). The meshes are what is really there: each mesh is an oriented box (its geometry's bounds
// in its own frame), and two parts clash when they would have to move more than TOLERANCE to
// clear each other (parts that only touch, a foot on a floor marking, are fine).
//
// Overlaps that are meant are told apart by what the data already says, never by component name
// (rule 6):
//   - a `tool` rides on a robot's flange: not tested here (reach is step 7.3)
//   - an `overConveyor` / `besideConveyor` component sits over / at a conveyor: it may overlap any
//     component of category conveyor or transport (a tunnel round its belt, a lift in its conveyor)
//   - a `surface` component rests on another: it may overlap the one under its origin
//   - two components meet where units pass between them: one's in / out port lies on the other
//     (an erector putting cases onto the carton line; a transfer at the station belt it joins), and
//     a transfer meets the machines of the two ports its edge joins and the transfers sharing an end
// Everything else is a finding: a transfer running through equipment or another transfer is an
// error (the layout put it there; the line cannot look right); two machines going into each other
// is a warning with the depth and the two parts, so the Builder or the owner can move one.
import * as THREE from 'three';
import { Line } from '../../lib/line/Line.js';
import { createMaterials } from '../../lib/core/materials.js';

/** Parts that go into each other less than this only touch (m). */
export const TOLERANCE = 0.02;

const CONVEYING = new Set(['conveyor', 'transport']);
const AT_CONVEYOR = new Set(['overConveyor', 'besideConveyor']);

/**
 * The solid parts of a component: every visible mesh as an oriented box in the line frame
 * { name, centre, axes: [Vector3 ×3], half: [x, y, z], box: Box3 }. Products and items carried
 * by the component (userData.product) are not its parts.
 */
export function solidsOf(root) {
  const parts = [];
  const visit = (o) => {
    if (!o.visible || (o !== root && o.userData?.product)) return;
    if (o.isMesh && o.geometry) {
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const local = o.geometry.boundingBox;
      if (!local.isEmpty()) {
        const matrices = o.isInstancedMesh
          ? Array.from({ length: o.count }, (_, i) => { const m = new THREE.Matrix4(); o.getMatrixAt(i, m); return o.matrixWorld.clone().multiply(m); })
          : [o.matrixWorld];
        for (const m of matrices) parts.push(orientedBox(o.name || '(unnamed mesh)', local, m));
      }
    }
    o.children.forEach(visit);
  };
  visit(root);
  return parts;
}

function orientedBox(name, local, matrix) {
  const centre = local.getCenter(new THREE.Vector3()).applyMatrix4(matrix);
  const size = local.getSize(new THREE.Vector3());
  const ex = new THREE.Vector3();
  const ey = new THREE.Vector3();
  const ez = new THREE.Vector3();
  matrix.extractBasis(ex, ey, ez);
  const half = [size.x / 2 * ex.length(), size.y / 2 * ey.length(), size.z / 2 * ez.length()];
  const axes = [ex, ey, ez].map((v) => (v.lengthSq() > 0 ? v.normalize() : v));
  return { name, centre, axes, half, box: local.clone().applyMatrix4(matrix) };
}

const reach = (b, n) => Math.abs(b.axes[0].dot(n)) * b.half[0] + Math.abs(b.axes[1].dot(n)) * b.half[1] + Math.abs(b.axes[2].dot(n)) * b.half[2];

/**
 * How far two oriented boxes must move apart to clear each other (m): the smallest overlap over
 * the separating axes (both boxes' axes and their cross products); 0 when apart or only touching.
 */
export function penetration(a, b) {
  const d = b.centre.clone().sub(a.centre);
  const candidates = [...a.axes, ...b.axes];
  for (const u of a.axes) for (const v of b.axes) {
    const c = u.clone().cross(v);
    if (c.lengthSq() > 1e-10) candidates.push(c.normalize());
  }
  let min = Infinity;
  for (const n of candidates) {
    if (n.lengthSq() === 0) continue;
    const overlap = reach(a, n) + reach(b, n) - Math.abs(d.dot(n));
    if (overlap <= 0) return 0;
    if (overlap < min) min = overlap;
  }
  return Number.isFinite(min) ? min : 0;
}

/**
 * The deepest clash between two components' parts: { depth, parts: 'a × b', count } or null.
 * depth is how far one part must move to clear the other (a post through the middle of a table top:
 * half the top's width), so it says what it takes to fix.
 */
export function deepestClash(a, b, tolerance = TOLERANCE) {
  let best = null;
  let count = 0;
  for (const p of a.parts) {
    if (!p.box.intersectsBox(b.box)) continue;
    for (const q of b.parts) {
      if (!p.box.intersectsBox(q.box)) continue;
      const depth = penetration(p, q);
      if (depth <= tolerance) continue;
      count += 1;
      if (!best || depth > best.depth) best = { depth, parts: `${p.name} × ${q.name}` };
    }
  }
  return best ? { ...best, count } : null;
}

/** Is a line-frame point on a component's footprint (its rectangle, grown by `grow`, and its height)? */
function onFootprint(c, point, grow = TOLERANCE) {
  const local = c.root.worldToLocal(point.clone());
  const f = c.footprint;
  return local.x >= f.x[0] - grow && local.x <= f.x[1] + grow
    && local.z >= f.z[0] - grow && local.z <= f.z[1] + grow
    && local.y >= (f.bottom ?? 0) - grow && local.y <= f.height + grow;
}

/** Do two components meet on purpose (see the header)? */
function meant(a, b, joined) {
  if (AT_CONVEYOR.has(a.mount) && CONVEYING.has(b.category)) return true;
  if (AT_CONVEYOR.has(b.mount) && CONVEYING.has(a.category)) return true;
  if (a.mount === 'surface' && onFootprint(b, a.origin, 0)) return true;
  if (b.mount === 'surface' && onFootprint(a, b.origin, 0)) return true;
  if (joined.has(pairKey(a, b))) return true;
  const portOn = (x, y) => x.ports.some((p) => onFootprint(y, p));
  return portOn(a, b) || portOn(b, a);
}

const pairKey = (a, b) => [a.key, b.key].sort().join('|');

/**
 * The components of a built line: every station's equipment and every transfer conveyor, with
 * where each is written in factory.json.
 * @param {object} registry
 * @param {Line}   line     a built lib/line/Line.js (matrices up to date)
 * @param {object} paths    { equipment: (stationId, equipmentId) → path, edge: (index) → path }
 */
export function lineComponents(registry, line, paths) {
  line.root.updateMatrixWorld(true);
  const out = [];
  const add = (key, label, inst, extra) => {
    const def = registry.getComponent(inst.type);
    if (def.mount === 'tool') return;
    const parts = solidsOf(inst.root);
    if (!parts.length) return;
    const box = new THREE.Box3();
    parts.forEach((p) => box.union(p.box));
    const ports = Object.values(inst.ports ?? {}).filter((p) => p.direction !== 'work')
      .map((p) => inst.root.localToWorld(new THREE.Vector3(...p.position)));
    out.push({
      key, label, type: inst.type, mount: def.mount, category: def.category, footprint: inst.footprint, root: inst.root,
      origin: inst.root.localToWorld(new THREE.Vector3()), parts, box, ports, ...extra,
    });
  };
  for (const s of line.stations) {
    for (const [id, inst] of Object.entries(s.equipment)) {
      if (!inst.root.visible) continue; // stand-alone only (a return-line lift once the port is connected)
      add(`${s.id}/${id}`, `"${id}" (${inst.type})`, inst, { station: s.id, id, path: paths.equipment(s.id, id) });
    }
  }
  for (const t of line.transfers ?? []) {
    if (!t.conveyor) continue;
    add(`edge/${t.index}`, `the transfer ${t.edge.from} → ${t.edge.to} (${t.conveyor.type})`, t.conveyor, {
      transfer: t, path: paths.edge(t.index),
      ends: [`${t.from.station}/${t.up.cycle.ports[t.from.port].machine}`, `${t.to.station}/${t.down.cycle.ports[t.to.port].machine}`],
      endpoints: [t.edge.from, t.edge.to],
    });
  }
  return out;
}

/**
 * Geometry findings of a built line: [{ check: 'geometry', severity, path, message, hint }].
 * One finding per pair of components that clash (its deepest pair of parts named).
 */
export function geometryFindings(registry, line, paths, { tolerance = TOLERANCE } = {}) {
  const comps = lineComponents(registry, line, paths);
  // Transfers meet the machines at their two ends, and the transfers that share an end with them.
  const joined = new Set();
  for (const c of comps) {
    if (!c.transfer) continue;
    for (const end of c.ends) joined.add([c.key, end].sort().join('|'));
    for (const o of comps) if (o !== c && o.transfer && o.endpoints.some((e) => c.endpoints.includes(e))) joined.add(pairKey(c, o));
  }
  const findings = [];
  for (let i = 0; i < comps.length; i += 1) {
    for (let j = i + 1; j < comps.length; j += 1) {
      const a = comps[i];
      const b = comps[j];
      if (!a.box.intersectsBox(b.box) || meant(a, b, joined)) continue;
      const clash = deepestClash(a, b, tolerance);
      if (!clash) continue;
      const mm = Math.round(clash.depth * 1000);
      const where = (c) => (c.transfer ? c.label : `station "${c.station}": ${c.label}`);
      if (a.transfer || b.transfer) {
        const [t, o] = a.transfer ? [a, b] : [b, a];
        findings.push({
          check: 'geometry', severity: 'error', path: t.path,
          message: `${t.label} runs through ${o.transfer ? o.label : `station "${o.station}"'s ${o.label}`} (${clash.parts}, ${mm} mm to clear)`,
          hint: 'the layout placed it from the graph: join the stations at other ports, put the branch on the other side, or move the equipment out of its path',
        });
      } else {
        const same = a.station === b.station;
        findings.push({
          check: 'geometry', severity: 'warning', path: b.path,
          message: same
            ? `station "${a.station}": ${a.label} and ${b.label} overlap (${clash.parts}, ${mm} mm to clear)`
            : `${where(a)} and ${where(b)} overlap (${clash.parts}, ${mm} mm to clear)`,
          hint: same
            ? 'move one of them (equipment position / rotationY) or make it smaller; a machine built to sit over or at a conveyor says so with its mount'
            : 'the stations stand too close for this equipment: move it inwards, or make the transfer longer (line.conventions.transferLength)',
        });
      }
    }
  }
  return findings;
}

let sharedMaterials = null;

/**
 * Builds the line of an expanded factory.json headless and returns its geometry findings.
 * Paths point into factory.json: a parallel copy's equipment to its station, shell furniture to
 * the station's shell, a repeated edge to the edge written once.
 * A line that does not build is an error; one whose models (GLB) are not loaded yet is a note
 * (the CLI and the API preload them; preloadComponentAssets in lib/core/assets.js).
 * @param {object} registry
 * @param {object} factory   the parsed factory.json
 * @param {object} expanded  expandFactory's result ({ line, ctx, conventions })
 * @param {object} [o]       { tolerance }
 */
export function reviewGeometry(registry, factory, expanded, { tolerance = TOLERANCE } = {}) {
  const { line: data, ctx, conventions } = expanded;
  const original = (id) => data.stations.find((s) => s.id === id)?.copyOf ?? id;
  const stationIndex = (id) => factory.stations.findIndex((s) => s.id === original(id));
  const paths = {
    equipment(stationId, equipmentId) {
      const i = stationIndex(stationId);
      const j = factory.stations[i]?.equipment.findIndex((e) => e.id === equipmentId) ?? -1;
      return j >= 0 ? `stations[${i}].equipment[${j}]` : `stations[${i}].shell`;
    },
    edge(index) {
      const e = data.edges[index];
      const back = (end) => { const [s, p] = end.split('.'); return `${original(s)}.${p}`; };
      const k = factory.graph.edges.findIndex((o) => o.from === back(e.from) && o.to === back(e.to));
      return `graph.edges[${k >= 0 ? k : index}]`;
    },
  };
  let line;
  try {
    sharedMaterials ??= createMaterials();
    line = new Line({ registry, line: data, ctx: { ...ctx, materials: sharedMaterials }, conventions });
  } catch (error) {
    if (/needs its model loaded first/.test(error.message)) {
      return [{ check: 'geometry', severity: 'info', path: '(line)', message: `geometry not checked: ${error.message.replace(/: await .*$/, '')}`, hint: 'preload the models first (preloadComponentAssets in lib/core/assets.js); npm run review does' }];
    }
    return [{ check: 'geometry', severity: 'error', path: '(line)', message: `the line does not build headless: ${error.message}` }];
  }
  try {
    return geometryFindings(registry, line, paths, { tolerance });
  } finally {
    line.dispose?.();
  }
}
