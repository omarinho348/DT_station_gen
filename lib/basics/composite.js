// Composite equipment (Claude.md §6.6.1): a machine the catalog doesn't have, put together from
// parts, mostly basic blocks (a frame, axes, a tool), each mounted on a mount point (anchor) of a
// part before it. It is registered as one more component, type `composite`, whose params are the
// parts list. So a line, a dry plan, the timing table and the compiler handle it like any catalog
// machine (factory.json: `{ "id": "doser", "type": "composite", "params": { "parts": [...] } }`).
//
// Mounting (the basic-block conventions, tests/components/axes-tools.test.js):
//   - a part with `on: "part.anchor"` hangs from that mount point; without `on` it stands in the
//     composite's own frame (origin on the floor)
//   - a tool (mount 'tool') is placed with its mounting face (footprint height) at the mount point;
//     anything else with its origin there
//   - `position` / `rotationY` offset and turn the part from where it is mounted
//
// What the composite offers, named after its parts (part ids and names are camelCase):
//   motions  `<part><Motion>`  (head + extend → headExtend), unless the composite gives it a short name
//   ports    `<part><Port>`    (bed + input  → bedInput)
//   anchors  `<part><Anchor>` and `<part>` itself (the part's origin: a tool's tool point)
// plus short aliases the composite declares: motions / ports / anchors { name: "part.name" }
// (an anchor alias may name a part alone: { tool: "nozzle" }). A motion's short name replaces its
// part name (one name, one state); ports and mount points keep both.
//
// Footprint and port places are measured: the composite is built once headless (cached per
// params and belt height), its bounds taken at the default pose and with every motion at each end
// of its range, so the footprint holds the parts wherever their motions take them.
import * as THREE from 'three';
import { z } from 'zod';
import { defineComponent, registry } from '../registry.js';
import { createMaterials } from '../core/materials.js';

const camel = /^[a-z][a-zA-Z0-9]*$/;
const id = z.string().regex(camel, 'use camelCase, e.g. head');
const ref = z.string().regex(/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)?$/, 'use "part.name" (or "part" for a part\'s own origin)');
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const named = (part, name) => `${part}${cap(name)}`;

const Part = z.object({
  id,
  type: id.describe('Catalog component (usually a basic frame, axis or tool)'),
  params: z.record(z.string(), z.unknown()).default({}),
  on: ref.optional().describe('Mount point "part.anchor" of an earlier part; none: stands on the floor'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]).describe('Offset from where it is mounted (m)'),
  rotationY: z.number().min(-2 * Math.PI).max(2 * Math.PI).default(0).describe('Turn about the vertical (rad)'),
});

/**
 * The parts of the example the gallery shows: a dosing head over a conveyor (portal, hung Z-crossing
 * axis, vertical slide, nozzle). Only `parts` defaults to it: short names default to none, so a
 * composite that gives its own parts never inherits the example's aliases.
 * (zod does not parse default values, so the parts are parsed here, with every field filled in.)
 */
const EXAMPLE = {
  parts: [
    { id: 'frame', type: 'portalFrame', params: { span: 0.8, height: 1.5 } },
    { id: 'cross', type: 'linearAxis', params: { stroke: 0.5, hang: true }, on: 'frame.beam', rotationY: Math.PI / 2 },
    { id: 'lift', type: 'verticalAxis', params: { stroke: 0.25, bodyLength: 0.35 }, on: 'cross.carriage' },
    { id: 'nozzle', type: 'dispenseNozzle', params: { jetLength: 0.15 }, on: 'lift.ram' },
  ].map((part) => Part.parse(part)),
};

const specOf = (part, ctx) => registry.componentSpec(part.type, part.params, ctx);

/**
 * Everything the composite offers, from its parts' specs (no geometry): motions, port and anchor
 * names, each mapped to [part id, the part's own name]. Throws with a clear message on a bad list.
 */
