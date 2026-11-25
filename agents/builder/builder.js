// The Builder agent (Claude.md §7.2): turns one planned station at a time into factory.json data,
// in three phases, each answer typed by its schema (agents/builder/schemas.js), checked in code, and
// reviewed by the deterministic reviewer before the next (rule 3). The model only writes JSON (rule 1).
//
//   const builder = createBuilder({ registry, llm, root });
//   const r = await builder.buildStation({ line, product, stations, plan });
//   r → { ok, station, factory, notes, attempts, cost, findings? }
//
//   With approval gates (step 8.5): const build = builder.newBuild();
//   await builder.advance(job, build, { stopAfter: 'layout' })   → the layout draft; then 'machines',
//   then 'process'. builder.rejectGate(build, phase, comment) sends the owner's comment back to that phase.
//
//   line      { id, title, runSize?, conventions?, transport: { type, params? } }  (transport: the catalog
//             conveyor between stations, from the plan; the Builder doesn't choose it)
//   product   factory.json's product (catalog / parametric / glb)
//   stations  the stations built so far (factory.json station objects), in flow order
//   plan      this station from plan.md: { title, does, steps: [...], id?, notes? }
//
// Phases: layout (what and where, as hints) → machines (params) → placement (lib/station/place.js,
// no model) → process (ops). A refusal goes back to the phase it belongs to, with the findings, at most
// `maxRetries` times per station; after that the station is handed to the owner with the findings.
// Every model call goes through the LLM layer (budget guard, cache, mock mode).
import { readFileSync } from 'node:fs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { layoutSchema, machinesSchema, processSchema } from './schemas.js';
import { catalogIndex, catalogDetail } from '../../lib/catalog.js';
import { recipeLines, stationRecipes, candidatesFor, expandRecipes } from '../../lib/recipes.js';
import { paramFields } from '../../lib/registry.js';
import { placeStation, PlacementError } from '../../lib/station/place.js';
import { measureUnit } from '../../lib/station/unit.js';
import { reachPose, reachNeeded, workPlaceOf } from '../../lib/station/reach.js';
import { review, formatFindings } from '../reviewer/deterministic.js';
import { compileFactory } from '../../compiler/emit.js';
import { writeCompiled } from '../../compiler/write.js';
import { CONVENTIONS } from '../../lib/core/conventions.js';

const INSTRUCTIONS = new URL('../prompts/builder.md', import.meta.url);
const PHASES = ['layout', 'machines', 'process'];

export class BuilderError extends Error {}

/** Which phase a reviewer finding belongs to (by its check and path in factory.json). */
export function phaseOf(finding, stationIndex) {
  const base = `stations[${stationIndex}]`;
  if (finding.check === 'geometry') return 'layout';
  if (finding.path?.startsWith(`${base}.equipment`) && /\.params/.test(finding.path)) return 'machines';
  if (finding.path?.startsWith(`${base}.equipment`) || finding.path?.startsWith(`${base}.shell`) || finding.path?.startsWith(`${base}.ports`)) return 'layout';
  // A station port naming a machine or port that isn't there is the layout's, wherever it is reported
  // (the station's build reports it at the station's path; it went back to the process phase before).
  if (/\bport "[^"]+": (unknown )?machine "[^"]+"/.test(finding.message ?? '')) return 'layout';
  return 'process';
}

/**
 * @param {object} o
 * @param {object} o.registry
 * @param {object} o.llm          the LLM layer (agents/llm.js): { call }
 * @param {string} [o.root]       project root (drafts go to generated/_draft/)
 * @param {number} [o.maxRetries] refusals sent back per station before the owner gets it (Claude.md: 2)
 * @param {boolean} [o.play]      also play the run once a station passes (reach of worked-out targets)
 */
