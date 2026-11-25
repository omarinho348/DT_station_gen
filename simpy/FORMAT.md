# SimPy output format

Every line's SimPy model lives in `simpy/<line-folder>/` (e.g. `simpy/bottling-line/`):

| File | What |
|---|---|
| `model.py` | The model, generated from the line's factory.json by `compiler/simpy.js` (do not edit; regenerate). Needs Python 3 and `simpy`. |
| `trace.jsonl` | The event trace of one run: one JSON object per line, in time order. |
| `kpis.json` | The run's KPIs. |

Run it yourself with `python model.py [--out DIR]`, from the command line with `node scripts/simpy.mjs` (all example lines, or `--line <id>`), or over HTTP (below). Runs are **deterministic**: the same factory.json always gives the same trace and KPIs (quality decisions are a fixed function of the unit's serial number).

## trace.jsonl

One event per line:

```json
{"t": 12.35, "unit": 3, "station": "cap", "event": "start"}
```

| Field | Type | Meaning |
|---|---|---|
| `t` | number | simulation time in seconds since the run started |
| `unit` | integer | the unit's serial number (1 … runSize) |
| `station` | string | station id (as in factory.json; parallel copies have their own ids, e.g. `fill1`, `fill2`) |
| `event` | string | one of the events below |
| extra fields | | per event, below |

| `event` | When | Extra fields |
|---|---|---|
| `release` | the unit enters the line at a first station | — |
| `arrive` | a transfer delivers the unit to a station's input | `port` |
| `start` | the station starts its cycle on the unit | — |
| `finish` | the station's cycle ends | `seconds` (the cycle time) |
| `reject` | the unit leaves by a port other than `output` (a reject lane) | `port` |
| `leave` | the unit is handed to the transfer to the next station | `port`, `to` (the next station) |
| `exit` | the unit leaves the line (end of the line, a reject lane that leads nowhere, or a stack such as a pallet) | `port`, `rejected` (true if it was rejected anywhere) |

A unit's lead time is its `exit` time minus its `release` time. Waiting is the gap between `arrive` and `start`, or between `finish` and `leave` (blocked: no room downstream).

## kpis.json

```json
{
  "line": "bottlingLine", "title": "Juice bottling (generic level)",
  "runSize": 10, "unitsOut": 10, "goodUnits": 8,
  "rejects": { "count": 2, "rate": 0.2 },
  "makespan": 140.2,
  "throughputPerHour": 205.4, "steadyPerHour": 295.4,
  "taktAchieved": 9.75, "taktPlanned": 10.48,
  "bottleneckPlanned": { "kind": "station", "id": "pack", "time": 10.48 },
  "leadTime": { "mean": 68.7, "min": 52.5, "max": 92.2 },
  "wip": { "mean": 4.9, "max": 9 },
  "utilisation": { "fill1": 0.52, "cap": 0.69 },
  "finished": true
}
```

| Field | Meaning |
|---|---|
| `runSize`, `unitsOut`, `goodUnits` | units released, units that left the line, those not rejected |
| `rejects.count`, `rejects.rate` | units rejected; share of the run |
| `makespan` | seconds until the last unit left |
| `throughputPerHour` | good units per hour over the makespan (a short run includes filling the empty line, so this is low) |
| `steadyPerHour` | good units per hour once the line is full: 3600 / takt achieved × the good share |
| `taktAchieved` | mean seconds between successive units leaving the line |
| `taktPlanned`, `bottleneckPlanned` | what the line's timing table (compiler/timing.js) predicts: its slowest station or transfer |
| `leadTime` | seconds from release to exit, per unit: mean / min / max |
| `wip` | units in the line: time-weighted mean, and the most at once |
| `utilisation` | per station: share of the makespan spent working (cycle time; waiting and blocked time excluded) |
| `finished` | every unit left the line before the time limit (false: something blocked) |

## Over HTTP (the dev server)

| Request | Answer |
|---|---|
| `POST /api/simpy/run` `{ "line": "<id>" }` (a line in `lines/`) or `{ "example": "<name>" }` (a `spec/examples/` line) | writes `simpy/<folder>/model.py`, runs it, answers `{ folder, kpis, events }` |
| `GET /api/simpy/<folder>/kpis.json` | the last run's KPIs |
| `GET /api/simpy/<folder>/trace.jsonl` | the last run's events, as JSON lines (`?since=<t>` only events at or after time t) |

## What the model is

Every number comes from `compiler/timing.js`, the same step expansion the 3D twin plays: a station's cycle is its intake + process + output steps; each unit is planned with its own facts, so a unit that fails inspection takes the reject branch's time and leaves by the reject port exactly as in the twin. Stations hold one unit; a transfer holds up to its `capacity` (default 1), first in first out; a station that can't hand over waits and re-checks every `holdSeconds` (0.25 s), as the twin does.

**Agreement with the 3D twin** (makespan of the example lines' runs, 2026-11-24): bottling 140.2 s vs 140.3 s played, printer 772.1 s vs 771.4 s. The lubricant line is **5.6 % short** (911.0 s vs 964.7 s): its indexing station and its batch / case / pallet stations hold several units at once, which this unit-by-unit model does not capture yet.
