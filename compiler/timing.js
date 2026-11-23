// Timing table of a line, from its data alone (no geometry): what the takt check, the SimPy model
// (Phase 11) and the reference comparison (Phase 4 acceptance test) all read. Every duration adds
// up from the steps the twin plays (planStation is the same expansion the runtime uses).
//
//   lineTiming(registry, lineData)  → { stations[], transfers[], takt, bottleneck, leadTime, runTime }
//   compareTiming(ours, reference)  → per station: step-by-step differences against a recording
//   formatTimingTable(timing)       → a markdown table for reports
//
// Line model (a chain of single-unit stations, one unit per transfer, as in the reference):
//   takt      = the slowest of: each station's cycle (intake + process + output), each transfer
//   leadTime  = one unit through the empty line: lift up + Σ station cycles + Σ transfers + lift down
//   runTime   ≈ leadTime + (runSize − 1) × takt
// Waiting stations re-check every `holdSeconds`, so a played run may take up to one hold longer
// per hand-over than this estimate.
import { Vector3 } from 'three';
import { planStation } from '../lib/station/StationCycle.js';
import { parseStation, resolvePorts } from '../lib/station/stationSpec.js';
import { layoutLine, endpoint, runExtent } from '../lib/line/layout.js';
import { parseLine } from '../lib/line/lineSpec.js';
import { trapezoidDuration } from '../lib/core/motion.js';
import { CONVENTIONS } from '../lib/core/conventions.js';

/** Labels of the stand-alone feed / retire steps (not part of a station's cycle in a line). */
export const STANDALONE_STEPS = Object.freeze(['Carrier rising from return line', 'Carrier lowering to return line']);

const round = (v, digits = 6) => Math.round(v * 10 ** digits) / 10 ** digits;

/** A station's plan as table rows: start time, phase, state, label, duration. */
export function stationTable(plan) {
  let t = 0;
  const rows = [];
  for (const phase of ['intake', 'process', 'output']) {
    for (const s of plan[phase].steps) {
      rows.push({ t: round(t), phase, state: s.state, label: s.label, duration: round(s.duration) });
      t += s.duration;
    }
  }
  return rows;
}

/** Station-local position of a port: its machine's placement applied to the component port. */
function portInStation(equipmentEntry, portPosition) {
  return new Vector3(...portPosition)
    .applyAxisAngle(new Vector3(0, 1, 0), equipmentEntry.rotationY ?? 0)
    .add(new Vector3(...(equipmentEntry.position ?? [0, 0, 0])));
}

/** A station's Z range [min, max] in its own frame, from its machines' footprints (side lanes, copies). */
function depthOf(s) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const [id, e] of Object.entries(s.entries)) {
    const fp = s.specs[id].footprint;
    for (const x of fp.x) {
      for (const z of fp.z) {
        const v = portInStation(e, [x, 0, z]);
        lo = Math.min(lo, v.z);
        hi = Math.max(hi, v.z);
      }
    }
  }
  return Number.isFinite(lo) ? [lo, hi] : [-1, 1];
}

/**
 * Timing of a whole line from its data. `registry` must have the components, ops and product.
 * `facts`: { stationId: { fact: value } } plans those decisions one way (e.g. a reject path);
 * decisions on facts not given take their longest branch.
 * Returns { line, stations: [{ id, code, title, intake, process, output, cycleTime, rows }],
 * transfers: [{ from, to, distance, duration }], takt, bottleneck, leadTime, runSize, runTime, layout }
 * (layout: lib/line/layout.js's result for this line).
 */