export function createBuilder({ registry, llm, root = null, maxRetries = 2, play = true }) {
  // The stable start of every prompt (instructions + catalog + the machines' routines): the same bytes
  // for the whole session. The routines are the Builder's alone, so the other agents' prompts (and
  // their recorded answers) stay as they were.
  const system = `${readFileSync(INSTRUCTIONS, 'utf8').trim()}\n\nCATALOG\n${JSON.stringify(catalogIndex(registry))}\n\nROUTINES (type.routine(args) — what it does)\n${JSON.stringify(recipeLines(registry))}`;
  const ctx = (line) => ({ beltHeight: line.conventions?.beltHeight ?? CONVENTIONS.beltHeight });

  const ask = async (schemaDef, task) => llm.call({
    agent: 'builder',
    schemaName: schemaDef.name,
    schema: schemaDef.schema,
    messages: [{ role: 'system', content: system }, { role: 'user', content: task }],
  });

  /** The variable part of a prompt: what this phase needs, as labelled JSON sections (stable key order). */
  const taskText = (phase, sections) => [`PHASE ${phase}`, ...Object.entries(sections).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => `${k.replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase()}\n${typeof v === 'string' ? v : JSON.stringify(v)}`)].join('\n\n');

  /** What the model is told about the line around this station. */
  const lineContext = (job) => {
    const prev = job.stations.at(-1);
    const productDef = registry.getProduct(job.product.kind === 'catalog' ? job.product.type : job.product.kind === 'glb' ? 'model' : 'parametric');
    return {
      line: { id: job.line.id, title: job.line.title, beltHeight: ctx(job.line).beltHeight },
      product: { ...job.product, stages: productDef?.stages, facts: productDef ? Object.keys(productDef.facts ?? {}) : [] },
      previous: prev ? { id: prev.id, title: prev.title, handsOver: goodsOf(job, prev) } : null,
      ids: job.stations.map((s) => s.id),
    };
  };

  /** The station as factory.json data from the phases' results. */
  function assemble(job, state) {
    const { layout, params, placed, process } = state;
    const shell = layout.shell ? registry.expandShell(layout.shell.type, layout.shell.params ?? {}, ctx(job.line)) : null;
    const ports = {};
    for (const p of layout.ports ?? []) ports[p.name] = { machine: p.machine, port: p.port, direction: p.direction };
    const station = {
      id: layout.id,
      ...(layout.code ? { code: layout.code } : {}),
      title: layout.title,
      ...(layout.shell ? { shell: { type: layout.shell.type, params: layout.shell.params ?? {} } } : {}),
      equipment: (placed ?? layout.equipment.map((e) => ({ id: e.id, type: e.type, params: params?.[e.id] ?? {}, position: [0, 0, 0], rotationY: 0 }))),
      conveyor: layout.conveyor,
      ...(Object.keys(ports).length ? { ports } : {}),
      ...(process?.inputStage ? { inputStage: process.inputStage } : {}),
      ...(process?.intake ? { intake: process.intake } : {}),
      process: process?.process ?? [],
      ...(process?.output ? { output: process.output } : {}),
      // New units rise from a return line only where the shell gives the input port a stand-alone lift.
      feed: { fromLift: Boolean(shell?.station.ports?.input?.standalone?.length) },
    };
    return station;
  }

  /** factory.json with the stations so far plus this one, chained output → input. */
  function factoryWith(job, station) {
    return factoryOf(job, [...job.stations, station]);
  }

  /** A station's conveyor entry ({ type, params }): its own, or its shell's. */
  function conveyorOf(job, station) {
    try {
      const shellEq = station.shell ? registry.expandShell(station.shell.type, station.shell.params ?? {}, ctx(job.line)).equipment : [];
      return [...(station.equipment ?? []), ...shellEq].find((e) => e.id === station.conveyor) ?? null;
    } catch {
      return null;
    }
  }

  /** What a conveyor entry takes in or hands out: unit, batch, case or pallet. */
  function goodsAt(job, conveyor, direction) {
    try {
      const ports = conveyor ? Object.values(registry.componentSpec(conveyor.type, conveyor.params ?? {}, ctx(job.line)).ports ?? {}) : [];
      return ports.find((p) => p.direction === direction)?.carries ?? null;
    } catch {
      return null;
    }
  }

  /** What a station hands over at its output (its conveyor's output port). */
  const goodsOf = (job, station) => goodsAt(job, conveyorOf(job, station), 'out');

  /**
   * Can a catalog type serve as a line conveyor for these goods: a station's conveyor, or the transfer
   * between two stations? It needs ports named input and output carrying them (a station's input /
   * output default to those names) and a length (a transfer stretches over the gap). A lift (top /
   * bottom, fixed size) carries pallets too but is neither: picked by goods alone, it left station 2
   * with no input port and a void between the stations (owner report, 2026-11-25).
   */
  const conveysCache = new Map();
  function conveys(type, goods) {
    const k = `${type}|${goods}`;
    if (!conveysCache.has(k)) {
      let ok = false;
      try {
        const def = registry.getComponent(type);
        const ports = registry.componentSpec(type, {}, {}).ports ?? {};
        ok = ['conveyor', 'transport'].includes(def.category)
          && ports.input?.direction === 'in' && ports.output?.direction === 'out'
          && (!goods || (ports.input.carries === goods && ports.output.carries === goods))
          && paramFields(def.params).some((f) => f.key === 'length');
      } catch { ok = false; }
      conveysCache.set(k, ok);
    }
    return conveysCache.get(k);
  }

  /**
   * A transfer's params from a conveyor's: without `length` (it comes from the layout: the gap it
   * fills), and without a work place where the type has one to switch off (a transfer only carries;
   * a pallet conveyor's work stop also wants the conveyor longer than its carrier, which a short
   * transfer is not: as the printer line's hand-written transfers).
   */
  const transferParams = (type, params = {}) => {
    const out = Object.fromEntries(Object.entries(params).filter(([k]) => k !== 'length'));
    const field = paramFields(registry.getComponent(type).params).find((f) => f.key === 'workStop');
    if (field?.kind === 'boolean') out.workStop = false;
    return out;
  };

  /**
   * The transport of the edge after `station`, for the goods it hands over: the plan's, if it conveys
   * them; else the station's own conveyor type (the same carriers: a pallet station is followed by a
   * pallet conveyor), with its params of the same name (a carrier length); else the first catalog
   * conveyor that conveys them. Never a fixed length: the transfer fills the gap.
   */
  function transportAfter(job, station) {
    const planned = job.line.transport.type;
    const goods = goodsOf(job, station);
    if (conveys(planned, goods)) return { kind: 'conveyor', type: planned, params: transferParams(planned, job.line.transport.params) };
    const own = conveyorOf(job, station);
    if (own && conveys(own.type, goods)) return { kind: 'conveyor', type: own.type, params: transferParams(own.type, own.params) };
    const other = conveyorFor(job, goods);
    return { kind: 'conveyor', type: other ?? planned, params: transferParams(other ?? planned, other ? {} : job.line.transport.params) };
  }

  /** factory.json of these stations (in flow order), chained output → input over the right transports. */
  function factoryOf(job, stations) {
    return {
      version: 1,
      line: { id: job.line.id, title: job.line.title, runSize: job.line.runSize ?? 8, ...(job.line.conventions ? { conventions: job.line.conventions } : {}) },
      product: job.product,
      stations,
      graph: { edges: stations.slice(1).map((s, i) => ({ from: `${stations[i].id}.output`, to: `${s.id}.input`, transport: transportAfter(job, stations[i]) })) },
    };
  }

  // ---- The phases ---------------------------------------------------------------------------------

  const productType = (job) => (job.product.kind === 'catalog' ? job.product.type : job.product.kind === 'glb' ? 'model' : 'parametric');

  async function layoutPhase(job, build, feedback) {
    const def = layoutSchema(registry, { product: productType(job) });
    const r = await ask(def, taskText('layout', { ...lineContext(job), plan: job.plan, shells: shellsProvide(job), previousAnswer: feedback ? build.layout : null, feedback }));
    const layout = def.decode(r.output);
    const problems = [];
    const repairs = [];
    // Lengths strict mode can't carry (the schema drops maxLength): shortened in code, at a word.
    if (layout.title?.length > 40) {
      const cut = layout.title.slice(0, 41).replace(/\s+\S*$/, '').slice(0, 40) || layout.title.slice(0, 40);
      repairs.push(`title: "${layout.title}" is over 40 characters; shortened to "${cut}"`);
      layout.title = cut;
    }
    if (layout.code?.length > 8) { repairs.push(`code: "${layout.code}" is over 8 characters; shortened`); layout.code = layout.code.slice(0, 8); }
    const ids = new Set();
    for (const [j, e] of layout.equipment.entries()) {
      if (ids.has(e.id)) problems.push(`equipment[${j}].id: "${e.id}" is used twice`);
      ids.add(e.id);
      if (e.place === 'onTop' && !e.on) problems.push(`equipment[${j}].on: place onTop needs the machine it rests on`);
    }
    if (job.stations.some((s) => s.id === layout.id)) problems.push(`id: "${layout.id}" is already a station of this line`);
    // A shell whose params break its own rules (cross-field, beyond the schema's ranges) is a refusal,
    // not a crash (found by the first live call, step 8.6).
    let shellIds = [];
    let shellConveyor = null;
    if (layout.shell) {
      try {
        const expanded = registry.expandShell(layout.shell.type, layout.shell.params ?? {}, ctx(job.line));
        shellIds = expanded.equipment.map((e) => e.id);
        shellConveyor = expanded.station?.conveyor ?? null;
      } catch (error) {
        problems.push(`shell.params (${layout.shell.type}): ${error.message}`);
        return { value: layout, cost: r.cost, problems };
      }
    }
    for (const id of shellIds) if (ids.has(id)) problems.push(`equipment: "${id}" is already a machine of the shell`);
    // A conveyor id that names nothing, in a shell with its own conveyor: the shell's, in code (the
    // models kept inventing "st1Conveyor" for the shell's "line"; benchmark tuning set, step 12.2).
    // Without a shell: the station's one conveyor, if it has exactly one.
    const ownConveyors = layout.equipment.filter((e) => registry.getComponent(e.type)?.category === 'conveyor').map((e) => e.id);
    const repairTo = shellConveyor ?? (ownConveyors.length === 1 ? ownConveyors[0] : null);
    // No conveyor at all (no shell, none listed): the station gets its own, of the line's transport type.
    if (!ids.has(layout.conveyor) && !shellIds.includes(layout.conveyor) && !repairTo && !layout.shell) {
      layout.equipment = [{ id: layout.conveyor, type: job.line.transport.type, why: 'the station conveyor (added: the station had none)', place: 'line', at: 'whole' }, ...layout.equipment];
      ids.add(layout.conveyor);
      repairs.push(`conveyor: the station had none; "${layout.conveyor}" (${job.line.transport.type}, the line's transport) is added`);
    }
    if (!ids.has(layout.conveyor) && !shellIds.includes(layout.conveyor) && repairTo) {
      repairs.push(`conveyor: "${layout.conveyor}" is no machine of the station; ${shellConveyor ? "the shell's" : 'its'} conveyor "${repairTo}" is used`);
      layout.conveyor = repairTo;
    }
    if (!ids.has(layout.conveyor) && !shellIds.includes(layout.conveyor)) problems.push(`conveyor: "${layout.conveyor}" is neither a listed machine nor the shell's (${shellIds.join(', ') || 'no shell'})`);
    // What this station takes in must be what the previous one hands over. The model was told so, with
    // the fix spelled out, and still kept choosing pallet carriers after a station handing over loose
    // units (benchmark step 13.3: 2 of the 5 held-out stops). There is one right answer, so it is
    // chosen in code: the station's conveyor becomes one that takes those goods.
    const prev = job.stations.at(-1);
    if (prev && (ids.has(layout.conveyor) || shellIds.includes(layout.conveyor))) {
      const given = goodsOf(job, prev);
      const conv = [...layout.equipment, ...shellEquipmentOf(job, layout)].find((e) => e.id === layout.conveyor);
      const taken = conv ? goodsAt(job, { type: conv.type, params: conv.params ?? {} }, 'in') : null;
      if (given && taken && given !== taken) {
        const type = conveyorFor(job, given);
        if (!type) {
          problems.push(`conveyor: this station takes ${taken} at its input ("${layout.conveyor}", ${conv.type}), but "${prev.id}" hands over ${given}: use a conveyor${layout.shell ? ' or shell' : ''} that takes ${given}`);
        } else if (shellIds.includes(layout.conveyor)) {
          // The shell's own conveyor: the shell's furniture is built around it, so the shell is left out
          // and the station gets its own conveyor under the same id (the machines' hints still hold).
          const shellType = layout.shell.type;
          const dropped = (layout.ports ?? []).filter((p) => shellIds.includes(p.machine) && p.machine !== layout.conveyor);
          delete layout.shell;
          layout.ports = (layout.ports ?? []).filter((p) => !dropped.includes(p));
          layout.equipment = [{ id: conv.id, type, why: `the station conveyor (added: the ${shellType} shell's takes ${taken})`, place: 'line', at: 'whole' }, ...layout.equipment];
          ids.add(conv.id);
          shellIds = [];
          shellConveyor = null;
          repairs.push(`conveyor: "${prev.id}" hands over ${given}, but the ${shellType} shell's conveyor "${conv.id}" (${conv.type}) takes ${taken}: the shell is left out and the station gets its own ${type} "${conv.id}"${dropped.length ? ` (ports on shell machines dropped: ${dropped.map((p) => p.name).join(', ')})` : ''}`);
        } else {
          repairs.push(`conveyor: "${prev.id}" hands over ${given}, but "${conv.id}" (${conv.type}) takes ${taken}: it is a ${type} now`);
          conv.type = type;
        }
      }
    }
    // Extra station ports (a reject port) must be a real port of a station machine. This was found only
    // when the line played, and that finding went back to the process phase, which can't change the
    // layout: refused 5 times (benchmark step 13.3: 2 of the 5 held-out stops). Now checked here, and
    // repaired in code where the answer is clear.
    fixPorts(job, layout, ids, shellIds, problems, repairs);
    // Every op the process will use needs a machine here that can do it (benchmark tuning set, step
    // 12.2: pick-and-place without a robot that has x / y / z / yaw failed only in the process phase).
    const stationTypes = [...layout.equipment.map((e) => e.type), ...(layout.shell ? registry.expandShell(layout.shell.type, layout.shell.params ?? {}, ctx(job.line)).equipment.map((e) => e.type) : [])];
    for (const op of layout.ops ?? []) {
      const def = registry.getOp(op);
      const needs = def?.needs ?? {};
      if (!needs.machineOp && !needs.motions?.length && !needs.valueMotion) continue;
      if (stationTypes.some((t) => typeCan(t, needs))) continue;
      const able = registry.components().map((d) => d.type).filter((t) => t !== 'composite' && typeCan(t, needs));
      problems.push(`ops: "${op}" needs a machine with ${describeNeeds(needs)}, and none of this station's machines has it${able.length ? ` (catalog types that do: ${able.slice(0, 8).join(', ')})` : ''}: add one, or use other ops`);
    }
    // The station's id comes from the plan (the model once reused the previous station's).
    if (job.plan?.id && layout.id !== job.plan.id && !job.stations.some((s) => s.id === job.plan.id)) {
      repairs.push(`id: "${layout.id}" is not the plan's; "${job.plan.id}" is used`);
      layout.id = job.plan.id;
      const i = problems.findIndex((p) => p.startsWith('id: '));
      if (i >= 0) problems.splice(i, 1);
    }
    return { value: layout, cost: r.cost, problems, repairs };
  }

  /** The shell's machines of a layout ([] without a shell, or when its params are refused). */
  function shellEquipmentOf(job, layout) {
    if (!layout.shell) return [];
    try { return registry.expandShell(layout.shell.type, layout.shell.params ?? {}, ctx(job.line)).equipment; } catch { return []; }
  }

  /**
   * A line conveyor type for these goods (`conveys`): the line's transport if it is one, else the first
   * catalog conveyor (then transport) that is. null when none is.
   */
  function conveyorFor(job, goods) {
    if (conveys(job.line.transport.type, goods)) return job.line.transport.type;
    const of = (category) => registry.components().filter((d) => d.category === category).map((d) => d.type).sort().find((t) => conveys(t, goods));
    return of('conveyor') ?? of('transport') ?? null;
  }

  /**
   * Checks the layout's extra station ports (mutates the layout): each must be a port of a station
   * machine, in its direction. Where the answer is clear it is repaired in code, in this order:
   *   1. the port named after a machine of the station (machine and port mixed up): that machine's port
   *   2. the named machine has exactly one port that way: that one
   *   3. exactly one other conveyor of the station has a port that way (the lane units leave on): that one
   *   4. an out port and no lane at all: a lane is added (beside the line, turned away from it)
   * Otherwise it is a refusal listing the ports there are.
   */
  function fixPorts(job, layout, ids, shellIds, problems, repairs) {
    const machines = [...layout.equipment, ...shellEquipmentOf(job, layout)];
    const portsOf = (m) => { try { return registry.componentSpec(m.type, m.params ?? {}, ctx(job.line)).ports ?? {}; } catch { return {}; } };
    const that = (m, direction) => Object.entries(portsOf(m)).filter(([, q]) => q.direction === direction).map(([n]) => n);
    const conveying = (m) => ['conveyor', 'transport'].includes(registry.getComponent(m.type)?.category);
    const byId = (id) => machines.find((m) => m.id === id);
    for (const p of layout.ports ?? []) {
      const m = byId(p.machine);
      if (m && portsOf(m)[p.port]) continue;
      const was = `"${p.machine}.${p.port}" is no port of the station`;
      const fix = (machine, port, why) => {
        repairs.push(`ports.${p.name}: ${was}; "${machine}.${port}" is used (${why})`);
        p.machine = machine;
        p.port = port;
      };
      const named = byId(p.port);
      if (named && that(named, p.direction).length === 1) { fix(named.id, that(named, p.direction)[0], `"${p.port}" is a machine: its ${p.direction} port`); continue; }
      if (m && that(m, p.direction).length === 1) { fix(m.id, that(m, p.direction)[0], `its only ${p.direction} port`); continue; }
      const lanes = machines.filter((x) => x.id !== layout.conveyor && conveying(x)).flatMap((x) => that(x, p.direction).map((n) => `${x.id}.${n}`));
      if (lanes.length === 1) { const [mid, port] = lanes[0].split('.'); fix(mid, port, `the station's only lane ${p.direction === 'out' ? 'out' : 'in'}`); continue; }
      if (!lanes.length && p.direction === 'out') {
        const conv = byId(layout.conveyor);
        const goods = (conv && goodsAt(job, { type: conv.type, params: conv.params ?? {} }, 'out')) ?? 'unit';
        const type = conveyorFor(job, goods);
        const out = type ? that({ type }, 'out')[0] : null;
        if (out) {
          let id = `${p.name}Lane`;
          for (let k = 2; ids.has(id) || shellIds.includes(id); k += 1) id = `${p.name}Lane${k}`;
          layout.equipment.push({ id, type, why: `takes the units leaving at the ${p.name} port (added: the station had no lane for it)`, place: 'besideLine', at: 'work', turned: true });
          ids.add(id);
          machines.push({ id, type });
          fix(id, out, `the station had no lane for it: a ${type} "${id}" is added beside the line, turned away from it`);
          continue;
        }
      }
      problems.push(`ports.${p.name}: ${was}${lanes.length ? ` (ports that way: ${lanes.join(', ')})` : ''}: name a port of one of the station's machines`);
    }
  }

  /** Can a catalog type (at its default params) do what an op needs? A composite can be anything. */
  const canCache = new Map();
  function typeCan(type, needs) {
    if (type === 'composite') return true;
    const k = `${type}|${JSON.stringify(needs)}`;
    if (!canCache.has(k)) {
      let ok = false;
      try {
        const spec = registry.componentSpec(type, {}, {});
        const motions = spec.motions ?? {};
        ok = (!needs.machineOp || (registry.getComponent(type).ops ?? []).includes(needs.machineOp))
          && (needs.motions ?? []).every((m) => m in motions)
          && (!needs.valueMotion || Object.values(motions).some((m) => m.values));
      } catch { ok = false; }
      canCache.set(k, ok);
    }
    return canCache.get(k);
  }
  const describeNeeds = (n) => [n.machineOp && `the op "${n.machineOp}"`, n.motions?.length && `motions ${n.motions.join(', ')}`, n.valueMotion && 'an on/off motion'].filter(Boolean).join(' and ');

  /** What each shell brings (its machines by id and type, and the conveyor units ride on): told to the layout phase. */
  function shellsProvide(job) {
    const list = registry.shells().map((d) => {
      try {
        const e = registry.expandShell(d.type, {}, ctx(job.line));
        return { type: d.type, conveyor: e.station?.conveyor ?? null, machines: e.equipment.map((m) => `${m.id}:${m.type}`) };
      } catch {
        return null;
      }
    }).filter(Boolean);
    return list.length ? list : null;
  }

  async function machinesPhase(job, state, feedback) {
    const { layout } = state;
    const def = machinesSchema(registry, layout.equipment);
    const detail = catalogDetail(registry, { types: layout.equipment.map((e) => e.type) });
    const r = await ask(def, taskText('machines', { ...lineContext(job), plan: job.plan, layout, detail: detail.components, previousAnswer: feedback ? state.params : null, feedback }));
    const params = def.decode(r.output).params;
    const problems = [];
    const repairs = [...singleUnitParams(layout, params), ...fitParams(job, layout, params)];
    for (const [j, e] of layout.equipment.entries()) {
      try { registry.componentSpec(e.type, params[e.id] ?? {}, ctx(job.line)); } catch (error) { problems.push(`equipment[${j}].params (${e.id}): ${error.message}`); }
    }
    return { value: params, cost: r.cost, problems, repairs };
  }

  /**
   * The Builder's stations serve one unit at a time: a machine that declares params for that
   * (`singleUnit`, e.g. one head instead of four) gets them, in code. Mutates params; returns notes.
   */
  function singleUnitParams(layout, params) {
    const notes = [];
    for (const e of layout.equipment) {
      const single = registry.getComponent(e.type)?.singleUnit;
      if (!single) continue;
      const before = params[e.id] ?? {};
      const changed = Object.entries(single).filter(([k, v]) => before[k] !== v);
      params[e.id] = { ...before, ...single };
      if (changed.length) notes.push(`${e.id}: ${changed.map(([k, v]) => `${k} ${before[k] ?? 'default'} → ${v}`).join(', ')} (this station serves one unit at a time)`);
    }
    return notes;
  }

  /** The line's unit, measured once per product (lib/station/unit.js): what machines are fitted to. */
  const units = new Map();
  const unitOf = (job) => {
    const key = JSON.stringify([job.product, ctx(job.line)]);
    if (!units.has(key)) units.set(key, measureUnit(registry, job.product, ctx(job.line)));
    return units.get(key);
  };

  /**
   * Params a machine fits to the unit it works on (`fit` in the component contract: a nozzle height at
   * the neck, a seat height at the cap seat), in code: the model can't measure the product. Mutates
   * params; returns notes. Values the fit gives that the params' ranges refuse are left as they were.
   */
  function fitParams(job, layout, params) {
    const unit = unitOf(job);
    const notes = [];
    if (!unit) return notes;
    for (const e of layout.equipment) {
      const def = registry.getComponent(e.type);
      if (!def?.fit) continue;
      const before = params[e.id] ?? {};
      let current;
      try { current = registry.componentSpec(e.type, before, ctx(job.line)).params; } catch { continue; }
      const patch = def.fit({ unit, params: current, ctx: ctx(job.line) }) ?? {};
      const changed = Object.entries(patch).filter(([k, v]) => Math.abs((current[k] ?? 0) - v) > 1e-4);
      if (!changed.length) continue;
      const next = { ...before, ...Object.fromEntries(changed) };
      try { registry.componentSpec(e.type, next, ctx(job.line)); } catch { continue; }
      params[e.id] = next;
      notes.push(`${e.id}: ${changed.map(([k, v]) => `${k} ${current[k]} → ${v}`).join(', ')} (fitted to the unit)`);
    }
    return notes;
  }

  function place(job, state) {
    const { layout } = state;
    const params = { ...(state.params ?? {}) };
    const shell = layout.shell ? registry.expandShell(layout.shell.type, layout.shell.params ?? {}, ctx(job.line)) : null;
    const run = () => placeStation(registry, {
      conveyor: layout.conveyor,
      fixed: shell?.equipment ?? [],
      equipment: layout.equipment.map((e) => ({ ...e, params: params[e.id] ?? {} })),
      ctx: ctx(job.line),
    });
    let r = run();
    // A reach-in tool (a tamp pad, a plug) that can't reach the unit from where it stands gets the
    // stroke it needs, and the station is placed again (its retracted tool stays at the conveyor's edge).
    const reachNotes = reachFit(job, layout, params, r.equipment, shell);
    if (reachNotes.length) r = run();
    return {
      params,
      placed: r.equipment,
      notes: [...(state.notes ?? []).filter((n) => n.repair && !n.reach), ...reachNotes.map((message) => ({ repair: true, reach: true, message })), ...r.notes],
      machines: [...(shell?.equipment ?? []).map((e) => e.id), ...layout.equipment.map((e) => e.id)],
    };
  }

  /** Lengthens reach-in strokes the unit is beyond (mutates params); returns notes. */
  function reachFit(job, layout, params, placed, shell) {
    const unit = unitOf(job);
    const notes = [];
    const conveyor = [...(shell?.equipment ?? []), ...placed].find((e) => e.id === layout.conveyor);
    if (!unit || !conveyor) return notes;
    const workAt = workPlaceOf(registry, conveyor, ctx(job.line));
    for (const e of placed) {
      const pose = (() => { try { return reachPose(registry, e, ctx(job.line)); } catch { return null; } })();
      if (!pose?.param) continue;
      const needed = reachNeeded(pose, unit, workAt);
      if (needed === null || needed <= pose.max) continue;
      const field = paramFields(registry.getComponent(e.type).params).find((f) => f.key === pose.param);
      const want = Math.round((needed + 0.005) * 1000) / 1000;
      const value = field?.max !== undefined ? Math.min(field.max, want) : want;
      params[e.id] = { ...(params[e.id] ?? {}), [pose.param]: value };
      notes.push(`${e.id}: ${pose.param} ${pose.max} → ${value} (to reach the unit${value < want ? `; it needs ${want}, more than the most it has` : ''})`);
    }
    return notes;
  }

  async function processPhase(job, state, feedback) {
    const { layout, placed, machines } = state;
    // Each machine's component ops and motions, so each op is offered only the machines it can drive.
    const shellEquipment = layout.shell ? registry.expandShell(layout.shell.type, layout.shell.params ?? {}, ctx(job.line)).equipment : [];
    const info = {};
    for (const e of [...shellEquipment, ...placed]) {
      try {
        const spec = registry.componentSpec(e.type, e.params ?? {}, ctx(job.line));
        info[e.id] = { ops: registry.getComponent(e.type).ops ?? [], motions: Object.keys(spec.motions ?? {}), valueMotions: Object.entries(spec.motions ?? {}).filter(([, m]) => m.values).map(([k]) => k) };
      } catch { /* the checks report it */ }
    }
    // The machines' routines (their standard processes) the product allows, each station arg limited
    // to the machines that fit it; a routine whose required station arg nothing here can fill is left out.
    const all = [...shellEquipment, ...placed];
    const productDef = registry.getProduct(productType(job));
    const recipes = stationRecipes(registry, all, { productDef }).map((r) => ({
      ...r,
      candidates: Object.fromEntries(Object.entries(r.def.stationArgs ?? {}).map(([k, rule]) => [k, candidatesFor(registry, rule, all, ctx(job.line), { exclude: r.machine })])),
    })).filter((r) => Object.entries(r.def.stationArgs ?? {}).every(([k, rule]) => rule.optional || r.candidates[k].length));
    const def = processSchema(registry, { ops: layout.ops, machines, info, items: ['product'], recipes });
    const types = [...new Set(all.map((e) => e.type))];
    const detail = catalogDetail(registry, { types, ops: layout.ops });
    const station = { id: layout.id, conveyor: layout.conveyor, machines: placed.map((e) => ({ id: e.id, type: e.type, position: e.position })), ports: layout.ports ?? [] };
    const routines = recipes.length ? recipes.map((r) => ({
      use: r.use,
      does: r.def.summary,
      args: Object.fromEntries(paramFields(r.def.args).map((f) => [f.key, [f.kind, f.min !== undefined ? `${f.min}–${f.max}` : null, f.default !== undefined ? `default ${f.default}` : null, f.label !== f.key ? f.label : null].filter(Boolean).join(', ')])),
      ...(Object.keys(r.candidates).length ? { machinesFor: r.candidates } : {}),
    })) : null;
    const r = await ask(def, taskText('process', { ...lineContext(job), plan: job.plan, station, routines, detail, previousAnswer: feedback ? (state.processAnswer ?? state.process) : null, feedback }));
    const answer = def.decode(r.output);
    // Routine calls become the plain ops they stand for: factory.json only ever holds ops.
    const expandCtx = { ctx: ctx(job.line), productDef, unit: unitOf(job) };
    const stationInfo = { conveyor: layout.conveyor, machines: all.map((e) => ({ id: e.id, type: e.type, params: e.params ?? {}, position: e.position, rotationY: e.rotationY ?? 0 })) };
    const problems = [];
    const value = { ...answer };
    for (const part of ['intake', 'process', 'output']) {
      if (!answer[part]) continue;
      const x = expandRecipes(registry, answer[part], stationInfo, { ...expandCtx, path: part });
      value[part] = x.ops;
      problems.push(...x.problems);
    }
    return { value, answer, cost: r.cost, problems };
  }

  /** A fresh build of one station: where it starts, what was refused, what it cost. Plain JSON. */
  const newBuild = () => ({ from: 'layout', feedback: null, attempts: [], cost: 0, layout: null, params: null, placed: null, notes: [], machines: null, process: null, processAnswer: null });

  /**
   * Runs a build on from where it stands (`build.from`) until the phase `stopAfter` has passed its
   * checks: the approval gates of Claude.md §7.2 (layout → machines → process). `build` is updated in
   * place (plain JSON, so a session can keep it) and the result says what there is now:
   *   { ok, phase, done, station, factory, notes, attempts, cost, findings }
   * phase: the gate reached ('layout' | 'machines' | 'process'); done: the station is complete.
   * Never throws for the model's mistakes: still failing after `maxRetries` refusals → ok false with the
   * findings. LLM-layer errors (budget, mock without a recording) are thrown: they need the owner.
   *
   * At the layout gate the machines stand at their default params, placed from the hints, with no
   * process yet (the preview); clashes there are shown, not refused (the params may still change them).
   */
  async function advance(job, build, { stopAfter = 'process' } = {}) {
    const index = job.stations.length;
    const stop = PHASES.indexOf(stopAfter);
    if (stop < 0) throw new BuilderError(`stopAfter must be one of ${PHASES.join(', ')}`);
    const base = `stations[${index}]`;
    const mine = (f) => f.path?.startsWith(base) || f.path === '(line)' || f.path?.startsWith('graph.') || f.check === 'geometry';
    const blockingOf = (findings, only = null) => findings.filter((f) => (!only || f.check === only) && mine(f) && (f.severity === 'error' || (f.check === 'geometry' && f.severity === 'warning')));
    const gate = (phase, findings) => {
      const station = assemble(job, build);
      return { ok: true, phase, done: phase === 'process', station, factory: factoryWith(job, station), notes: build.notes, attempts: build.attempts, cost: build.cost, findings };
    };
    const refuse = (phase, problems, findings = null) => {
      build.attempts.push({ phase, problems, ...(findings ? { findings } : {}) });
      build.from = phase;
      build.feedback = `Your ${phase} answer was refused. Fix these and keep the rest:\n${problems.map((p) => `- ${p}`).join('\n')}`;
    };

    while (build.attempts.length <= maxRetries) {
      if (build.from === 'layout') {
        const r = await layoutPhase(job, build, build.feedback);
        build.cost += r.cost;
        build.layout = r.value;
        build.notes = [...(build.notes ?? []).filter((n) => !n.repair), ...(r.repairs ?? []).map((message) => ({ repair: true, message }))];
        if (r.problems.length) { refuse('layout', r.problems); continue; }
        build.from = 'machines'; build.feedback = null;
        if (stop === 0) {
          // The preview: default params, placed from the hints. A hint that can't be placed is refused.
          build.params = {};
          singleUnitParams(build.layout, build.params);
          fitParams(job, build.layout, build.params);
          try {
            Object.assign(build, place(job, build));
          } catch (error) {
            if (!(error instanceof PlacementError)) throw error;
            refuse('layout', [`placement: ${error.message}`]);
            continue;
          }
          const result = review(registry, factoryWith(job, assemble(job, build)), { play: false });
          return gate('layout', result.findings.filter((f) => f.check === 'geometry' && mine(f)));
        }
      }
      if (build.from === 'machines') {
        const r = await machinesPhase(job, build, build.feedback);
        build.cost += r.cost;
        build.params = r.value;
        build.notes = [...(build.notes ?? []).filter((n) => !n.single), ...(r.repairs ?? []).map((message) => ({ repair: true, single: true, message }))];
        if (r.problems.length) { refuse('machines', r.problems); continue; }
        try {
          Object.assign(build, place(job, build));
        } catch (error) {
          if (!(error instanceof PlacementError)) throw error;
          refuse('layout', [`placement: ${error.message}`]);
          continue;
        }
        build.process = null;
        build.processAnswer = null;
        // Clashes are known now: refused before the process call is paid for.
        const result = review(registry, factoryWith(job, assemble(job, build)), { play: false });
        const clashes = blockingOf(result.findings, 'geometry');
        if (clashes.length) { refuse('layout', clashes.map((f) => `${f.path}: ${f.message}${f.hint ? ` (${f.hint})` : ''}`), clashes); continue; }
        build.from = 'process'; build.feedback = null;
        if (stop === 1) return gate('machines', result.findings.filter((f) => f.check === 'geometry' && mine(f)));
      }
      const r = await processPhase(job, build, build.feedback);
      build.cost += r.cost;
      build.process = r.value;
      build.processAnswer = r.answer;
      if (r.problems.length) { refuse('process', r.problems); continue; }

      // The deterministic reviewer on the line so far (fast checks and geometry; play once it passes).
      const factory = factoryWith(job, assemble(job, build));
      let result = review(registry, factory, { play: false });
      let blocking = blockingOf(result.findings);
      if (!blocking.length && play) {
        result = review(registry, factory, { play: true, geometry: false });
        blocking = result.findings.filter((f) => f.check === 'play' && f.severity === 'error');
      }
      if (!blocking.length) {
        build.from = 'done'; build.feedback = null;
        return gate('process', result.findings);
      }
      const phases = blocking.map((f) => phaseOf(f, index));
      const target = PHASES.find((p) => phases.includes(p));
      refuse(target, blocking.map((f) => `${f.path}: ${f.message}${f.hint ? ` (${f.hint})` : ''}`), blocking);
    }
    const station = build.layout ? assemble(job, build) : null;
    return { ok: false, phase: build.from, done: false, station, factory: station ? factoryWith(job, station) : null, notes: build.notes, attempts: build.attempts, cost: build.cost, findings: build.attempts.at(-1)?.findings ?? [] };
  }

  /**
   * The owner rejected what a gate showed: that phase runs again with their comment (and its previous
   * answer), with a fresh retry allowance. `phase` is the gate the comment is about.
   */
  function rejectGate(build, phase, comment) {
    if (!PHASES.includes(phase)) throw new BuilderError(`phase must be one of ${PHASES.join(', ')}`);
    build.from = phase;
    build.attempts = [];
    build.feedback = `The owner rejected your ${phase} answer with this comment: "${String(comment).trim()}". Change what the comment asks and keep the rest.`;
    if (phase === 'layout') { build.params = null; build.placed = null; }
    if (phase !== 'process') { build.process = null; build.processAnswer = null; }
    return build;
  }

  /** Builds one station through all three phases with retries (no gates). */
  const buildStation = (job) => advance(job, newBuild());

  /**
   * Writes a draft: factory.json and its compiled files under generated/_draft/<line>/ (the app loads
   * them by dynamic import), or with `rev` under generated/_draft/<line>/r<rev>/: every revision its own
   * URLs, so the browser never runs a cached station file of an older draft.
   * Returns { dir, folder, files, url } (url: the line module as the dev server serves it).
   */
  function writeDraft(factory, { rev = null } = {}) {
    if (!root) throw new BuilderError('writeDraft needs the project root');
    const compiled = compileFactory(registry, factory, { source: 'its draft factory.json', libPath: rev === null ? '../../../lib' : '../../../../lib' });
    const drafts = join(root, 'generated', '_draft');
    const out = rev === null ? writeCompiled(compiled, drafts) : writeCompiled({ ...compiled, folder: `r${rev}` }, join(drafts, compiled.folder));
    mkdirSync(out.dir, { recursive: true });
    writeFileSync(join(out.dir, 'factory.json'), `${JSON.stringify(factory, null, 2)}
`);
    const url = `/generated/_draft/${compiled.folder}${rev === null ? '' : `/r${rev}`}/line.js`;
    return { dir: out.dir, folder: compiled.folder, files: [...compiled.files.map((f) => f.name), 'factory.json'], url };
  }

  return { buildStation, advance, newBuild, rejectGate, writeDraft, assemble, factoryWith, factoryOf, system, formatFindings };
}
