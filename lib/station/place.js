// Station placement from hints (Phase 8 step 3b): the Builder's layout phase says *where* a machine
// goes in words (Claude.md §6.5: agents give relative hints, never coordinates); this turns the words
// into station-local positions from the machines' ports and their real parts. Deterministic, and it
// knows no component by name (rule 6): everything comes from the registry.
//
//   placeStation(registry, { conveyor, equipment, fixed, ctx }) → { equipment: [{ id, type, params, position, rotationY }], notes }
//
//   equipment  [{ id, type, params?, place, at, on?, turned?, side? }]  in the order given (it matters side by side)
//   fixed      [{ id, type, params, position, rotationY }]       already placed (a shell's furniture): obstacles
//   conveyor   the id units travel on (one of equipment with place "line", or one of fixed)
//
// Hints (station frame: flow +X, conveyor on z = 0, equipment side −Z, walkway +Z):
//   line        the station conveyor at the origin, along X
//   overLine    across the conveyor at `at`: a machine with a work port puts it there, any other its origin
//               (components built to stand over a conveyor have their origin on its centre line);
//               one that stands on a surface (mount surface: a photo-eye) stands on the conveyor's top
//   besideLine  against the conveyor's edge at `at`, on `side` equipment (default) or walkway;
//               `turned`: rotated to run away from the line (a reject lane), its start at the edge;
//               a machine whose tool reaches into the line (`reach`) is turned to face it, its
//               retracted tool at the edge
//   rear        on the equipment side, clear of the conveyor by GAP and of everything already there
//   front       the same on the walkway side
//   upstream    in line before the conveyor: its out port meets the conveyor's input port (else end to end)
//   downstream  in line after it: its in port meets the conveyor's output port (else end to end)
//   onTop       on the top of the machine named in `on`, centred (several on one machine: side by side)
//   at          input | work | output | whole: the conveyor's port (work: its work port, else the middle)
// Machines sharing a place, an `at` (and a side) stand side by side along X, centred there, in order.
//
// "Clear of" means the real parts (lib/core/solids.js, as the reviewer's geometry check): a machine
// may stand inside a portal's span, between its posts, which a footprint (an envelope) would forbid.
// beside / rear / front machines step outward 5 cm at a time until they clear what is there; as in the
// reviewer, a machine built to sit at a conveyor may overlap conveyors. A component whose model is
// not loaded falls back to its footprint.
// notes: what the Builder should know, e.g. a rear machine that only fits behind something running the
// station's whole length (a fence): the cell needs to be deeper.
import { CONVENTIONS } from '../core/conventions.js';
import { createMaterials } from '../core/materials.js';
import { solidsOf, deepestClash, TOLERANCE } from '../core/solids.js';
import { faceTurn, turn } from './reach.js';
import * as THREE from 'three';

/** Clearance between a rear / front machine and the conveyor (m). */
export const GAP = 0.3;
/** Clearance between machines standing side by side (m). */
export const SIDE_GAP = 0.15;
/** How far a machine steps outward per try, and how far at most (m). */
export const STEP = 0.05;
const MAX_STEPS = 100;
/** Gap between a reach-in tool's retracted port and the conveyor's edge (m). */
export const REACH_GAP = 0.02;

export class PlacementError extends Error {}

const AT_CONVEYOR = new Set(['overConveyor', 'besideConveyor']);
const CONVEYING = new Set(['conveyor', 'transport']);