function plan(p, ctx = {}) {
  const parts = new Map();
  const motions = {};
  const anchors = {};
  const portNames = {};
  const claim = (table, kind, name, target) => {
    if (table[name]) throw new Error(`${kind} "${name}" is offered twice (rename a part or an alias)`);
    table[name] = target;
  };
  for (const part of p.parts) {
    if (parts.has(part.id)) throw new Error(`part id "${part.id}" is used twice`);
    if (part.type === 'composite') throw new Error(`part "${part.id}": a composite cannot contain a composite`);
    if (!registry.components().some((d) => d.type === part.type)) throw new Error(`part "${part.id}": unknown component type "${part.type}"`);
    let spec;
    try {
      spec = specOf(part, ctx);
    } catch (error) {
      throw new Error(`part "${part.id}": ${error.message}`);
    }
    if (part.on) {
      const [host, anchor] = part.on.split('.');
      const hostPart = parts.get(host);
      if (!hostPart) throw new Error(`part "${part.id}": on "${part.on}": no earlier part "${host}"`);
      if (!anchor || !hostPart.spec.anchors.includes(anchor)) {
        throw new Error(`part "${part.id}": on "${part.on}": "${host}" (${hostPart.part.type}) has no mount point "${anchor ?? ''}" (mount points: ${hostPart.spec.anchors.join(', ') || 'none'})`);
      }
    }
    parts.set(part.id, { part, spec, mount: registry.getComponent(part.type).mount });
    for (const [m, s] of Object.entries(spec.motions)) claim(motions, 'motion', named(part.id, m), { part: part.id, name: m, spec: s });
    for (const name of Object.keys(spec.ports)) claim(portNames, 'port', named(part.id, name), { part: part.id, name });
    claim(anchors, 'mount point', part.id, { part: part.id, name: null });
    for (const a of spec.anchors) claim(anchors, 'mount point', named(part.id, a), { part: part.id, name: a });
  }
  const alias = (table, kind, aliases, has, list) => {
    for (const [name, target] of Object.entries(aliases)) {
      const [part, own] = target.split('.');
      const entry = parts.get(part);
      if (!entry) throw new Error(`${kind} alias "${name}": no part "${part}"`);
      if (own === undefined ? kind !== 'mount point' : !has(entry.spec, own)) {
        throw new Error(`${kind} alias "${name}": "${part}" (${entry.part.type}) has no ${kind} "${own ?? ''}" (${kind}s: ${list(entry.spec).join(', ') || 'none'})`);
      }
      claim(table, kind, name, { part, name: own ?? null, spec: own ? entry.spec.motions?.[own] : undefined });
    }
  };
  // A motion alias REPLACES the part-named motion, so every motion has exactly one name (and one
  // state: ops planning a motion by two names would lose track of it).
  const aliased = new Set();
  for (const [name, target] of Object.entries(p.motions)) {
    if (aliased.has(target)) throw new Error(`motion "${target}" has two short names (one is enough)`);
    aliased.add(target);
    const [part, own] = target.split('.');
    if (parts.has(part) && own && own in parts.get(part).spec.motions) delete motions[named(part, own)];
  }
  alias(motions, 'motion', p.motions, (s, n) => n in s.motions, (s) => Object.keys(s.motions));
  alias(portNames, 'port', p.ports, (s, n) => n in s.ports, (s) => Object.keys(s.ports));
  alias(anchors, 'mount point', p.anchors, (s, n) => s.anchors.includes(n), (s) => s.anchors);
  return { parts, motions, anchors, ports: portNames };
}

/** Builds the parts under one root, each on its mount point. Returns { root, insts: Map(id → instance) }. */
function assemble(p, ctx, materials) {
  const root = new THREE.Group();
  root.name = 'composite';
  const insts = new Map();
  for (const part of p.parts) {
    const inst = registry.buildComponent(part.type, part.params, { ...ctx, materials });
    const holder = new THREE.Group();
    holder.name = `Part ${part.id}`;
    holder.position.fromArray(part.position);
    holder.rotation.y = part.rotationY;
    // A tool hangs with its mounting face on the mount point; anything else stands on it.
    if (registry.getComponent(part.type).mount === 'tool') inst.root.position.y = -inst.footprint.height;
    holder.add(inst.root);
    if (part.on) {
      const [host, anchor] = part.on.split('.');
      insts.get(host).anchor(anchor).add(holder);
    } else {
      root.add(holder);
    }
    insts.set(part.id, inst);
  }
  return { root, insts };
}

