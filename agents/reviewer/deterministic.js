// The deterministic reviewer (Claude.md §7.3, step 1): every check that can be done in code, run
// before any LLM looks at a line (rule 3). It reads a factory.json and returns findings
//
//   { check, severity: 'error' | 'warning' | 'info', path, message, hint? }
//
// path: where in factory.json (e.g. stations[1].process[0].to.lower), or "(line)" for the whole
// line. Errors mean the line cannot be built or played as written; warnings mean it plays but is
// not finished or not as asked (a placeholder, a takt target missed); info notes what a reader
// should know. Unlike checkFactory (which stops at the first problem), it collects every problem it
// can: schema issues, catalog references, every station on its own, then the line as a whole.
//
// Checks so far (step 7.1):
//   schema       factory.json against the IR schema
//   catalog      equipment, shell, product, transport and op types exist; equipment and product params valid
//   ops          every station's ops plan: machines, items and motions exist, values in range (dry run)
//   graph        the line as a whole: edges, ports, flow types, layout
//   placeholder  genericMachine stand-ins (warnings)
//   takt         the takt against line.taktTarget, with the bottleneck and what would help
//   opSupport    an op that needs its machine to declare it (fill, cap) on one that doesn't
// Step 7.2:
//   geometry     the line built headless: equipment, stations and transfers clashing (geometry.js)
// Step 7.3:
//   edges        every edge on its own: ports exist, output → input, the same flow type at both ends,
//                the edge's `carries`, a transport that carries it
//   play         the run played headless: targets worked out at run time out of reach (robots,
//                gantries), stations in ALARM, a run that stalls or loses units (play.js)
// Step 7.4 (reviewAll, async):
//   compiled     the compiled files import and build headless, the same line as the IR; files on
//                disk not stale (compiled.js)
// Nothing here knows a component by name (rule 6): it reads the registry and the data.
import { checkFactory, factoryWarnings, mergeConventions, expandStation } from '../../compiler/expand.js';
import { parseFactory } from '../../spec/factory.schema.js';
import { parseStation, resolvePorts } from '../../lib/station/stationSpec.js';
import { endpoint } from '../../lib/line/layout.js';
import { reviewGeometry } from './geometry.js';
import { reviewPlay } from './play.js';
import { reviewCompiled } from './compiled.js';

const PHASES = ['prepare', 'intake', 'process', 'output'];

/** A readable message for an error (a zod error's issues as "path: message", not its JSON). */
const messageOf = (error) => (Array.isArray(error?.issues) && error.issues.length && error.issues[0].code
  ? error.issues.map((i) => `${(i.path ?? []).join('.') || '(params)'}: ${i.message}`).join('; ')
  : error.message);

/** Every op entry of a station with its path, decide cases and indexing ops included. */
export function stationOps(station, base) {
  const out = [];
  const walk = (list, path) => (list ?? []).forEach((op, i) => {
    const at = `${path}[${i}]`;
    out.push({ op, path: at });
    if (op?.op === 'decide') for (const [k, ops] of Object.entries(op.cases ?? {})) walk(ops, `${at}.cases.${k}`);
  });
  for (const phase of PHASES) walk(station[phase], `${base}.${phase}`);
  const ix = station.indexing;
  if (ix) {
    walk(ix.index, `${base}.indexing.index`);
    walk(ix.exitOps, `${base}.indexing.exitOps`);
    (ix.work ?? []).forEach((w, i) => walk(w.ops, `${base}.indexing.work[${i}].ops`));
  }
  return out;
}

/**
 * The JSON path of a dry-plan error message ("station "cap" › process › op #1 (move) › case "reject"
 * › op #2 (transfer): …"), or the station's path when it names no op.
 */
export function opPathFromMessage(message, base) {
  let path = base;
  const parts = message.split(':')[0].split(' › ').slice(1);
  for (const part of parts) {
    const phase = /^(prepare|intake|process|output)$/.exec(part.trim());
    const op = /^op #(\d+)/.exec(part.trim());
    const kase = /^case "([^"]+)"/.exec(part.trim());
    if (phase) path += `.${phase[1]}`;
    else if (op) path += `[${Number(op[1]) - 1}]`;
    else if (kase) path += `.cases.${kase[1]}`;
  }
  return path;
}

