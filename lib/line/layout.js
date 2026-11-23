// Line layout: where each station stands and where the transfers between them run. Computed from
// the line graph and the stations' own extents, never from the LLM (Claude.md §6.5): agents may
// only give relative hints. Generic port of the reference PrinterLineLayout.js.
//
// Every station keeps its own frame (product flows +X), so placing a station is a pure offset.
//
// THE MAIN PATH (a chain: the printer and lubricant lines are only this) starts at the first
// station nothing feeds and follows each station's `output` port. Neighbours on it joined by a
// conveyor edge are spaced so the gap between one station's run end and the next one's run start is
// the line's transfer length (a transfer conveyor fills it); neighbours joined by a direct edge stand
// so the two ports meet (a row former feeding a case packer's infeed). Across the flow, each station
// is shifted so the ports an edge joins are in line (a packer whose can infeed is off its centre).
// The main path is centred on the origin along X (first and last origins symmetric, as in the
// reference); its first station stands at z = 0.
//
// GRAPH SHAPES (Phase 6 step 6):
//   - parallel copies: stations with the same `group` (copies of a slow station) count as one place
//     on the main path and stand side by side across Z, centred where one station would stand
//   - branches and feeders: a station off the main path (rework behind a reject lane, a feeder
//     line merging in) stands in a side lane next to the station it is joined to, one transfer length
//     clear of it across Z; on the equipment side (−Z) unless the joined port lies on the +Z side of
//     its station. Joined at a side port (a reject lane) the two ports are at the same X; joined at
//     the station's input (a feeder) its port is one transfer length upstream, at its output one
//     downstream. Lanes further out are used if one is taken.
//   - fan-out (one output feeding several edges) and fan-in (several edges into one input) are just
//     edges; Line.js decides which unit goes where.
//   - transfers whose ends are not in line (to a copy, a side lane) run straight from port to port,
//     at an angle; the main-path transfers between stations in line are as before.
// Loops (a rework lane feeding back upstream) are refused: they can block the line.
import { CONVENTIONS } from '../core/conventions.js';

export class LayoutError extends Error {}

/** Splits 'station.port' into { station, port }. */
export function endpoint(text) {
  const m = /^([a-z][a-zA-Z0-9]*)\.([a-z][a-zA-Z0-9]*)$/.exec(text ?? '');
  if (!m) throw new LayoutError(`"${text}" is not "station.port"`);
  return { station: m[1], port: m[2] };
}

/** Checks the edges against the stations: known stations, no self-feed, no loop, one connected line. */
function checkGraph(ids, edges, groupOf = (id) => id) {
  const known = new Set(ids);
  const next = new Map(ids.map((id) => [id, new Set()]));
  const linked = new Map(ids.map((id) => [id, new Set()]));
  for (const e of edges) {
    const from = endpoint(e.from);
    const to = endpoint(e.to);
    for (const end of [from, to]) if (!known.has(end.station)) throw new LayoutError(`edge ${e.from} → ${e.to}: unknown station "${end.station}" (stations: ${ids.join(', ')})`);
    if (from.station === to.station) throw new LayoutError(`edge ${e.from} → ${e.to}: a station cannot feed itself`);
    next.get(from.station).add(to.station);
    linked.get(from.station).add(to.station);
    linked.get(to.station).add(from.station);
  }
  // A loop: a station reachable from itself.
  const state = new Map();
  const visit = (id) => {
    if (state.get(id) === 1) throw new LayoutError('the line is a loop; it needs a first station (a rework lane cannot feed back upstream)');
    if (state.get(id) === 2) return;
    state.set(id, 1);
    for (const n of next.get(id)) visit(n);
    state.set(id, 2);
  };
  ids.forEach(visit);
  // One line: every station connected to the first (copies of a group count as connected).
  const seen = new Set();
  const stack = [ids[0]];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    linked.get(id).forEach((n) => stack.push(n));
    ids.filter((o) => groupOf(o) === groupOf(id)).forEach((o) => stack.push(o));
  }
  if (seen.size < ids.length) {
    const parts = [];
    const done = new Set();
    for (const id of ids) {
      if (done.has(id)) continue;
      const part = new Set([id]);
      const s = [id];
      while (s.length) { const x = s.pop(); for (const n of linked.get(x)) if (!part.has(n)) { part.add(n); s.push(n); } }
      part.forEach((x) => done.add(x));
      parts.push(ids.find((x) => part.has(x)));
    }
    throw new LayoutError(`the line has ${parts.length} separate parts (${parts.join(', ')} start one each); connect them into one line`);
  }
}