export function lineTiming(registry, lineData, { ctx = {}, conventions = CONVENTIONS, facts = {} } = {}) {
  const line = parseLine(lineData);
  const stations = line.stations.map((data) => {
    const { equipment: list, build, ...stationData } = data;
    if (!list) throw new Error(`station "${data.id}": no equipment list to time (a compiled station carries its timing in its line file)`);
    const station = parseStation(stationData);
    const entries = Object.fromEntries(list.map((e) => [e.id, e]));
    const specs = Object.fromEntries(list.map((e) => [e.id, registry.componentSpec(e.type, e.params ?? {}, e.beltHeight !== undefined ? { ...ctx, beltHeight: e.beltHeight } : ctx)]));
    const placed = Object.fromEntries(list.map((e) => [e.id, { ...specs[e.id], placement: { position: e.position ?? [0, 0, 0], rotationY: e.rotationY ?? 0 } }]));
    const plan = planStation(registry, stationData, { equipment: placed, product: station.unit?.type ?? line.product.type, ctx, conventions, facts: facts[station.id] ?? {} });
    const ports = resolvePorts(station, specs);
    const span = (m) => (Math.abs(entries[m].rotationY ?? 0) < 1e-9
      ? specs[m].footprint.x.map((v) => v + (entries[m].position?.[0] ?? 0)) : null);
    return {
      id: station.id, code: station.code ?? null, title: station.title, station, entries, specs, plan,
      extent: runExtent(span(station.conveyor), span(ports.input.machine), span(ports.output.machine)),
      ports,
    };
  });
  const byId = new Map(stations.map((s) => [s.id, s]));
  const placeOf = (s, name) => {
    const p = s.ports[name];
    const v = portInStation(s.entries[p.machine], p.position);
    return { x: v.x, z: v.z };
  };
  const layout = layoutLine({
    stations: stations.map((s) => ({
      id: s.id,
      extent: s.extent,
      ports: Object.fromEntries(Object.keys(s.ports).filter((n) => n !== 'work').map((n) => [n, placeOf(s, n)])),
      depth: depthOf(s),
      group: line.stations.find((d) => d.id === s.id).copyOf ?? s.id,
    })),
    edges: line.edges.map((e) => ({ ...e, direct: e.transport.kind === 'direct' })),
    transferLength: line.transferLength ?? conventions.transferLength,
  });

  const { speed, ramp } = conventions.conveyor;
  const transfers = layout.transfers.map((t) => {
    const edge = line.edges[t.edge];
    const at = (end) => {
      const { station, port } = endpoint(end);
      const s = byId.get(station);
      const p = s.ports[port];
      if (!p) throw new Error(`edge ${edge.from} → ${edge.to}: station "${station}" has no port "${port}"`);
      return portInStation(s.entries[p.machine], p.position).add(new Vector3(...layout.stations[station].position));
    };
    const distance = at(edge.from).distanceTo(at(edge.to));
    return { from: edge.from, to: edge.to, distance: round(distance), duration: round(trapezoidDuration(distance, speed, ramp)) };
  });

  const rows = stations.map((s) => ({
    id: s.id,
    code: s.code,
    title: s.title,
    intake: round(s.plan.intake.duration),
    process: round(s.plan.process.duration),
    output: round(s.plan.output.duration),
    cycleTime: round(s.plan.cycleTime),
    steps: s.plan.steps.length,
    rows: stationTable(s.plan),
  }));
  const ordered = layout.order.map((id) => rows.find((r) => r.id === id));
  // The takt comes from the main path. Parallel copies share their station's work (its cycle time
  // over the copies), and so do the transfers into / out of them; stations off the main path (rework,
  // feeders) see only part of the flow and don't set it.
  const groupOf = (id) => line.stations.find((d) => d.id === id).copyOf ?? id;
  const copies = (id) => line.stations.filter((d) => groupOf(d.id) === groupOf(id)).length;
  const onMain = new Set(layout.main.map(groupOf));
  const mainRows = ordered.filter((r) => onMain.has(groupOf(r.id)));
  const effective = (r) => r.cycleTime / copies(r.id);
  const slowestStation = mainRows.reduce((a, b) => (effective(b) > effective(a) ? b : a));
  const mainTransfers = transfers.filter((t) => [t.from, t.to].every((end) => onMain.has(groupOf(endpoint(end).station))));
  const share = (t) => Math.max(copies(endpoint(t.from).station), copies(endpoint(t.to).station));
  const slowestTransfer = mainTransfers.reduce((a, b) => (b.duration / share(b) > (a ? a.duration / share(a) : -1) ? b : a), null);
  const bottleneck = slowestTransfer && slowestTransfer.duration / share(slowestTransfer) > effective(slowestStation)
    ? { kind: 'transfer', id: `${slowestTransfer.from} → ${slowestTransfer.to}`, time: round(slowestTransfer.duration / share(slowestTransfer)) }
    : { kind: 'station', id: slowestStation.id, time: round(effective(slowestStation)), ...(copies(slowestStation.id) > 1 ? { copies: copies(slowestStation.id) } : {}) };
  const lift = conventions.lift.duration;
  // One unit through the main path: one copy of each place, one transfer per join.
  const joinTime = layout.main.slice(1).reduce((sum, id, i) => {
    const pair = mainTransfers.filter((t) => groupOf(endpoint(t.from).station) === groupOf(layout.main[i]) && groupOf(endpoint(t.to).station) === groupOf(id));
    return sum + (pair.length ? Math.min(...pair.map((t) => t.duration)) : 0);
  }, 0);
  const leadTime = round(lift + layout.main.reduce((sum, id) => sum + rows.find((r) => r.id === id).cycleTime, 0) + joinTime + lift);
  return {
    line: line.id,
    stations: ordered,
    transfers,
    takt: bottleneck.time,
    bottleneck,
    leadTime,
    runSize: line.runSize,
    runTime: round(leadTime + (line.runSize - 1) * bottleneck.time),
    holdSeconds: conventions.holdSeconds,
    layout,
  };
}

/**
 * Compares one station's planned steps with a recorded reference unit (stand-alone feed steps are
 * left out of the reference). Steps are aligned by label (longest common subsequence), so one
 * missing step is reported once instead of shifting everything after it. Returns
 * { ok, ours, reference, delta, matched, mismatches: [{ ours, reference, reason }] } where reason is
 * 'missing step' (only in the reference), 'extra step' (only ours), or 'state' / 'duration'.
 */