/** A hint for common op problems (a value out of range: the range; an unknown name: the known ones are in the message). */
function opHint(message) {
  const range = /"([^"]+)"\.(\w+) must stay in \[([^\]]+)\], got ([-\d.e]+)/.exec(message);
  if (range) return `${range[1]}.${range[2]} reaches [${range[3]}]: aim inside it, or give the machine a longer stroke / reach`;
  if (/unknown op/.test(message)) return 'the known ops are listed in the message';
  return undefined;
}

/**
 * Reviews a factory.json. Returns { ok, findings, counts, timing? }: ok when there are no errors.
 * @param {object} registry  components, ops and products registered
 * @param {object} data      factory.json (parsed JSON)
 * @param {object} [o]       { geometry: false skips the clash check, play: false skips playing the run
 *                            (both build the line; without them only the fast checks run) }
 */
export function review(registry, data, { geometry = true, play = true } = {}) {
  const findings = [];
  const add = (check, severity, path, message, hint) => findings.push({ check, severity, path, message, ...(hint ? { hint } : {}) });

  // ---- schema ---------------------------------------------------------------------------------------
  let factory;
  try {
    factory = parseFactory(data);
  } catch (error) {
    for (const issue of error.issues ?? [{ path: '(file)', message: error.message }]) add('schema', 'error', issue.path, issue.message);
    return finish(findings);
  }

  // ---- catalog ----------------------------------------------------------------------------------------
  const componentTypes = new Set(registry.components().map((d) => d.type));
  const lineBelt = mergeConventions(factory.line.conventions).beltHeight;
  const opTypes = new Set(registry.ops().map((d) => d.op));
  let catalogOk = true;
  factory.stations.forEach((s, i) => {
    const base = `stations[${i}]`;
    if (s.shell) {
      try {
        registry.expandShell(s.shell.type, s.shell.params ?? {}, { beltHeight: lineBelt });
      } catch (error) {
        catalogOk = false;
        add('catalog', 'error', `${base}.shell`, messageOf(error));
      }
    }
    s.equipment.forEach((e, j) => {
      const at = `${base}.equipment[${j}]`;
      if (!componentTypes.has(e.type)) {
        catalogOk = false;
        add('catalog', 'error', `${at}.type`, `unknown component type "${e.type}"`, 'see the catalog (catalog.json / the gallery) for the types there are, or build it as a composite, or stand in a genericMachine');
        return;
      }
      try {
        registry.componentSpec(e.type, e.params ?? {}, { beltHeight: e.beltHeight ?? lineBelt });
      } catch (error) {
        catalogOk = false;
        add('catalog', 'error', `${at}.params`, messageOf(error));
      }
    });
    for (const { op, path } of stationOps(s, base)) {
      if (op?.op && !opTypes.has(op.op)) {
        catalogOk = false;
        add('catalog', 'error', `${path}.op`, `unknown op "${op.op}"`, `ops: ${[...opTypes].join(', ')}`);
      }
    }
  });
  factory.graph.edges.forEach((e, i) => {
    if (e.transport.type && !componentTypes.has(e.transport.type)) {
      catalogOk = false;
      add('catalog', 'error', `graph.edges[${i}].transport.type`, `unknown transport type "${e.transport.type}"`);
    }
  });
  if (factory.product.kind === 'catalog' && !registry.getProduct(factory.product.type)) {
    catalogOk = false;
    add('catalog', 'error', 'product.type', `unknown catalog product "${factory.product.type}"`, `products: ${registry.products().map((p) => p.type).join(', ')}`);
  }

  // ---- ops: every station planned on its own (so one bad station doesn't hide the others) ----------
  let stationsOk = catalogOk;
  if (catalogOk) {
    factory.stations.forEach((s, i) => {
      const alone = { ...data, stations: [data.stations[i]], graph: { edges: [] } };
      const r = checkFactory(registry, alone);
      if (r.ok) return;
      stationsOk = false;
      for (const e of r.errors) {
        const path = e.path === '(compile)' ? opPathFromMessage(e.message, `stations[${i}]`) : e.path.replace(/^stations\[0\]/, `stations[${i}]`);
        const message = e.message.replace(/^station "[^"]+" › /, '');
        add(e.path.startsWith('product') ? 'catalog' : 'ops', 'error', path, `station "${s.id}": ${message}`, opHint(e.message));
      }
    });
  }

  // ---- edges: every edge on its own, with the ports it joins -----------------------------------------
  let edgesOk = stationsOk;
  if (stationsOk) {
    for (const f of edgeFindings(registry, factory, lineBelt)) {
      add('edges', f.severity, f.path, f.message, f.hint);
      if (f.severity === 'error') edgesOk = false;
    }
  }

  // ---- graph: the line as a whole -------------------------------------------------------------------
  let timing = null;
  let expanded = null;
  if (edgesOk) {
    const r = checkFactory(registry, data);
    if (r.ok) {
      timing = r.timing;
      expanded = r.expanded;
    } else {
      for (const e of r.errors) add('graph', 'error', e.path === '(compile)' ? '(line)' : e.path, e.message);
    }
  }

  // ---- geometry: the line built headless, its parts tested against each other ------------------------
  if (expanded && geometry) findings.push(...reviewGeometry(registry, factory, expanded));

  // ---- play: the run played headless (targets worked out at run time, stalls) ----------------------------
  if (expanded && play) findings.push(...reviewPlay(registry, factory, expanded, timing));

  // ---- placeholders -------------------------------------------------------------------------------------
  for (const w of factoryWarnings(data)) add('placeholder', 'warning', w.path, w.message, 'the line plays with it; the Builder can try a composite of basic blocks');

  // ---- takt against its target --------------------------------------------------------------------------
  const target = factory.line.taktTarget;
  if (timing && target !== undefined) {
    const b = timing.bottleneck;
    if (timing.takt > target + 1e-9) {
      const where = b.kind === 'station' ? `station "${b.id}"${b.copies ? ` (${b.copies} copies)` : ''}` : `transfer ${b.id}`;
      const need = b.kind === 'station' ? Math.ceil(((b.copies ?? 1) * timing.takt) / target) : null;
      add('takt', 'warning', 'line.taktTarget', `takt ${timing.takt.toFixed(2)} s misses the target ${target} s: the bottleneck is ${where}`,
        b.kind === 'station'
          ? `shorten ${b.id}'s steps by ${(timing.takt - target).toFixed(2)} s, or run it as ${need} parallel copies (parallel: ${need})`
          : 'shorten the transfer (stations closer) or speed up the conveyor');
    } else {
      add('takt', 'info', 'line.taktTarget', `takt ${timing.takt.toFixed(2)} s meets the target ${target} s (bottleneck ${b.kind} ${b.id})`);
    }
  }

  // ---- op support: ops that need their machine to declare them ----------------------------------------
  factory.stations.forEach((s, i) => {
    const machines = Object.fromEntries(s.equipment.map((e) => [e.id, e]));
    for (const { op, path } of stationOps(s, `stations[${i}]`)) {
      const def = registry.getOp?.(op?.op);
      const needs = def?.needs?.machineOp;
      if (!needs || !op.machine || !machines[op.machine]) continue;
      const type = machines[op.machine].type;
      if (!componentTypes.has(type)) continue;
      const declared = registry.getComponent(type).ops ?? [];
      if (!declared.includes(needs)) {
        add('opSupport', 'warning', `${path}.machine`, `station "${s.id}": op "${op.op}" on "${op.machine}" (${type}), which does not declare "${needs}"`,
          'it plays if the machine has the motions the op drives (the dry plan checked them); prefer a machine made for it');
      }
    }
  });

  return finish(findings, timing);
}