/** A component's footprint rectangle in the station frame, for a position and turn. */
function rectOf(footprint, position, rotationY) {
  const corners = [[footprint.x[0], footprint.z[0]], [footprint.x[1], footprint.z[0]], [footprint.x[0], footprint.z[1]], [footprint.x[1], footprint.z[1]]]
    .map(([x, z]) => [x * Math.cos(rotationY) + z * Math.sin(rotationY) + position[0], -x * Math.sin(rotationY) + z * Math.cos(rotationY) + position[2]]);
  const xs = corners.map((c) => c[0]);
  const zs = corners.map((c) => c[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
}
const overlaps = (a, b) => a.x0 < b.x1 - 1e-9 && b.x0 < a.x1 - 1e-9 && a.z0 < b.z1 - 1e-9 && b.z0 < a.z1 - 1e-9;
const round = (v) => Math.round(v * 1e4) / 1e4 + 0; // + 0: no −0 in the output

let sharedMaterials = null;

/**
 * Places a station's machines from their hints (see the header).
 * @returns {{ equipment: object[], notes: { id: string, message: string }[] }}
 */
export function placeStation(registry, { conveyor, equipment, fixed = [], ctx = {} }) {
  const context = { beltHeight: CONVENTIONS.beltHeight, ...ctx };
  const ctxOf = (e) => (e.beltHeight !== undefined ? { ...context, beltHeight: e.beltHeight } : context);
  const spec = (e) => registry.componentSpec(e.type, e.params ?? {}, ctxOf(e));
  const placed = new Map(); // id → { e, spec, def, position, rotationY, rect, body }
  const built = [];
  const notes = [];

  /** The real parts of a component at a pose: { parts, box } (null: its model is not loaded; use the footprint). */
  const bodyAt = (record, position, rotationY) => {
    if (record.inst === undefined) {
      try {
        sharedMaterials ??= createMaterials();
        record.inst = registry.buildComponent(record.e.type, record.e.params ?? {}, { ...ctxOf(record.e), materials: sharedMaterials });
        built.push(record.inst);
      } catch {
        record.inst = null;
      }
    }
    if (!record.inst) return null;
    record.inst.root.position.fromArray(position);
    record.inst.root.rotation.y = rotationY;
    record.inst.root.updateMatrixWorld(true);
    const parts = solidsOf(record.inst.root);
    const box = new THREE.Box3();
    parts.forEach((p) => box.union(p.box));
    return { parts, box };
  };
  const put = (e, s, position, rotationY = 0) => {
    const p = position.map(round);
    const record = placed.get(e.id) ?? { e, spec: s, def: registry.getComponent(e.type) };
    Object.assign(record, { position: p, rotationY, rect: rectOf(s.footprint, p, rotationY), height: s.footprint.height });
    record.body = bodyAt(record, p, rotationY);
    placed.set(e.id, record);
    return record;
  };
  /** Does a candidate at this pose clash with anything placed (real parts; footprints where a model is missing)? */
  const clashesAt = (record, position, rotationY) => {
    const body = bodyAt(record, position, rotationY);
    const rect = rectOf(record.spec.footprint, position, rotationY);
    for (const o of placed.values()) {
      if (o.e.id === record.e.id) continue;
      if (AT_CONVEYOR.has(record.def.mount) && CONVEYING.has(o.def.category)) continue; // meant (as in the reviewer)
      if (body && o.body) {
        if (body.box.intersectsBox(o.body.box) && deepestClash(body, o.body, TOLERANCE)) return o;
      } else if (overlaps(rect, o.rect) && o.height > 0.05) {
        return o;
      }
    }
    return null;
  };
  /**
   * A robot whose real parts are known (its model loaded): placed by them, not by its envelope (its
   * footprint), so the line lies within its reach. Without a model it falls back to the footprint.
   */
  const reachesLine = (e) => {
    const def = registry.getComponent(e.type);
    if (def.category !== 'robot') return false;
    return Boolean(bodyAt({ e, spec: spec(e), def }, [0, 0, 0], 0));
  };
  /** Steps a candidate outward (dz per step) from a start until it clears what is placed. */
  const stepOut = (e, s, x, z, dz, rotationY = 0) => {
    const record = { e, spec: s, def: registry.getComponent(e.type) };
    let tries = 0;
    while (clashesAt(record, [x, 0, z], rotationY) && tries < MAX_STEPS) { z += dz; tries += 1; }
    placed.set(e.id, record); // keeps its built instance for put()
    put(e, s, [x, 0, z], rotationY);
  };

  try {
    const ids = new Set();
    for (const e of [...fixed, ...equipment]) {
      if (ids.has(e.id)) throw new PlacementError(`equipment id "${e.id}" is used twice`);
      ids.add(e.id);
    }
    for (const f of fixed) put(f, spec(f), f.position ?? [0, 0, 0], f.rotationY ?? 0);

    // The conveyor first: everything else is placed against it.
    const own = equipment.find((e) => e.id === conveyor);
    if (own) {
      if (own.place !== 'line') throw new PlacementError(`the conveyor "${conveyor}" must have place "line"`);
      put(own, spec(own), [0, 0, 0]);
    } else if (!placed.has(conveyor)) {
      throw new PlacementError(`the conveyor "${conveyor}" is neither a machine of the station nor of its shell`);
    }
    for (const e of equipment) if (e.place === 'line' && e.id !== conveyor) throw new PlacementError(`"${e.id}": only the conveyor ("${conveyor}") takes place "line"; use upstream / downstream for machines in line`);

    const c = placed.get(conveyor);
    const toStation = (local) => [c.position[0] + local[0], local[1], c.position[2] + local[2]]; // the conveyor is never turned
    const along = (at) => {
      const ports = c.spec.ports ?? {};
      if (at === 'whole') return (c.rect.x0 + c.rect.x1) / 2;
      if (at === 'work') {
        const work = ports.work ?? Object.values(ports).find((p) => p.direction === 'work');
        if (work) return toStation(work.position)[0];
        const ins = ports.input ?? Object.values(ports).find((p) => p.direction === 'in');
        const outs = ports.output ?? Object.values(ports).find((p) => p.direction === 'out');
        return ins && outs ? (toStation(ins.position)[0] + toStation(outs.position)[0]) / 2 : (c.rect.x0 + c.rect.x1) / 2;
      }
      const p = ports[at] ?? Object.values(ports).find((q) => q.direction === (at === 'input' ? 'in' : 'out'));
      return p ? toStation(p.position)[0] : at === 'input' ? c.rect.x0 : c.rect.x1;
    };
    const workPort = (s) => Object.values(s.ports ?? {}).find((p) => p.direction === 'work') ?? null;
    /** The height units ride at on the conveyor (its ports' height), in the station frame. */
    const conveyorTop = () => {
      const p = Object.values(c.spec.ports ?? {})[0];
      return p ? toStation(p.position)[1] : (ctxOf(c.e).beltHeight ?? CONVENTIONS.beltHeight);
    };
    const footCentreZ = (s) => (s.footprint.z[0] + s.footprint.z[1]) / 2;
    const groupBy = (list, key) => {
      const groups = new Map();
      for (const it of list) (groups.get(key(it)) ?? groups.set(key(it), []).get(key(it))).push(it);
      return groups;
    };
    // Side by side along X, centred on a point: the origin x of each.
    const sideBySide = (list, centre) => {
      const widths = list.map(({ s }) => s.footprint.x[1] - s.footprint.x[0]);
      const total = widths.reduce((a, b) => a + b, 0) + SIDE_GAP * (list.length - 1);
      let x = centre - total / 2;
      return list.map(({ s }, i) => { const left = x; x += widths[i] + SIDE_GAP; return left - s.footprint.x[0]; });
    };

    const order = ['overLine', 'upstream', 'downstream', 'besideLine', 'rear', 'front', 'onTop'];
    for (const place of order) {
      const items = equipment.filter((e) => e.place === place).map((e) => ({ e, s: spec(e) }));
      if (!items.length) continue;

      if (place === 'overLine') {
        for (const { e, s } of items) {
          const w = workPort(s);
          const x = along(e.at);
          // A component that stands on a surface (a photo-eye on the side frames) stands on the
          // conveyor's top, the surface units ride on, not on the floor under it.
          const y = registry.getComponent(e.type).mount === 'surface' ? conveyorTop() : 0;
          if (w) put(e, s, [x - w.position[0], y, c.position[2] - w.position[2]]);
          else put(e, s, [x, y, c.position[2]]); // its origin on the conveyor's centre line
        }
      } else if (place === 'upstream' || place === 'downstream') {
        for (const { e, s } of items) {
          const up = place === 'upstream';
          const mine = Object.values(s.ports ?? {}).find((p) => p.direction === (up ? 'out' : 'in'));
          const theirs = Object.values(c.spec.ports ?? {}).find((p) => p.direction === (up ? 'in' : 'out'));
          if (mine && theirs) {
            const target = toStation(theirs.position);
            put(e, s, [target[0] - mine.position[0], 0, target[2] - mine.position[2]]);
          } else {
            put(e, s, [up ? c.rect.x0 - s.footprint.x[1] : c.rect.x1 - s.footprint.x[0], 0, c.position[2] - footCentreZ(s)]);
          }
        }
      } else if (place === 'besideLine') {
        for (const list of groupBy(items, (x) => `${x.e.at}|${x.e.side ?? 'equipment'}`).values()) {
          const walkway = list[0].e.side === 'walkway';
          const sign = walkway ? 1 : -1;
          const edge = walkway ? c.rect.z1 : c.rect.z0;
          const straight = list.filter((x) => !x.e.turned);
          const xs = sideBySide(straight, along(list[0].e.at));
          straight.forEach(({ e, s }, i) => {
            // A tool that reaches into the line (lib/station/reach.js): turned to face the line, its
            // retracted port just outside the conveyor's edge (its stroke may pass over it).
            const def = registry.getComponent(e.type);
            if (reachesLine(e)) { stepOut(e, s, along(e.at), edge, sign * STEP); return; }
            if (def.reach) {
              const reach = def.reach(s.params);
              const r = faceTurn(reach.toward, walkway ? 'walkway' : 'equipment');
              const port = turn(s.ports[reach.port].position, r);
              stepOut(e, s, along(e.at) - port[0], edge + sign * REACH_GAP - port[2], sign * STEP, r);
              return;
            }
            stepOut(e, s, xs[i], walkway ? edge - s.footprint.z[0] : edge - s.footprint.z[1], sign * STEP);
          });
          for (const { e, s } of list.filter((x) => x.e.turned)) {
            // Turned so its +X runs away from the line; its start (footprint x0) at the edge, its middle at `at`.
            const turn = walkway ? -Math.PI / 2 : Math.PI / 2;
            const x = along(e.at) + (walkway ? -footCentreZ(s) : footCentreZ(s));
            stepOut(e, s, x, walkway ? edge - s.footprint.x[0] : edge + s.footprint.x[0], sign * STEP, turn);
          }
        }
      } else if (place === 'rear' || place === 'front') {
        const sign = place === 'rear' ? -1 : 1;
        for (const list of groupBy(items, (x) => x.e.at).values()) {
          const xs = sideBySide(list, along(list[0].e.at));
          list.forEach(({ e, s }, i) => {
            const near = sign < 0 ? c.rect.z0 - GAP : c.rect.z1 + GAP;
            // A robot's footprint is its reach envelope: kept off the line, it could never reach it.
            // It stands by its real parts instead, from the conveyor's edge outward until they clear.
            if (reachesLine(e)) { stepOut(e, s, along(e.at), sign < 0 ? c.rect.z0 : c.rect.z1, sign * STEP); return; }
            stepOut(e, s, xs[i], sign < 0 ? near - s.footprint.z[1] : near - s.footprint.z[0], sign * STEP);
            // Behind something that runs the station's length (a fence)? The cell is too shallow for it.
            const r = placed.get(e.id).rect;
            const length = c.rect.x1 - c.rect.x0;
            const wall = [...placed.values()].find((o) => o.e.id !== e.id && o.e.id !== conveyor && o.rect.x1 - o.rect.x0 > 0.8 * length && o.height > 0.05
              // its middle beyond the wall's far face (their footprints may touch: real parts decide clashes)
              && (sign < 0 ? o.rect.z1 <= c.rect.z0 && (r.z0 + r.z1) / 2 <= o.rect.z0 + 1e-9 : o.rect.z0 >= c.rect.z1 && (r.z0 + r.z1) / 2 >= o.rect.z1 - 1e-9));
            if (wall) notes.push({ id: e.id, message: `"${e.id}" only fits behind "${wall.e.id}" (${wall.e.type}), which runs along the station: make the cell deeper on that side or pick a smaller machine` });
          });
        }
      } else if (place === 'onTop') {
        for (const it of items) {
          if (!it.e.on) throw new PlacementError(`"${it.e.id}": place onTop needs "on" (the machine it rests on)`);
          if (!placed.has(it.e.on)) throw new PlacementError(`"${it.e.id}": "${it.e.on}" is not placed (onTop of a machine placed with onTop is not supported)`);
        }
        for (const [baseId, list] of groupBy(items, (x) => x.e.on)) {
          const base = placed.get(baseId);
          const xs = sideBySide(list, (base.rect.x0 + base.rect.x1) / 2);
          list.forEach(({ e, s }, i) => put(e, s, [xs[i], base.position[1] + base.height, (base.rect.z0 + base.rect.z1) / 2 - footCentreZ(s)]));
        }
      }
    }

    for (const e of equipment) if (!placed.has(e.id)) throw new PlacementError(`"${e.id}": unknown place "${e.place}"`);
    return {
      equipment: equipment.map((e) => {
        const p = placed.get(e.id);
        const out = { id: e.id, type: e.type, params: e.params ?? {}, position: p.position, rotationY: p.rotationY }; // angles exact (the compiler writes Math.PI / 2)
        if (e.beltHeight !== undefined) out.beltHeight = e.beltHeight;
        return out;
      }),
      notes,
    };
  } finally {
    for (const inst of built) inst.dispose?.();
  }
}