export function compareStation(rows, referenceSteps, { tolerance = 1e-3 } = {}) {
  const ref = referenceSteps.filter((s) => !STANDALONE_STEPS.includes(s.label));
  const n = rows.length;
  const m = ref.length;
  // lcs[i][j]: length of the longest common label subsequence of rows[i..] and ref[j..]
  const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i][j] = rows[i].label === ref[j].label ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const mismatches = [];
  let matched = 0;
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && rows[i].label === ref[j].label) {
      matched += 1;
      const reasons = [];
      if (rows[i].state !== ref[j].state) reasons.push('state');
      if (Math.abs(rows[i].duration - ref[j].duration) > tolerance) reasons.push('duration');
      if (reasons.length) mismatches.push({ ours: rows[i], reference: ref[j], reason: reasons.join(', ') });
      i += 1;
      j += 1;
    } else if (j < m && (i >= n || lcs[i][j + 1] >= lcs[i + 1][j])) {
      mismatches.push({ ours: null, reference: ref[j], reason: 'missing step' });
      j += 1;
    } else {
      mismatches.push({ ours: rows[i], reference: null, reason: 'extra step' });
      i += 1;
    }
  }
  const ours = rows.reduce((sum, r) => sum + r.duration, 0);
  const reference = ref.reduce((sum, r) => sum + r.duration, 0);
  return { ok: mismatches.length === 0, ours: round(ours), reference: round(reference), delta: round(ours - reference), matched, mismatches };
}

/**
 * Compares a line timing with a reference recording (benchmarks/expected/*-reference-timing.json).
 * `map`: { ourStationId: referenceStationId } (default: same ids). Stations missing on either
 * side are listed, not failed.
 */
export function compareTiming(ours, reference, { map = null, tolerance = 1e-3 } = {}) {
  const stations = ours.stations.map((s) => {
    const refId = map ? map[s.id] : s.id;
    const ref = refId ? reference.stations[refId] : null;
    if (!ref) return { id: s.id, reference: null, ok: null };
    return { id: s.id, referenceId: refId, ...compareStation(s.rows, ref.unitSteps, { tolerance }) };
  });
  const refTransfer = reference.line?.transferDuration ?? null;
  const transfers = ours.transfers.map((t) => ({
    from: t.from, to: t.to, ours: t.duration, reference: refTransfer, ok: refTransfer === null ? null : Math.abs(t.duration - refTransfer) <= tolerance,
  }));
  return { stations, transfers, ok: stations.every((s) => s.ok !== false) && transfers.every((t) => t.ok !== false) };
}

/** Reference takt from a recording: the slowest station cycle, stand-alone feed steps left out. */
export function referenceTakt(reference) {
  const cycles = Object.entries(reference.stations).map(([id, s]) => ({
    id, cycle: round(s.unitSteps.filter((x) => !STANDALONE_STEPS.includes(x.label)).reduce((sum, x) => sum + x.duration, 0)),
  }));
  return cycles.reduce((a, b) => (b.cycle > a.cycle ? b : a));
}

/** Markdown table of a line timing (and, given a comparison, the reference column). */
export function formatTimingTable(timing, comparison = null) {
  const f = (v) => (v === null || v === undefined ? '—' : v.toFixed(2));
  const head = comparison
    ? '| Station | Intake s | Process s | Output s | Cycle s | Reference s | Δ s | Steps match |\n|---|---:|---:|---:|---:|---:|---:|:---:|'
    : '| Station | Intake s | Process s | Output s | Cycle s | Steps |\n|---|---:|---:|---:|---:|---:|';
  const lines = timing.stations.map((s) => {
    const name = [s.code, s.title].filter(Boolean).join(' ');
    if (!comparison) return `| ${name} | ${f(s.intake)} | ${f(s.process)} | ${f(s.output)} | ${f(s.cycleTime)} | ${s.steps} |`;
    const c = comparison.stations.find((x) => x.id === s.id);
    const match = c?.ok === null || c?.ok === undefined ? '—' : c.ok ? 'yes' : `no (${c.mismatches.length})`;
    return `| ${name} | ${f(s.intake)} | ${f(s.process)} | ${f(s.output)} | ${f(s.cycleTime)} | ${f(c?.reference)} | ${f(c?.delta)} | ${match} |`;
  });
  const transfers = timing.transfers.map((t, i) => {
    if (!comparison) return `| Transfer ${t.from} → ${t.to} | | | | ${f(t.duration)} | |`;
    const c = comparison.transfers[i];
    const match = c.ok === null ? '—' : c.ok ? 'yes' : 'no';
    return `| Transfer ${t.from} → ${t.to} | | | | ${f(t.duration)} | ${f(c.reference)} | ${f(c.reference === null ? null : t.duration - c.reference)} | ${match} |`;
  });
  const summary = [
    '',
    `- Takt: **${f(timing.takt)} s** (bottleneck: ${timing.bottleneck.kind} ${timing.bottleneck.id})`,
    `- Lead time for one unit: ${f(timing.leadTime)} s`,
    `- Run of ${timing.runSize}: about ${f(timing.runTime)} s (each hand-over may add up to ${f(timing.holdSeconds)} s of waiting re-check)`,
  ];
  return [head, ...lines, ...transfers, ...summary].join('\n');
}