/**
 * The edges checked one by one against the ports they join (the stations already planned fine):
 * [{ severity, path, message, hint? }]. Paths at the edge field the problem is about.
 */
export function edgeFindings(registry, factory, beltHeight) {
  const out = [];
  const error = (path, message, hint) => out.push({ severity: 'error', path, message, ...(hint ? { hint } : {}) });
  const portsOf = new Map();
  for (const s of factory.stations) {
    const { equipment, ...station } = expandStation(registry, s, { beltHeight });
    const specs = Object.fromEntries(equipment.map((e) => [e.id, registry.componentSpec(e.type, e.params ?? {}, { beltHeight: e.beltHeight ?? beltHeight })]));
    portsOf.set(s.id, resolvePorts(parseStation(station), specs));
  }
  const what = { in: 'an input', out: 'an output', work: 'the work place' };
  factory.graph.edges.forEach((e, k) => {
    const at = `graph.edges[${k}]`;
    const port = (field) => {
      let end;
      try { end = endpoint(e[field]); } catch (err) { error(`${at}.${field}`, err.message); return null; }
      const ports = portsOf.get(end.station);
      if (!ports) return null; // an unknown station: the schema said so
      const p = ports[end.port];
      if (!p) error(`${at}.${field}`, `station "${end.station}" has no port "${end.port}"`, `its ports: ${Object.keys(ports).join(', ')}`);
      return p ?? null;
    };
    const from = port('from');
    const to = port('to');
    if (from && from.direction !== 'out') error(`${at}.from`, `"${e.from}" is ${what[from.direction]}, not an output`, 'an edge runs from an output port (output, or an extra one such as reject) to an input port');
    if (to && to.direction !== 'in') error(`${at}.to`, `"${e.to}" is ${what[to.direction]}, not an input`, 'an edge runs from an output port to an input port (input)');
    if (!from || !to) return;
    if (from.carries !== to.carries) {
      error(at, `"${e.from}" gives ${from.carries} but "${e.to}" takes ${to.carries}`, `put a station between them that turns ${from.carries} into ${to.carries} (packs units into cases, cases onto pallets), or join other ports`);
      return;
    }
    if (e.carries && e.carries !== from.carries) error(`${at}.carries`, `the edge says ${e.carries} but its ports carry ${from.carries}`, `write carries: "${from.carries}" or leave it out`);
    if (e.transport.kind !== 'direct' && e.transport.type) {
      const spec = registry.componentSpec(e.transport.type, e.transport.params ?? {}, { beltHeight });
      const carried = [...new Set(Object.values(spec.ports ?? {}).map((p) => p.carries))];
      if (carried.length && !carried.includes(from.carries)) {
        error(`${at}.transport.type`, `transport "${e.transport.type}" carries ${carried.join(' / ')}, not ${from.carries}`, 'pick a transport made for it (see the catalog: transport and conveyor components, their ports say what they carry)');
      }
    }
  });
  return out;
}

