// The SimPy model of a line (Claude.md §6 "SimPy model from the same IR", Phase 11 step 1).
//
//   simData(registry, factory)  → the line as numbers: stations (per unit: cycle time and the port it
//                                 leaves by), edges (transfer time, capacity), run size, hold time
//   emitSimPy(data, { source }) → model.py: a fixed template with the data embedded (rule 1: templates
//                                 write code, never the model)
//
// Every number comes from compiler/timing.js, the same expansion the 3D twin plays: a station's cycle is
// its intake + process + output steps; a unit's route follows its facts (a quality verdict by serial,
// planned per unit with `facts`), so a reject leaves by the reject port exactly as in the twin.
// The model: stations hold one unit; transfers carry `capacity` units each for their travel time; a
// station that can't hand over waits and re-checks every holdSeconds (as the twin does). Deterministic:
// no randomness anywhere.
//
// Running it writes trace.jsonl (one event per line) and kpis.json; see simpy/FORMAT.md.
import { expandFactory } from './expand.js';
import { lineTiming } from './timing.js';
import { endpoint } from '../lib/line/layout.js';
import { createMaterials, disposeMaterials } from '../lib/core/materials.js';

const round = (v, d = 6) => Math.round(v * 10 ** d) / 10 ** d;

/** The facts of unit `serial` (e.g. { quality: 'reject' }), from the product's own build. */
function factsOf(registry, product, serial) {
  const def = registry.getProduct(product.type);
  if (!def || !Object.keys(def.facts ?? {}).length) return {};
  const materials = createMaterials();
  try {
    const built = registry.buildProduct(product.type, { ...(product.params ?? {}), serial }, { materials });
    const facts = Object.fromEntries(Object.entries(built.facts ?? {}).map(([k, f]) => [k, typeof f === 'function' ? f() : f]));
    built.root?.traverse?.((o) => { o.geometry?.dispose?.(); });
    return facts;
  } finally {
    disposeMaterials(materials);
  }
}

export function simData(registry, factory) {
  const expanded = expandFactory(registry, factory);
  const opts = { ctx: expanded.ctx, conventions: expanded.conventions };
  const base = lineTiming(registry, expanded.line, opts);
  const product = expanded.line.product;
  const serials = Array.from({ length: base.runSize }, (_, i) => i + 1);
  // Each unit planned with its own facts, in serial order: the product's (a quality verdict by serial) and
  // the bay facts the twin keeps per station (<port>Slot: units sent to a slotted port so far, in turn).
  // One timing per distinct set of facts (a run usually has a handful).
  const slotted = Object.fromEntries(expanded.line.stations.map((st) => [st.id, Object.entries(st.ports ?? {}).filter(([, p]) => p.direction === 'out' && p.slots).map(([name, p]) => ({ name, slots: p.slots }))]));
  const sent = Object.fromEntries(expanded.line.stations.map((st) => [st.id, {}]));
  const byKey = new Map();
  const perUnit = serials.map((serial) => {
    const facts = factsOf(registry, product, serial);
    const all = Object.fromEntries(expanded.line.stations.map((st) => [st.id, {
      ...facts,
      serial,
      ...Object.fromEntries(slotted[st.id].map((b) => [`${b.name}Slot`, (sent[st.id][b.name] ?? 0) % b.slots])),
    }]));
    const key = JSON.stringify(all);
    if (!byKey.has(key)) byKey.set(key, lineTiming(registry, expanded.line, { ...opts, facts: all }));
    const timing = byKey.get(key);
    for (const r of timing.stations) if (r.exit) sent[r.id][r.exit] = (sent[r.id][r.exit] ?? 0) + 1;
    return { serial, facts, timing };
  });

  const order = base.layout.order;
  const groupOf = (id) => expanded.line.stations.find((s) => s.id === id)?.copyOf ?? id;
  const stations = order.map((id) => {
    const row = base.stations.find((r) => r.id === id);
    return {
      id,
      code: row.code,
      title: row.title,
      group: groupOf(id),
      // Per unit (index = serial − 1): cycle time and exit port ('output' unless it leaves by another).
      cycle: perUnit.map((u) => round(u.timing.stations.find((r) => r.id === id).cycleTime)),
      exit: perUnit.map((u) => {
        const r = u.timing.stations.find((x) => x.id === id);
        return r.exit ?? (r.stacked ? `stack:${typeof r.stacked === 'string' ? r.stacked : r.stacked.name ?? 'stack'}` : 'output');
      }),
    };
  });
  const edges = expanded.line.edges.map((e, i) => {
    const t = base.transfers.find((x) => x.from === e.from && x.to === e.to);
    const from = endpoint(e.from);
    const to = endpoint(e.to);
    return { index: i, from: from.station, fromPort: from.port, to: to.station, toPort: to.port, duration: round(t?.duration ?? 0), capacity: e.transport?.capacity ?? 1, direct: e.transport?.kind === 'direct' };
  });
  const fed = new Set(edges.map((e) => e.to));
  return {
    line: expanded.line.id,
    title: expanded.line.title,
    runSize: base.runSize,
    holdSeconds: base.holdSeconds,
    lift: expanded.conventions.lift.duration,
    // Units enter at the stations nothing feeds (the line's start; parallel copies of it share the feed).
    entries: order.filter((id) => !fed.has(id)),
    stations,
    edges,
    units: perUnit.map((u) => ({ serial: u.serial, facts: u.facts })),
    planned: { takt: base.takt, bottleneck: base.bottleneck, leadTime: base.leadTime, runTime: base.runTime },
  };
}

