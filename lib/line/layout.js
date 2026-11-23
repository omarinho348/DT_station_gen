// Line layout: where each station stands and where the transfers between them run. Computed from
// the line graph and the stations' own extents, never from the LLM (Claude.md §6.5): agents may
// only give relative hints. Generic port of the reference PrinterLineLayout.js.
//
// Every station keeps its own frame (product flows +X), so placing a station is a pure offset.
// Neighbours joined by a conveyor edge are spaced so the gap between one station's run end and the
// next one's run start is the line's transfer length (a transfer conveyor fills it); neighbours
// joined by a direct edge stand so the two ports meet (the unit is handed over where it stands, e.g.
// a row former feeding a case packer's infeed). Across the flow, each station is shifted so the
// ports an edge joins are in line (a packer whose can infeed is off its centre). The row is
// centred on the origin along X (first and last station origins symmetric, as in the reference);
// the first station stands at z = 0.
//
// Supported now: a chain (each station's output feeds the next station's input). Branches,
// merges, parallel stations and buffers come in Phase 6; until then they fail with a clear
// message instead of being laid out wrongly.
import { CONVENTIONS } from '../core/conventions.js';

export class LayoutError extends Error {}

/** Splits 'station.port' into { station, port }. */
export function endpoint(text) {
  const m = /^([a-z][a-zA-Z0-9]*)\.([a-z][a-zA-Z0-9]*)$/.exec(text ?? '');
  if (!m) throw new LayoutError(`"${text}" is not "station.port"`);
  return { station: m[1], port: m[2] };
}

/**
 * The stations in flow order along the main path, from the graph's edges.
 * @param {string[]} ids         station ids
 * @param {object[]} edges       [{ from: 'a.output', to: 'b.input' }]
 */
export function flowOrder(ids, edges) {
  const known = new Set(ids);
  const next = new Map();
  const prev = new Map();
  for (const e of edges) {
    const from = endpoint(e.from);
    const to = endpoint(e.to);
    for (const end of [from, to]) if (!known.has(end.station)) throw new LayoutError(`edge ${e.from} → ${e.to}: unknown station "${end.station}" (stations: ${ids.join(', ')})`);
    if (from.station === to.station) throw new LayoutError(`edge ${e.from} → ${e.to}: a station cannot feed itself`);
    if (next.has(from.station) || prev.has(to.station)) {
      throw new LayoutError(`edge ${e.from} → ${e.to}: branches and merges are not laid out yet (Phase 6); the line must be a chain`);
    }
    next.set(from.station, to.station);
    prev.set(to.station, from.station);
  }
  const starts = ids.filter((id) => !prev.has(id));
  if (starts.length !== 1) {
    throw new LayoutError(starts.length ? `the line has ${starts.length} separate parts (${starts.join(', ')} start one each); connect them into one chain` : 'the line is a loop; it needs a first station');
  }
  const order = [starts[0]];
  while (next.has(order.at(-1))) order.push(next.get(order.at(-1)));
  return order;
}

/**
 * Places the stations of a chain.
 * @param {object} o
 * @param {object[]} o.stations  [{ id, extent: { start, end }, ports?: { name: { x, z } } }]: station-local
 *   X range of its run, and its port places (station frame; without them ports count as x 0, z 0)
 * @param {object[]} o.edges     [{ from: 'a.output', to: 'b.input', direct? }]
 * @param {number}  [o.transferLength]
 * @returns {{ order: string[], stations: { [id]: { x, z, position: number[], rotationY } },
 *            transfers: { from, to, start, end, length, centre, z }[], length }}
 *   transfers: one per conveyor edge, from the upstream run end to the downstream run start (line
 *   X), at the ports' common z; direct edges have none. `length` is first run start → last run end.
 */
export function layoutLine({ stations, edges, transferLength = CONVENTIONS.transferLength }) {
  const byId = new Map(stations.map((s) => [s.id, s]));
  if (byId.size !== stations.length) throw new LayoutError('station ids must be unique');
  for (const s of stations) {
    if (!(s.extent?.end > s.extent?.start)) throw new LayoutError(`station "${s.id}": its conveyor extent must run along +X (start < end)`);
  }
  if (!(transferLength > 0)) throw new LayoutError('transferLength must be positive');
  const order = stations.length === 1 ? [stations[0].id] : flowOrder(stations.map((s) => s.id), edges);
  if (order.length !== stations.length) {
    const off = stations.map((s) => s.id).filter((id) => !order.includes(id));
    throw new LayoutError(`stations not on the line: ${off.join(', ')}`);
  }

  // The edge joining each station to the next one, and the places of its two ports.
  const joins = order.slice(1).map((id, i) => {
    const edge = edges.find((e) => endpoint(e.from).station === order[i] && endpoint(e.to).station === id);
    const port = (station, end) => byId.get(station).ports?.[endpoint(end).port] ?? { x: 0, z: 0 };
    return { edge, out: port(order[i], edge.from), into: port(id, edge.to), direct: Boolean(edge.direct) };
  });

  // Station origins, the first at x 0 / z 0, then shifted along X so the row is centred.
  const xs = [0];
  const zs = [0];
  joins.forEach((j, k) => {
    const i = k + 1;
    const a = byId.get(order[i - 1]).extent;
    const b = byId.get(order[i]).extent;
    xs.push(j.direct ? xs[i - 1] + j.out.x - j.into.x : xs[i - 1] + a.end + transferLength - b.start);
    zs.push(zs[i - 1] + j.out.z - j.into.z);
  });
  const shift = -(xs[0] + xs.at(-1)) / 2;
  const placed = xs.map((x) => x + shift);

  const result = { order, stations: {}, transfers: [] };
  order.forEach((id, i) => {
    result.stations[id] = { x: placed[i], z: zs[i], position: [placed[i], 0, zs[i]], rotationY: 0 };
  });
  joins.forEach((j, k) => {
    if (j.direct) return;
    const start = placed[k] + byId.get(order[k]).extent.end;
    const end = placed[k + 1] + byId.get(order[k + 1]).extent.start;
    result.transfers.push({ from: order[k], to: order[k + 1], start, end, length: end - start, centre: (start + end) / 2, z: zs[k] + j.out.z });
  });
  result.length = placed.at(-1) + byId.get(order.at(-1)).extent.end - (placed[0] + byId.get(order[0]).extent.start);
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