/**
 * Everything: review() and then the compiled files (imported, so async). The CLI and /api/review use it.
 * @param {object} registry
 * @param {object} data   factory.json (parsed JSON)
 * @param {object} [o]    review()'s options, and { compiled: false to skip, root, importModule, source }
 *                        (reviewCompiled's; root is required for the compiled check)
 */
export async function reviewAll(registry, data, { compiled = true, root, importModule, source, ...options } = {}) {
  const result = review(registry, data, options);
  // Compiled files only for a line the data checks could plan (its timing is known); a line with
  // errors at run time (play) still compiles, and its files are still worth checking.
  if (!compiled || !result.timing) return result;
  const more = await reviewCompiled(registry, data, { root, importModule, source });
  return finish([...result.findings, ...more], result.timing);
}

function finish(findings, timing = null) {
  const counts = { error: 0, warning: 0, info: 0 };
  findings.forEach((f) => { counts[f.severity] += 1; });
  return { ok: counts.error === 0, findings, counts, ...(timing ? { timing } : {}) };
}

/** Findings as readable lines (CLI). */
export function formatFindings(result, { title = 'factory.json' } = {}) {
  const mark = { error: '✗', warning: '!', info: '·' };
  const lines = [`${title}: ${result.ok ? 'ok' : 'NOT OK'} · ${result.counts.error} error(s), ${result.counts.warning} warning(s), ${result.counts.info} note(s)`];
  for (const f of result.findings) {
    lines.push(`  ${mark[f.severity]} [${f.check}] ${f.path}: ${f.message}`);
    if (f.hint) lines.push(`      → ${f.hint}`);
  }
  return lines.join('\n');
}
