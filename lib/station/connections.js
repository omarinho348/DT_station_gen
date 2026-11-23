// Station connections: pipes and hoses between two machines' anchors (a supply pump's discharge to
// a machine's inlet, an air line to a moving head). No single component can own them, so the
// station draws them, in its own frame, from data:
//
//   { id, from: 'machine.anchor', to: 'machine.anchor', kind: 'pipe' | 'hose', … }
//
// pipe  rigid, axis-aligned run with elbows: route 'up' rises from `from` to the height of `to`,
//       then runs along X, then Z (as the reference oil station's product riser); route 'across'
//       runs along X and Z at the height of `from` first, then rises. Optional end flanges.
// hose  flexible spline tube (reference OilHoses.addFlexible): sag at the middle, tangents at the
//       ends.
// A connection is redrawn whenever one of its ends moves (an anchor on a moving head), so hoses
// follow the motion. Generic: nothing here knows a component by name (rule 6).
import * as THREE from 'three';
import { group, addMesh, pipeRun, flange } from '../core/primitives.js';
import { connectionProblems, CONNECTION_DEFAULTS as DEFAULTS } from './connectionSpec.js';

export { Connection, Connections, connectionProblems, CONNECTION_MATERIALS } from './connectionSpec.js';

const FLANGE_INSET = 0.02;

/** Corner points of a pipe from a to b (Vector3s): duplicates and straight-through points removed. */
export function pipeRoute(a, b, route = 'up') {
  const raw = route === 'up'
    ? [a, new THREE.Vector3(a.x, b.y, a.z), new THREE.Vector3(b.x, b.y, a.z), b]
    : [a, new THREE.Vector3(b.x, a.y, a.z), new THREE.Vector3(b.x, a.y, b.z), b];
  const points = [];
  for (const p of raw) if (!points.length || points.at(-1).distanceTo(p) > 1e-6) points.push(p.clone());
  // Drop corners where the run goes straight on (no elbow there).
  return points.filter((p, i) => {
    if (i === 0 || i === points.length - 1) return true;
    const d1 = p.clone().sub(points[i - 1]).normalize();
    const d2 = points[i + 1].clone().sub(p).normalize();
    return d1.dot(d2) < 1 - 1e-9;
  });
}

const axisOf = (d) => {
  const ax = Math.abs(d.x);
  const ay = Math.abs(d.y);
  const az = Math.abs(d.z);
  return ay >= ax && ay >= az ? 'y' : ax >= az ? 'x' : 'z';
};

/**
 * Builds the connections under `root` (the station frame). Returns { group, update(), dispose() }:
 * update() redraws the connections whose ends moved since the last call.
 */
export function buildConnections({ connections, equipment, root, materials }) {
  const problems = connectionProblems(connections, equipment);
  if (problems.length) throw new Error(problems.join('; '));
  if (connections.length && !materials) throw new Error('connections need the shared materials (ctx.materials)');
  const holder = group(root, 'Connections');
  const anchorOf = (ref) => {
    const [machine, anchor] = ref.split('.');
    return equipment[machine].anchor(anchor);
  };
  const local = (object) => {
    object.updateWorldMatrix(true, false);
    root.updateWorldMatrix(true, false);
    return root.worldToLocal(new THREE.Vector3().setFromMatrixPosition(object.matrixWorld));
  };
  const items = connections.map((c) => ({
    c,
    from: anchorOf(c.from),
    to: anchorOf(c.to),
    radius: c.radius ?? DEFAULTS[c.kind].radius,
    material: materials?.[c.material ?? DEFAULTS[c.kind].material],
    node: null,
    key: '',
  }));

  const freeNode = (node) => {
    if (!node) return;
    node.removeFromParent();
    node.traverse((o) => o.geometry?.dispose()); // materials are the shared library's
  };

  const draw = (item, a, b) => {
    freeNode(item.node);
    const { c, radius, material } = item;
    const name = `Connection ${c.id}`;
    if (c.kind === 'pipe') {
      const points = pipeRoute(a, b, c.route);
      const run = pipeRun(holder, points.map((p) => p.toArray()), radius, material, name);
      if (c.flanges) {
        const ends = [[points[0], points[1]], [points.at(-1), points.at(-2)]];
        ends.forEach(([end, next], i) => {
          const dir = next.clone().sub(end).normalize();
          const at = end.clone().addScaledVector(dir, FLANGE_INSET);
          flange(run, radius * 1.9, at.toArray(), materials.brushed, `${name} flange ${i + 1}`, axisOf(dir));
        });
      }
      item.node = run;
    } else {
      const v = (p) => new THREE.Vector3(...p);
      const curve = new THREE.CatmullRomCurve3([a, a.clone().add(v(c.startTangent)), a.clone().lerp(b, 0.5).add(v(c.sag)), b.clone().add(v(c.endTangent)), b], false, 'centripetal');
      item.node = addMesh(holder, new THREE.TubeGeometry(curve, 48, radius, 10, false), material, name);
    }
  };

  const update = () => {
    for (const item of items) {
      const a = local(item.from);
      const b = local(item.to);
      const key = [...a.toArray(), ...b.toArray()].map((n) => n.toFixed(5)).join();
      if (key === item.key) continue;
      item.key = key;
      draw(item, a, b);
    }
  };
  update();

  return {
    group: holder,
    update,
    dispose() {
      items.forEach((item) => freeNode(item.node));
      holder.removeFromParent();
    },
  };
}
