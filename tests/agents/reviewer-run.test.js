// The reviewer's step-7.3 checks: every edge against the ports it joins (agents/reviewer/
// deterministic.js, edgeFindings) and the run played headless, where targets worked out at run
// time (a part's seat, a screw hole) meet the reach of the robot or gantry aiming at them
// (agents/reviewer/play.js).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import { preloadComponentAssets } from '../../lib/core/assets.js';
import { checkFactory } from '../../compiler/expand.js';
import { parseFactory } from '../../spec/factory.schema.js';
import { review } from '../../agents/reviewer/deterministic.js';
import { reviewPlay } from '../../agents/reviewer/play.js';

await preloadComponentAssets(registry);

const load = (name) => JSON.parse(readFileSync(`spec/examples/${name}.factory.json`, 'utf8'));
const of = (r, check) => r.findings.filter((f) => f.check === check);
const fast = { geometry: false, play: false };

describe('edges', () => {
  it('every edge on its own: a wrong direction, a flow type mismatch, the edge\'s carries and its transport, all at once, each at its field', () => {
    const f = load('lubricant-line');
    f.graph.edges[0].to = 'canTransfer.output'; // an output as the edge's end
    f.graph.edges[1].to = 'palletizing.input'; // batches into a station that takes cases
    f.graph.edges[2].carries = 'unit';
    f.graph.edges[2].transport.params.carries = 'batch';
    const r = review(registry, f, fast);
    expect(r.ok).toBe(false);
    const e = of(r, 'edges');
    expect(e.map((x) => [x.severity, x.path])).toEqual([
      ['error', 'graph.edges[0].to'],
      ['error', 'graph.edges[1]'],
      ['error', 'graph.edges[2].carries'],
      ['error', 'graph.edges[2].transport.type'],
    ]);
    expect(e[0].message).toBe('"canTransfer.output" is an output, not an input');
    expect(e[1].message).toBe('"canTransfer.output" gives batch but "palletizing.input" takes case');
    expect(e[1].hint).toMatch(/turns batch into case/);
    expect(e[2].message).toBe('the edge says unit but its ports carry case');
    expect(e[3].message).toBe('transport "beltConveyor" carries batch, not case');
    expect(of(r, 'graph')).toEqual([]); // the whole line is only looked at once its edges are fine
  });

  it('a port the station does not have: its ports listed', () => {
    const f = load('bottling-line');
    f.graph.edges[1].from = 'cap.side';
    const e = of(review(registry, f, fast), 'edges');
    expect(e.map((x) => x.path)).toEqual(['graph.edges[1].from']);
    expect(e[0].message).toBe('station "cap" has no port "side"');
    expect(e[0].hint).toBe('its ports: input, output');
  });

  it('the example lines have no edge findings', () => {
    for (const name of ['printer-line', 'lubricant-line', 'bottling-line']) expect(of(review(registry, load(name), fast), 'edges'), name).toEqual([]);
  });
});

describe('play', () => {
  it('the bottling line plays its run of 10 to the end: a note with its time against the estimate', () => {
    const p = of(review(registry, load('bottling-line'), { geometry: false }), 'play');
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ severity: 'info', path: '(line)' });
    expect(p[0].message).toMatch(/^played a run of 10: every unit left the line after [\d.]+ s \(estimated [\d.]+ s\)$/);
  });

  it('reach: a gantry moved away from the work place passes the dry plan but cannot reach the part\'s seat once it is worked out', () => {
    const f = load('printer-line');
    f.stations[1].equipment.find((e) => e.id === 'gantry').position = [-1.5, 0, 0];
    const r = review(registry, f, { geometry: false });
    expect(of(r, 'ops')).toEqual([]); // the dry plan cannot see it
    const p = of(r, 'play');
    expect(p).toHaveLength(1);
    expect(p[0].severity).toBe('error');
    expect(p[0].path).toBe('stations[1].process[1]'); // the installPart its step "Moving to Z motor assy" came from
    expect(p[0].message).toMatch(/^station "st2" stopped in ALARM at [\d.]+ s of the run \(unit \d+ of 8 released\): .*cannot reach \w+ = [-\d.]+ \(range \[/);
    expect(p[0].hint).toMatch(/move the machine closer to it .* or pick one with a longer \w+ \(reaches \[/);
  });

  it('a run that does not finish in its time: an error naming where units are held', () => {
    const data = load('bottling-line');
    const r = checkFactory(registry, data);
    const p = reviewPlay(registry, parseFactory(data), r.expanded, r.timing, { limit: 20 });
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ check: 'play', severity: 'error', path: '(line)' });
    expect(p[0].message).toMatch(/^the run of 10 did not finish in 20 s \(estimated [\d]+ s\): \d+ released, 0 left the line; units held at "fill1" \(/);
  });
});