/**
 * The main path, in flow order: from the first station nothing feeds (in list order), following
 * each station's `output` port (its first edge). Copies of a group stand for one place: the path
 * goes on from whichever copy's output edge comes first. Checks the graph first.
 * @param {string[]} ids    station ids
 * @param {object[]} edges  [{ from: 'a.output', to: 'b.input' }]
 * @param {Function} [groupOf] id → group (parallel copies share one)
 * @returns {string[]} station ids on the main path (one id per place: a group's first copy)
 */
export function flowOrder(ids, edges, groupOf = (id) => id) {
  checkGraph(ids, edges, groupOf);
  const fed = new Set(edges.map((e) => endpoint(e.to).station));
  const start = ids.find((id) => !fed.has(id));
  if (!start) throw new LayoutError('the line is a loop; it needs a first station');
  const members = (id) => ids.filter((o) => groupOf(o) === groupOf(id));
  const path = [members(start)[0]];
  for (;;) {
    const here = members(path.at(-1));
    const edge = edges.find((e) => { const f = endpoint(e.from); return here.includes(f.station) && f.port === 'output'; });
    if (!edge) break;
    const nextId = members(endpoint(edge.to).station)[0];
    if (path.includes(nextId)) break;
    path.push(nextId);
  }
  return path;
}

/**
 * Places the stations.
 * @param {object} o
 * @param {object[]} o.stations  [{ id, extent: { start, end }, ports?: { name: { x, z } }, depth?: [zMin, zMax], group? }]:
 *   station-local X range of its run, its port places (station frame; without them ports count as
 *   x 0, z 0), its Z range (default ±1 m) and its group (parallel copies share one; default its id)
 * @param {object[]} o.edges     [{ from: 'a.output', to: 'b.input', direct? }]
 * @param {number}  [o.transferLength]
 * @returns {{ order: string[], main: string[], stations: { [id]: { x, z, position: number[], rotationY } },
 *            transfers: object[], length }}
 *   order: every station (main path first, copies together, then the side lanes); main: the main
 *   path, one id per place. transfers: one per conveyor edge (`edge` = its index in `edges`):
 *   { edge, from, to, start, end, length, centre, z, angle, inLine }. In line (main path, ports
 *   lined up): from the upstream run end to the downstream run start, as before (angle 0). Otherwise
 *   straight from the upstream end to the downstream end (`startZ`, `endZ`, `centreZ`, `angle` about
 *   Y, measured from +X towards +Z). Direct edges have none. `length` (of the line) is the main
 *   path's first run start → last run end.
 */