let headless = null; // materials for measuring (never rendered)
const measured = new Map();

/** Footprint and port places, measured on a headless build (cached). */
function measure(p, ctx) {
  const key = JSON.stringify([p, ctx.beltHeight ?? null]);
  if (measured.has(key)) return measured.get(key);
  const layout = plan(p, ctx);
  headless ??= createMaterials();
  const { root, insts } = assemble(p, ctx, headless);
  const bounds = new THREE.Box3();
  const grow = () => {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!o.isMesh) return;
      for (let n = o; n && n !== root; n = n.parent) if (!n.visible) return;
      bounds.expandByObject(o);
    });
  };
  grow();
  for (const { part, name, spec } of Object.values(layout.motions)) {
    const inst = insts.get(part);
    const before = inst.state[name];
    for (const v of spec.range ?? spec.values) {
      inst.set(name, v);
      grow();
    }
    inst.set(name, before);
  }
  root.updateMatrixWorld(true);
  const ports = {};
  for (const [name, { part, name: own }] of Object.entries(layout.ports)) {
    const inst = insts.get(part);
    const port = inst.ports[own];
    const at = inst.root.localToWorld(new THREE.Vector3(...port.position));
    ports[name] = { position: at.toArray().map((v) => Math.round(v * 1e9) / 1e9), direction: port.direction, carries: port.carries };
  }
  const pad = 1e-6;
  const result = {
    footprint: {
      x: [bounds.min.x - pad, bounds.max.x + pad],
      z: [bounds.min.z - pad, bounds.max.z + pad],
      height: Math.max(bounds.max.y + pad, 0.001),
      bottom: Math.min(0, bounds.min.y - pad),
    },
    ports,
  };
  root.traverse((o) => { if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose(); });
  measured.set(key, result);
  return result;
}

const Params = z.object({
  parts: z.array(Part).min(1).max(16).default(EXAMPLE.parts).describe('The parts, each mounted on an earlier one (or standing on the floor)'),
  motions: z.record(id, ref).default({}).describe('Short motion names: { lower: "lift.extend" }'),
  ports: z.record(id, ref).default({}).describe('Short port names: { input: "bed.input" }'),
  anchors: z.record(id, ref).default({}).describe('Short mount point names: { tool: "nozzle" } (a part alone = its origin)'),
}).superRefine((p, issue) => {
  try {
    plan(p);
  } catch (error) {
    issue.addIssue({ code: 'custom', message: error.message, path: ['parts'] });
  }
});

defineComponent({
  type: 'composite',
  category: 'machine',
  summary: 'A machine put together from parts (basic frames, axes, tools), each on a mount point of an earlier one; motions, ports and mount points named after its parts.',
  params: Params,
  footprint: (p, ctx) => measure(p, ctx).footprint,
  mount: 'floor',
  ports: (p, ctx) => measure(p, ctx).ports,
  motions: (p, ctx) => Object.fromEntries(Object.entries(plan(p, ctx).motions).map(([name, m]) => [name, m.spec])),
  anchors: (p, ctx) => Object.keys(plan(p, ctx).anchors),
  build({ params: p, materials, ...ctx }) {
    const layout = plan(p, ctx);
    const { root, insts } = assemble(p, ctx, materials);
    const motions = Object.fromEntries(Object.entries(layout.motions).map(([name, m]) => [name, (v) => insts.get(m.part).set(m.name, v)]));
    const anchors = {};
    for (const [name, a] of Object.entries(layout.anchors)) {
      const inst = insts.get(a.part);
      if (a.name) {
        anchors[name] = inst.anchor(a.name);
      } else {
        // The part's own origin: an empty point at its root (a tool's tool point).
        let point = inst.root.getObjectByName(`Origin ${a.part}`);
        if (!point) {
          point = new THREE.Group();
          point.name = `Origin ${a.part}`;
          inst.root.add(point);
        }
        anchors[name] = point;
      }
    }
    return { root, motions, anchors };
  },
});
