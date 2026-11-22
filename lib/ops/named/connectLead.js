import * as THREE from 'three';
import { z } from 'zod';
import { defineOp } from '../../registry.js';
import { common, id, seconds, stateOf } from '../args.js';
import { vec3 } from '../sequences.js';

// A flexible lead (test lead, air hose, data cable) plugged from a machine port into the product
// (a ref) or another machine port at the end of a timed step, or unplugged (`connect: false`).
// Drawn as a sagging tube with a plug. While plugged into the product it hangs from the product,
// so it goes wherever the unit goes (and with it when the unit is cleared).
const LEAD_COLORS = { yellow: '#d9b21e', red: '#b8302a', blue: '#2d62ad', black: '#1d1f22' };
const target = z.union([
  z.object({ item: id, ref: id, offset: vec3.default([0, 0, 0]) }).strict(),
  z.object({ machine: id, port: id, offset: vec3.default([0, 0, 0]) }).strict(),
]);

defineOp({
  op: 'connectLead',
  summary: 'Plug a flexible lead from a machine port into a product ref or another port (or unplug it) at the end of a timed step.',
  args: z.object({
    from: z.object({ machine: id, port: id }),
    to: target,
    connect: z.boolean().default(true).describe('false = unplug'),
    seconds: seconds(30).default(0.4),
    color: z.enum(Object.keys(LEAD_COLORS)).default('yellow'),
    sag: z.number().min(0).max(1).default(0.2).describe('How far the middle hangs below the straight line (m)'),
    ...common,
  }),
  expand(cycle, a) {
    cycle.portPosition(a.from.machine, a.from.port);
    if (a.to.machine) cycle.portPosition(a.to.machine, a.to.port);
    else {
      cycle.item(a.to.item);
      if (a.to.item !== 'product') cycle.fail('only the product has refs');
      const refs = cycle.productSpec?.refs ?? [];
      if (cycle.productSpec && !refs.includes(a.to.ref)) cycle.fail(`the product has no ref "${a.to.ref}" (refs: ${refs.join(', ') || 'none'})`);
    }
    const key = `lead ${a.from.machine}.${a.from.port}`;
    const parentOf = () => (a.to.item ? cycle.item(a.to.item) : cycle.machine(a.from.machine).root.parent);
    const label = a.label ?? (a.connect ? `Lead ${a.from.machine} connected` : `Lead ${a.from.machine} removed`);
    cycle.queue(stateOf(cycle, a), label, a.seconds, a.status, {
      onEnd: () => {
        const parent = parentOf();
        const old = parent.getObjectByName(key);
        if (old) disposeLead(old);
        if (!a.connect) return;
        parent.updateWorldMatrix(true, false);
        const local = (owner, point) => parent.worldToLocal(owner.localToWorld(point));
        const from = local(cycle.machine(a.from.machine).root, cycle.portPosition(a.from.machine, a.from.port));
        const end = a.to.item
          ? local(cycle.item(a.to.item), cycle.product.ref(a.to.ref).add(new THREE.Vector3(...a.to.offset)))
          : local(cycle.machine(a.to.machine).root, cycle.portPosition(a.to.machine, a.to.port).add(new THREE.Vector3(...a.to.offset)));
        const plugAt = a.to.item
          ? local(cycle.item(a.to.item), cycle.product.ref(a.to.ref).add(new THREE.Vector3(...a.to.offset).multiplyScalar(0.5)))
          : end.clone();
        parent.add(buildLead(key, from, end, plugAt, LEAD_COLORS[a.color], a.sag));
      },
    });
  },
});

function buildLead(name, from, end, plugAt, color, sag) {
  const group = new THREE.Group();
  group.name = name;
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.55 });
  material.name = `${name} material`;
  const mid = from.clone().lerp(end, 0.5).add(new THREE.Vector3(0, -sag, 0));
  const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(from, mid, end), 32, 0.005, 6, false), material);
  tube.name = `${name} tube`;
  tube.castShadow = true;
  const plug = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.018, 0.02), material);
  plug.name = `${name} plug`;
  plug.position.copy(plugAt);
  group.add(tube, plug);
  return group;
}

function disposeLead(group) {
  group.removeFromParent();
  group.traverse((o) => {
    o.geometry?.dispose();
    if (o.material && o === group.children[0]) o.material.dispose();
  });
}
