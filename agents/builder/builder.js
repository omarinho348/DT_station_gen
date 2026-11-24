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
import { placeStation, PlacementError } from '../../lib/station/place.js';
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
  // The stable start of every prompt (instructions + catalog): the same bytes for the whole session.
  const system = `${readFileSync(INSTRUCTIONS, 'utf8').trim()}\n\nCATALOG\n${JSON.stringify(catalogIndex(registry))}`;
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
      previous: prev ? { id: prev.id, title: prev.title } : null,
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

  /** factory.json of these stations (in flow order), chained output → input over the line's transport. */
  function factoryOf(job, stations) {
    const transport = { kind: 'conveyor', type: job.line.transport.type, params: job.line.transport.params ?? {} };
    return {
      version: 1,
      line: { id: job.line.id, title: job.line.title, runSize: job.line.runSize ?? 8, ...(job.line.conventions ? { conventions: job.line.conventions } : {}) },
      product: job.product,
      stations,
      graph: { edges: stations.slice(1).map((s, i) => ({ from: `${stations[i].id}.output`, to: `${s.id}.input`, transport })) },
    };
  }

  // ---- The phases ---------------------------------------------------------------------------------

  async function layoutPhase(job, build, feedback) {
    const def = layoutSchema(registry);
    const r = await ask(def, taskText('layout', { ...lineContext(job), plan: job.plan, previousAnswer: feedback ? build.layout : null, feedback }));
    const layout = def.decode(r.output);
    const problems = [];
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
    if (layout.shell) {
      try {
        shellIds = registry.expandShell(layout.shell.type, layout.shell.params ?? {}, ctx(job.line)).equipment.map((e) => e.id);
      } catch (error) {
        problems.push(`shell.params (${layout.shell.type}): ${error.message}`);
        return { value: layout, cost: r.cost, problems };
      }
    }
    for (const id of shellIds) if (ids.has(id)) problems.push(`equipment: "${id}" is already a machine of the shell`);
    if (!ids.has(layout.conveyor) && !shellIds.includes(layout.conveyor)) problems.push(`conveyor: "${layout.conveyor}" is neither a listed machine nor the shell's (${shellIds.join(', ') || 'no shell'})`);
    for (const p of layout.ports ?? []) if (!ids.has(p.machine) && !shellIds.includes(p.machine)) problems.push(`ports.${p.name}: unknown machine "${p.machine}"`);
    return { value: layout, cost: r.cost, problems };
  }

  async function machinesPhase(job, state, feedback) {
    const { layout } = state;
    const def = machinesSchema(registry, layout.equipment);
    const detail = catalogDetail(registry, { types: layout.equipment.map((e) => e.type) });
    const r = await ask(def, taskText('machines', { ...lineContext(job), plan: job.plan, layout, detail: detail.components, previousAnswer: feedback ? state.params : null, feedback }));
    const params = def.decode(r.output).params;
    const problems = [];
    for (const [j, e] of layout.equipment.entries()) {
      try { registry.componentSpec(e.type, params[e.id] ?? {}, ctx(job.line)); } catch (error) { problems.push(`equipment[${j}].params (${e.id}): ${error.message}`); }
    }
    return { value: params, cost: r.cost, problems };
  }

  function place(job, state) {
    const { layout, params } = state;
    const shell = layout.shell ? registry.expandShell(layout.shell.type, layout.shell.params ?? {}, ctx(job.line)) : null;
    const r = placeStation(registry, {
      conveyor: layout.conveyor,
      fixed: shell?.equipment ?? [],
      equipment: layout.equipment.map((e) => ({ ...e, params: params[e.id] ?? {} })),
      ctx: ctx(job.line),
    });
    return { placed: r.equipment, notes: r.notes, machines: [...(shell?.equipment ?? []).map((e) => e.id), ...layout.equipment.map((e) => e.id)] };
  }

  async function processPhase(job, state, feedback) {
    const { layout, placed, machines } = state;
    const def = processSchema(registry, { ops: layout.ops, machines });
    const types = [...new Set([...placed.map((e) => e.type), ...(layout.shell ? registry.expandShell(layout.shell.type, layout.shell.params ?? {}, ctx(job.line)).equipment.map((e) => e.type) : [])])];
    const detail = catalogDetail(registry, { types, ops: layout.ops });
    const station = { id: layout.id, conveyor: layout.conveyor, machines: placed.map((e) => ({ id: e.id, type: e.type, position: e.position })), ports: layout.ports ?? [] };
    const r = await ask(def, taskText('process', { ...lineContext(job), plan: job.plan, station, detail, previousAnswer: feedback ? state.process : null, feedback }));
    return { value: def.decode(r.output), cost: r.cost, problems: [] };
  }

  /** A fresh build of one station: where it starts, what was refused, what it cost. Plain JSON. */
  const newBuild = () => ({ from: 'layout', feedback: null, attempts: [], cost: 0, layout: null, params: null, placed: null, notes: [], machines: null, process: null });

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
        if (r.problems.length) { refuse('layout', r.problems); continue; }
        build.from = 'machines'; build.feedback = null;
        if (stop === 0) {
          // The preview: default params, placed from the hints. A hint that can't be placed is refused.
          build.params = {};
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
        if (r.problems.length) { refuse('machines', r.problems); continue; }
        try {
          Object.assign(build, place(job, build));
        } catch (error) {
          if (!(error instanceof PlacementError)) throw error;
          refuse('layout', [`placement: ${error.message}`]);
          continue;
        }
        build.process = null;
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
    if (phase !== 'process') build.process = null;
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
