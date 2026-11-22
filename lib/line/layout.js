// Line layout: where each station stands and where the transfers between them run. Computed from
// the line graph and the stations' own extents, never from the LLM (Claude.md §6.5): agents may
// only give relative hints. Generic port of the reference PrinterLineLayout.js.
//
// Every station keeps its own frame (product flows +X, conveyor at z = 0), so placing a station
// on the main path is a pure X offset. Neighbours are spaced so the gap between one station's
// conveyor end and the next one's conveyor start is the line's transfer length; the row is
// centred on the origin (first and last station origins symmetric, as in the reference).
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
 * @param {object[]} o.stations  [{ id, extent: { start, end } }]: station-local X range of its conveyor
 * @param {object[]} o.edges     [{ from: 'a.output', to: 'b.input' }]
 * @param {number}  [o.transferLength]
 * @returns {{ order: string[], stations: { [id]: { x, position: number[], rotationY } },
 *            transfers: { from, to, start, end, length, centre }[], length }}
 *   transfers[i] runs from station i's conveyor end to station i + 1's conveyor start (line X);
 *   `length` is the line's overall conveyor length (first start → last end).
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

  // Station origins along X, the first at 0, then shifted so the row is centred.
  const xs = [0];
  for (let i = 1; i < order.length; i += 1) {
    const a = byId.get(order[i - 1]).extent;
    const b = byId.get(order[i]).extent;
    xs.push(xs[i - 1] + a.end + transferLength - b.start);
  }
  const shift = -(xs[0] + xs.at(-1)) / 2;
  const placed = xs.map((x) => x + shift);

  const result = { order, stations: {}, transfers: [] };
  order.forEach((id, i) => {
    result.stations[id] = { x: placed[i], position: [placed[i], 0, 0], rotationY: 0 };
  });
  for (let i = 0; i + 1 < order.length; i += 1) {
    const start = placed[i] + byId.get(order[i]).extent.end;
    const end = placed[i + 1] + byId.get(order[i + 1]).extent.start;
    result.transfers.push({ from: order[i], to: order[i + 1], start, end, length: end - start, centre: (start + end) / 2 });
  }
  result.length = placed.at(-1) + byId.get(order.at(-1)).extent.end - (placed[0] + byId.get(order[0]).extent.start);
  return result;
}