export function layoutLine({ stations, edges, transferLength = CONVENTIONS.transferLength }) {
  const byId = new Map(stations.map((s) => [s.id, s]));
  if (byId.size !== stations.length) throw new LayoutError('station ids must be unique');
  for (const s of stations) {
    if (!(s.extent?.end > s.extent?.start)) throw new LayoutError(`station "${s.id}": its conveyor extent must run along +X (start < end)`);
  }
  if (!(transferLength > 0)) throw new LayoutError('transferLength must be positive');
  const ids = stations.map((s) => s.id);
  const groupOf = (id) => byId.get(id).group ?? id;
  const members = (id) => ids.filter((o) => groupOf(o) === groupOf(id));
  const main = stations.length === 1 ? [ids[0]] : flowOrder(ids, edges, groupOf);
  const portAt = (id, port) => byId.get(id).ports?.[port] ?? { x: 0, z: 0 };
  const depthOf = (id) => byId.get(id).depth ?? [-1, 1];

  // ---- Main path: as a chain, a group standing where one station would. -------------------------
  const joins = main.slice(1).map((id, i) => {
    const prev = members(main[i]);
    const here = members(id);
    const edge = edges.find((e) => prev.includes(endpoint(e.from).station) && endpoint(e.from).port === 'output' && here.includes(endpoint(e.to).station));
    const from = endpoint(edge.from);
    const to = endpoint(edge.to);
    return { edge, out: portAt(from.station, from.port), into: portAt(to.station, to.port), direct: Boolean(edge.direct) };
  });
  const xs = [0];
  const zs = [0];
  joins.forEach((j, k) => {
    const i = k + 1;
    const a = byId.get(main[i - 1]).extent;
    const b = byId.get(main[i]).extent;
    xs.push(j.direct ? xs[i - 1] + j.out.x - j.into.x : xs[i - 1] + a.end + transferLength - b.start);
    zs.push(zs[i - 1] + j.out.z - j.into.z);
  });
  const shift = -(xs[0] + xs.at(-1)) / 2;
  const place = {};
  main.forEach((id, i) => {
    const copies = members(id);
    // Copies side by side across Z, centred on where one station would stand.
    const [lo, hi] = depthOf(id);
    const pitch = hi - lo + transferLength;
    copies.forEach((c, k) => { place[c] = { x: xs[i] + shift, z: zs[i] + (k - (copies.length - 1) / 2) * pitch }; });
  });

  // ---- Side lanes: stations off the main path, next to the station they are joined to. ----------
  const box = (id) => {
    const { x, z } = place[id];
    const s = byId.get(id);
    const [lo, hi] = depthOf(id);
    return { x0: x + s.extent.start, x1: x + s.extent.end, z0: z + lo, z1: z + hi };
  };
  const clashes = (a, b) => a.x0 < b.x1 - 1e-9 && b.x0 < a.x1 - 1e-9 && a.z0 < b.z1 - 1e-9 && b.z0 < a.z1 - 1e-9;
  for (let guard = 0; Object.keys(place).length < ids.length && guard < ids.length * 2; guard += 1) {
    for (const e of edges) {
      const from = endpoint(e.from);
      const to = endpoint(e.to);
      const branch = place[from.station] && !place[to.station]; // fed by a placed station
      const feeder = !place[from.station] && place[to.station]; // feeding a placed station
      if (!branch && !feeder) continue;
      const [anchor, anchorPort, mover, moverPort] = branch ? [from.station, from.port, to.station, to.port] : [to.station, to.port, from.station, from.port];
      const p = portAt(anchor, anchorPort);
      const q = portAt(mover, moverPort);
      const side = p.z > 1e-9 ? 1 : -1; // the port's side of its station; the equipment side (−Z) if central
      // Joined at a side port (a reject lane): the ports at the same X, the transfer straight across.
      // Joined at the station's input (a feeder) or output: one transfer length up- / downstream.
      const along = anchorPort === 'input' ? -transferLength : anchorPort === 'output' ? transferLength : 0;
      const x = place[anchor].x + p.x + along - q.x;
      const [alo, ahi] = depthOf(anchor);
      const [mlo, mhi] = depthOf(mover);
      let z = side < 0 ? place[anchor].z + alo - transferLength - mhi : place[anchor].z + ahi + transferLength - mlo;
      place[mover] = { x, z };
      // Further out while it would stand on another station.
      for (let tries = 0; tries < ids.length && ids.some((o) => o !== mover && place[o] && clashes(box(mover), box(o))); tries += 1) {
        z += side * (mhi - mlo + transferLength);
        place[mover] = { x, z };
      }
    }
  }

  const order = [...main.flatMap((id) => members(id)), ...ids.filter((id) => !main.flatMap(members).includes(id))];
  const result = { order, main, stations: {}, transfers: [] };
  for (const id of order) result.stations[id] = { x: place[id].x, z: place[id].z, position: [place[id].x, 0, place[id].z], rotationY: 0 };

  // ---- Transfers. ----------------------------------------------------------------------------------
  const isMain = (id) => main.includes(id) && members(id).length === 1;
  edges.forEach((e, index) => {
    if (e.direct) return;
    const from = endpoint(e.from);
    const to = endpoint(e.to);
    const up = byId.get(from.station);
    const down = byId.get(to.station);
    const p = portAt(from.station, from.port);
    const q = portAt(to.station, to.port);
    // A transfer leaves a station's output from its run end, and reaches an input at its run start;
    // other ports (a side reject lane) are left where they are.
    const sx = place[from.station].x + (from.port === 'output' ? Math.max(p.x, up.extent.end) : p.x);
    const ex = place[to.station].x + (to.port === 'input' ? Math.min(q.x, down.extent.start) : q.x);
    const sz = place[from.station].z + p.z;
    const ez = place[to.station].z + q.z;
    const inLine = isMain(from.station) && isMain(to.station) && from.port === 'output' && to.port === 'input' && Math.abs(sz - ez) < 1e-9;
    if (inLine) {
      const start = place[from.station].x + up.extent.end;
      const end = place[to.station].x + down.extent.start;
      result.transfers.push({ edge: index, from: from.station, to: to.station, start, end, length: end - start, centre: (start + end) / 2, z: sz, angle: 0, inLine: true });
      return;
    }
    const length = Math.hypot(ex - sx, ez - sz);
    result.transfers.push({
      edge: index, from: from.station, to: to.station, start: sx, end: ex, length, centre: (sx + ex) / 2,
      z: (sz + ez) / 2, startZ: sz, endZ: ez, angle: Math.atan2(ez - sz, ex - sx), inLine: false,
    });
  });
  const first = main[0];
  const last = main.at(-1);
  result.length = place[last].x + byId.get(last).extent.end - (place[first].x + byId.get(first).extent.start);
  return result;
}

/**
 * The X run of a station (station-local) from its conveyor's [start, end] and those of its input /
 * output port machines (null = turned, not counted): units may enter before the conveyor starts or
 * leave on an outfeed belt after it ends.
 */
export function runExtent(conveyor, input, output) {
  return { start: Math.min(conveyor[0], input?.[0] ?? Infinity), end: Math.max(conveyor[1], output?.[1] ?? -Infinity) };
}
