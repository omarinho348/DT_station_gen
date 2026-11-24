// The deterministic reviewer (agents/reviewer/deterministic.js, Phase 7 step 1): the example lines
// pass; broken copies of the bottling line give every problem, each with its check, its path in
// factory.json and a useful message. The geometry check (step 7.2) has its own file,
// reviewer-geometry.test.js; here the GLB models are not loaded, as in a fresh process.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import { review, formatFindings, opPathFromMessage, stationOps } from '../../agents/reviewer/deterministic.js';

const load = (name) => JSON.parse(readFileSync(`spec/examples/${name}.factory.json`, 'utf8'));
const bottling = load('bottling-line');
const fast = { geometry: false, play: false }; // the checks that need no built line (those have their own files)
const broken = (change) => { const f = structuredClone(bottling); change(f); return review(registry, f, fast); };
const errors = (r) => r.findings.filter((f) => f.severity === 'error');

describe('deterministic reviewer', () => {
  it('passes the three example lines on the checks before geometry (the bottling line\'s two placeholders as warnings)', () => {
    for (const name of ['printer-line', 'lubricant-line']) {
      const r = review(registry, load(name), fast);
      expect(r.findings, name).toEqual([]);
      expect(r.ok).toBe(true);
    }
    const r = review(registry, bottling, fast);
    expect(r.ok).toBe(true);
    expect(r.findings.map((f) => [f.check, f.severity, f.path])).toEqual([
      ['placeholder', 'warning', 'stations[3].equipment[1]'],
      ['placeholder', 'warning', 'stations[4].equipment[1]'],
    ]);
    expect(r.timing.takt).toBeGreaterThan(0);
  });

  it('geometry and play with a GLB model not loaded: a note each, not an error (the CLI preloads them)', () => {
    const r = review(registry, load('lubricant-line'));
    expect(r.ok).toBe(true);
    expect(r.findings.map((f) => [f.check, f.severity, f.path])).toEqual([['geometry', 'info', '(line)'], ['play', 'info', '(line)']]);
    expect(r.findings[1].message).toMatch(/^run not played: "abbIrb6760" needs its model loaded first/);
    expect(r.findings[0].message).toMatch(/^geometry not checked: "abbIrb6760" needs its model loaded first \(abbIrb6760\.glb\)$/);
  });

  it('schema: every issue with its path, at once', () => {
    const r = broken((f) => { f.line.runSize = -3; f.stations[0].title = ''; });
    expect(r.ok).toBe(false);
    expect(errors(r).map((f) => [f.check, f.path])).toEqual([['schema', 'line.runSize'], ['schema', 'stations[0].title']]);
  });

  it('catalog: unknown types and ops and bad params, each at its own path, all collected', () => {
    const r = broken((f) => {
      f.stations[1].equipment[0].type = 'warpBelt';
      f.stations[2].process[0].op = 'teleport';
      f.stations[4].equipment[0].params.length = 99;
      f.graph.edges[1].transport.type = 'hoverTrack';
    });
    expect(errors(r).map((f) => [f.check, f.path])).toEqual([
      ['catalog', 'stations[1].equipment[0].type'],
      ['catalog', 'stations[2].process[0].op'],
      ['catalog', 'stations[4].equipment[0].params'],
      ['catalog', 'graph.edges[1].transport.type'],
    ]);
    expect(errors(r)[0].hint).toMatch(/composite.*genericMachine/);
    expect(errors(r)[2].message).toMatch(/length: Too big/);
  });

  it('ops: every station planned on its own, so two bad stations give two errors, each at the op it is about', () => {
    const r = broken((f) => {
      f.stations[1].process[0].to.lower = 0.9; // the capper's slide is 0.25 m
      f.stations[2].process[1].cases.reject[0].to.port = 'middle'; // inside a decide case
    });
    const e = errors(r);
    expect(e.map((f) => [f.check, f.path])).toEqual([
      ['ops', 'stations[1].process[0]'],
      ['ops', 'stations[2].process[1].cases.reject[0]'],
    ]);
    expect(e[0].message).toMatch(/station "cap": process › op #1 \(move\): machine "capper"\.lower must stay in \[0, 0\.25\], got 0\.9/);
    expect(e[0].hint).toMatch(/capper\.lower reaches \[0, 0\.25\]/);
    expect(e[1].message).toMatch(/middle/);
  });

  it('graph: a problem only the whole line shows (a loop) at "(line)", once the stations are fine', () => {
    const r = broken((f) => { f.graph.edges.push({ from: 'pack.output', to: 'cap.input', transport: { kind: 'conveyor', type: 'beltConveyor', params: {} } }); });
    expect(errors(r).map((f) => [f.check, f.path])).toEqual([['graph', '(line)']]);
    expect(errors(r)[0].message).toMatch(/loop/);
  });

  it('takt: a missed target names the bottleneck and how many copies would make it; a met one is a note', () => {
    const t = review(registry, bottling).timing.takt;
    const missed = broken((f) => { f.line.taktTarget = 5; });
    const w = missed.findings.find((f) => f.check === 'takt');
    expect(w.severity).toBe('warning');
    expect(w.message).toMatch(new RegExp(`takt ${t.toFixed(2)} s misses the target 5 s: the bottleneck is station "\\w+"`));
    expect(w.hint).toMatch(/parallel: \d/);
    const met = broken((f) => { f.line.taktTarget = 60; });
    expect(met.findings.find((f) => f.check === 'takt')).toMatchObject({ severity: 'info' });
    expect(missed.ok).toBe(true); // slower than wanted, but it plays
  });

  it('opSupport: an op that needs its machine to declare it, on one that doesn\'t (here also failing its plan)', () => {
    const r = broken((f) => { f.stations[0].process.splice(2, 0, { op: 'fill', machine: 'doser' }); });
    const w = r.findings.find((f) => f.check === 'opSupport');
    expect(w).toMatchObject({ severity: 'warning', path: 'stations[0].process[2].machine' });
    expect(w.message).toMatch(/op "fill" on "doser" \(composite\), which does not declare "fill"/);
  });

  it('helpers: op paths from plan messages; every op of a station walked (decide cases, indexing)', () => {
    expect(opPathFromMessage('station "x" › output › op #2 (transfer) › case "b" › op #3 (move): …', 'stations[4]')).toBe('stations[4].output[1].cases.b[2]');
    expect(opPathFromMessage('station "x" ports: …', 'stations[4]')).toBe('stations[4]');
    const lub = load('lubricant-line');
    const paths = stationOps(lub.stations[0], 'stations[0]').map((o) => o.path);
    expect(paths).toContain('stations[0].indexing.index[0]');
    expect(paths.some((p) => p.startsWith('stations[0].indexing.work['))).toBe(true);
    expect(formatFindings(review(registry, bottling), { title: 'bottling' })).toMatch(/^bottling: ok · 0 error\(s\), 2 warning\(s\)/);
  });
});
