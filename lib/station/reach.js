// Reach-in tools (Phase 13): a machine beside the line whose tool moves into it (a labeller's tamp
// pad, a docking plug) declares `reach(params)` → { port, motion, toward, param? } (lib/registry.js).
// This works out, from where the machine stands, how far that motion must go to touch the unit's
// face, and which way to turn the machine so the tool faces the line. Generic (rule 6).
//
// Station frame: flow +X, conveyor centre line on z = 0, walkway +Z, equipment side −Z. A local point
// (x, y, z) of a machine at `position` turned by rotationY stands at
//   (x cos r + z sin r, y, −x sin r + z cos r) + position          (as lib/station/place.js)

const r4 = (v) => Math.round(v * 1e4) / 1e4;

/** A local vector turned by rotationY (no translation). */
export function turn([x, y, z], r) {
  return [x * Math.cos(r) + z * Math.sin(r), y, -x * Math.sin(r) + z * Math.cos(r)];
}

/**
 * The turn that makes a tool moving along local `toward` point across the line from `side`
 * ('walkway': towards −Z; 'equipment': towards +Z). Exact multiples of π / 2 where they apply.
 */
export function faceTurn(toward, side) {
  const a = Math.atan2(toward[2], toward[0]);
  const target = side === 'walkway' ? -Math.PI / 2 : Math.PI / 2;
  let r = a - target;
  while (r <= -Math.PI) r += 2 * Math.PI;
  while (r > Math.PI) r -= 2 * Math.PI;
  for (const exact of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) if (Math.abs(r - exact) < 1e-9) return exact;
  return r;
}

/**
 * The work place of a conveyor entry in the station frame (where a unit stops): its work port, or
 * midway between its input and output (as lib/station/stationSpec.js gives a plain belt one).
 */
export function workPlaceOf(registry, conveyor, ctx = {}) {
  const spec = registry.componentSpec(conveyor.type, conveyor.params ?? {}, ctx);
  const at = (p) => turn(p.position, conveyor.rotationY ?? 0).map((v, i) => v + (conveyor.position?.[i] ?? 0));
  const ports = spec.ports ?? {};
  const work = ports.work ?? Object.values(ports).find((p) => p.direction === 'work');
  if (work) return at(work);
  const ins = ports.input ?? Object.values(ports).find((p) => p.direction === 'in');
  const outs = ports.output ?? Object.values(ports).find((p) => p.direction === 'out');
  if (ins && outs) return at(ins).map((v, i) => (v + at(outs)[i]) / 2);
  return [conveyor.position?.[0] ?? 0, ctx.beltHeight ?? 0, conveyor.position?.[2] ?? 0];
}

/**
 * Where a placed machine's reach-in tool is and where it goes:
 * { start (retracted port, station frame), dir (unit vector), motion, max (motion range end), param }
 * or null when the machine has no reach.
 */
export function reachPose(registry, machine, ctx = {}) {
  const def = registry.getComponent(machine.type);
  if (!def.reach) return null;
  const spec = registry.componentSpec(machine.type, machine.params ?? {}, ctx);
  const reach = def.reach(spec.params);
  const r = machine.rotationY ?? 0;
  const port = spec.ports[reach.port];
  const start = turn(port.position, r).map((v, i) => v + (machine.position?.[i] ?? 0));
  const len = Math.hypot(...reach.toward) || 1;
  const dir = turn(reach.toward.map((v) => v / len), r);
  return { start, dir, motion: reach.motion, max: spec.motions[reach.motion].range[1], param: reach.param ?? null };
}

/**
 * How far the tool must move to touch the unit standing at `workAt` (its base centre, station frame):
 * the distance along the tool's direction to the unit's face (the unit as its measured box). null when
 * there is no unit measure.
 */
export function reachNeeded(pose, unit, workAt) {
  if (!pose || !unit) return null;
  const [hx, , hz] = unit.size.map((v) => v / 2);
  const toCentre = (pose.dir[0] * (workAt[0] - pose.start[0])) + (pose.dir[2] * (workAt[2] - pose.start[2]));
  const half = Math.abs(pose.dir[0]) * hx + Math.abs(pose.dir[2]) * hz;
  return r4(toCentre - half);
}