const TEMPLATE = String.raw`"""SimPy model of the line "__TITLE__" (__LINE__).

Generated by compiler/simpy.js from __SOURCE__: do not edit, recompile.
Run:  python model.py [--out DIR]     (default: this file's folder)
Writes trace.jsonl (one event per line) and kpis.json; the format is described in simpy/FORMAT.md.
Deterministic: every time comes from the line's data, nothing is random.
"""
import argparse
import json
import os

import simpy

DATA = json.loads(r'''__DATA__''')


class Line:
    """Stations hold one unit at a time; a transfer holds up to its capacity, first in first out.
    Whoever can't hand over waits and re-checks every holdSeconds, as the twin's stations do."""

    def __init__(self, env, data, trace):
        self.env = env
        self.data = data
        self.trace = trace
        self.hold = data["holdSeconds"]
        self.stations = {s["id"]: s for s in data["stations"]}
        self.edges = data["edges"]
        self.at = {sid: None for sid in self.stations}          # the unit a station holds
        self.inbox = {sid: simpy.Store(env) for sid in self.stations}
        self.on = {e["index"]: [] for e in self.edges}            # units on a transfer, in order
        self.busy = {sid: 0.0 for sid in self.stations}
        self.split = {}
        self.inside = 0
        self.wip_area = 0.0
        self.wip_max = 0
        self.wip_t = 0.0
        self.released = {}
        self.left = {}
        self.rejected = set()

    def event(self, unit, station, kind, **extra):
        self.trace.append({"t": round(self.env.now, 6), "unit": unit, "station": station, "event": kind, **extra})

    def wip(self, delta):
        now = self.env.now
        self.wip_area += self.inside * (now - self.wip_t)
        self.wip_t = now
        self.inside += delta
        self.wip_max = max(self.wip_max, self.inside)

    def outs(self, station, port):
        return [e for e in self.edges if e["from"] == station and e["fromPort"] == port]

    def first_free(self, options, has_room, key):
        """Waits for the first option with room (round-robin from the last choice); returns its index."""
        while True:
            start = self.split.get(key, 0)
            for k in range(len(options)):
                i = (start + k) % len(options)
                if has_room(options[i]):
                    self.split[key] = (i + 1) % len(options)
                    return i
            yield self.env.timeout(self.hold)

    def give(self, sid, serial):
        self.at[sid] = serial
        yield self.inbox[sid].put(serial)

    def source(self):
        entries = self.data["entries"]
        for u in self.data["units"]:
            serial = u["serial"]
            i = yield from self.first_free(entries, lambda sid: self.at[sid] is None, "source")
            self.released[serial] = self.env.now
            self.wip(+1)
            self.event(serial, entries[i], "release")
            yield from self.give(entries[i], serial)

    def station(self, sid):
        s = self.stations[sid]
        while True:
            serial = yield self.inbox[sid].get()
            self.event(serial, sid, "start")
            cycle = s["cycle"][serial - 1]
            yield self.env.timeout(cycle)
            self.busy[sid] += cycle
            port = s["exit"][serial - 1]
            self.event(serial, sid, "finish", seconds=cycle)
            if port != "output" and not port.startswith("stack:"):
                # Left by another port (a reject lane): a reject. A stack (cases on a pallet) is not.
                self.rejected.add(serial)
                self.event(serial, sid, "reject", port=port)
            outs = self.outs(sid, port)
            if not outs:
                # The end of the line (or a lane leading nowhere): the unit leaves the line.
                self.left[serial] = self.env.now
                self.wip(-1)
                self.at[sid] = None
                self.event(serial, sid, "exit", port=port, rejected=serial in self.rejected)
                continue
            i = yield from self.first_free(outs, lambda e: len(self.on[e["index"]]) < e["capacity"], (sid, port))
            e = outs[i]
            self.on[e["index"]].append(serial)
            self.at[sid] = None
            self.event(serial, sid, "leave", port=port, to=e["to"])
            self.env.process(self.carry(e, serial))

    def carry(self, e, serial):
        if e["duration"] > 0:
            yield self.env.timeout(e["duration"])
        # First in, first out: wait to be the front unit, and for the station downstream to be free.
        while self.on[e["index"]][0] != serial or self.at[e["to"]] is not None:
            yield self.env.timeout(self.hold)
        self.on[e["index"]].pop(0)
        self.event(serial, e["to"], "arrive", port=e["toPort"])
        yield from self.give(e["to"], serial)


def kpis(line, data, makespan):
    units = data["runSize"]
    lead = [line.left[s] - line.released[s] for s in line.left if s in line.released]
    out_times = sorted(line.left.values())
    gaps = [b - a for a, b in zip(out_times, out_times[1:])]
    good = len([s for s in line.left if s not in line.rejected])
    line.wip(0)
    return {
        "line": data["line"],
        "title": data["title"],
        "runSize": units,
        "unitsOut": len(line.left),
        "goodUnits": good,
        "rejects": {"count": len(line.rejected), "rate": round(len(line.rejected) / units, 6) if units else 0},
        "makespan": round(makespan, 6),
        "throughputPerHour": round(good / makespan * 3600, 6) if makespan > 0 else 0,
        # Once the line is full: one unit per achieved takt, times the share that is good. A short run's
        # throughputPerHour includes filling the empty line; this is the rate the line holds.
        "steadyPerHour": round(3600 / (sum(gaps) / len(gaps)) * good / len(line.left), 6) if gaps and line.left else None,
        "taktAchieved": round(sum(gaps) / len(gaps), 6) if gaps else None,
        "taktPlanned": data["planned"]["takt"],
        "bottleneckPlanned": data["planned"]["bottleneck"],
        "leadTime": {"mean": round(sum(lead) / len(lead), 6), "min": round(min(lead), 6), "max": round(max(lead), 6)} if lead else None,
        "wip": {"mean": round(line.wip_area / makespan, 6) if makespan > 0 else 0, "max": line.wip_max},
        "utilisation": {sid: round(b / makespan, 6) if makespan > 0 else 0 for sid, b in line.busy.items()},
    }


def run(data, out):
    env = simpy.Environment()
    trace = []
    line = Line(env, data, trace)
    env.process(line.source())
    for s in data["stations"]:
        env.process(line.station(s["id"]))
    done = env.event()

    def watch():
        while len(line.left) < data["runSize"]:
            yield env.timeout(data["holdSeconds"])
        done.succeed()

    env.process(watch())
    limit = max(60.0, data["planned"]["runTime"] * 20)
    env.run(until=simpy.events.AnyOf(env, [done, env.timeout(limit)]))
    makespan = max(line.left.values()) if line.left else env.now
    result = kpis(line, data, makespan)
    result["finished"] = len(line.left) == data["runSize"]
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "trace.jsonl"), "w", encoding="utf-8") as f:
        for ev in trace:
            f.write(json.dumps(ev) + "\n")
    with open(os.path.join(out, "kpis.json"), "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
        f.write("\n")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", default=os.path.dirname(os.path.abspath(__file__)))
    args = parser.parse_args()
    r = run(DATA, args.out)
    print(json.dumps({"finished": r["finished"], "makespan": r["makespan"], "throughputPerHour": r["throughputPerHour"], "unitsOut": r["unitsOut"]}))
`;

/** model.py for the data (simData's result). */
export function emitSimPy(data, { source = 'factory.json' } = {}) {
  const json = JSON.stringify(data);
  if (json.includes("'''")) throw new Error('the line data cannot be embedded (contains \'\'\')');
  // Function replacers: nothing in the data is read as a replacement pattern.
  return TEMPLATE.replace('__TITLE__', () => data.title.replace(/"/g, "'")).replace('__LINE__', () => data.line).replace('__SOURCE__', () => source).replace('__DATA__', () => json);
}
