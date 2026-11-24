// The reviewer's geometry check (agents/reviewer/geometry.js, Phase 7 step 2): the line built
// headless, its parts tested against each other. Meant overlaps (over / at a conveyor, resting on
// a surface, meeting at a port, a transfer at its two ends) stay quiet; real clashes are found on
// broken copies of the bottling line and on the reference-derived printer line.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import { preloadComponentAssets } from '../../lib/core/assets.js';
import { checkFactory } from '../../compiler/expand.js';
import { review } from '../../agents/reviewer/deterministic.js';
import { penetration, solidsOf, TOLERANCE } from '../../agents/reviewer/geometry.js';

await preloadComponentAssets(registry);

const load = (name) => JSON.parse(readFileSync(`spec/examples/${name}.factory.json`, 'utf8'));
const bottling = load('bottling-line');
const geometry = (r) => r.findings.filter((f) => f.check === 'geometry');

/** One mesh (a box of `size` at `position`, turned `turn` about Y) as the check sees it. */
function part(size, position, turn = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size));
  mesh.name = 'part';
  mesh.position.set(...position);
  mesh.rotation.y = turn;
  mesh.updateMatrixWorld(true);
  return solidsOf(mesh)[0];
}

describe('geometry: penetration of two parts', () => {
  it('apart or only touching: 0; a post through a table top: how far it must move to clear (half the top + half the post, less the offset)', () => {
    expect(penetration(part([1, 1, 1], [0, 0.5, 0]), part([1, 1, 1], [1, 0.5, 0]))).toBe(0); // faces touch
    expect(penetration(part([1, 1, 1], [0, 0.5, 0]), part([1, 1, 1], [3, 0.5, 0]))).toBe(0);
    const post = part([0.05, 2.87, 0.05], [-7.5, 1.435, -1.085]);
    const top = part([1.2, 0.04, 0.5], [-7.25, 0.78, -1.05]);
    expect(penetration(post, top)).toBeCloseTo(0.24, 6); // 0.25 + 0.025 − 0.035 across Z
  });

  it('turned parts: boxes whose axis-aligned bounds overlap but which do not touch give 0', () => {
    const a = part([2, 0.1, 0.1], [0, 0.05, 0], Math.PI / 4); // a diagonal bar
    const b = part([0.2, 0.1, 0.2], [0.6, 0.05, 0.6]); // on the other diagonal (the bar runs to +X −Z)
    expect(a.box.intersectsBox(b.box)).toBe(true);
    expect(penetration(a, b)).toBe(0);
    expect(penetration(a, part([0.2, 0.1, 0.2], [0.5, 0.05, -0.5]))).toBeGreaterThan(TOLERANCE); // on the bar
  });
});

describe('geometry: the review', () => {
  it('the three example lines are clean: meant overlaps quiet, the clips fixed (step 7.3)', () => {
    for (const name of ['bottling-line', 'lubricant-line', 'printer-line']) expect(geometry(review(registry, load(name), { play: false })), name).toEqual([]);
  });

  it('shell furniture against a station\'s own equipment: ST2 back to the reference (shallow slab, wide presenter) gives the sign post through the table as a warning, at the station\'s own equipment', () => {
    const f = load('printer-line');
    f.stations[1].shell.params.minZ = -1.5;
    f.stations[1].equipment.find((e) => e.id === 'presenter').params.width = 0.5;
    const r = review(registry, f, { play: false });
    expect(r.ok).toBe(true); // it still plays
    const g = geometry(r);
    expect(g.every((x) => x.severity === 'warning')).toBe(true);
    const sign = g.find((x) => /"sign" \(stationSign\) and "presenter" \(workTable\)/.test(x.message));
    expect(sign.message).toMatch(/Sign post × Table top, 240 mm to clear/);
    expect(sign.path).toBe('stations[1].equipment[1]'); // the station's own equipment, not its shell
    expect(g.map((x) => x.message.match(/"(\w+)" \(\w+\) and "(\w+)"/).slice(1).join(' × ')).sort()).toEqual(['fence × presenter', 'gantry × presenter', 'sign × presenter']);
  });

  it('two machines in the same place: a warning at the second, with both ids and the parts', () => {
    const f = structuredClone(bottling);
    const capper = f.stations[1].equipment.find((e) => e.id === 'capper');
    f.stations[1].equipment.push({ ...structuredClone(capper), id: 'capper2' });
    const g = geometry(review(registry, f, { play: false }));
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ severity: 'warning', path: 'stations[1].equipment[2]' });
    expect(g[0].message).toMatch(/^station "cap": "capper" \(composite\) and "capper2" \(composite\) overlap \(.+ × .+, \d+ mm to clear\)$/);
    expect(g[0].hint).toMatch(/move one of them/);
  });

  it('a parallel station: the clash in each copy points at the station written once', () => {
    const f = structuredClone(bottling);
    const doser = f.stations[0].equipment.find((e) => e.id === 'doser');
    f.stations[0].equipment.push({ ...structuredClone(doser), id: 'doser2' });
    const g = geometry(review(registry, f, { play: false }));
    expect(g.map((x) => x.path)).toEqual(['stations[0].equipment[2]', 'stations[0].equipment[2]']);
    expect(g.map((x) => x.message.split(':')[0])).toEqual(['station "fill1"', 'station "fill2"']);
  });

  it('a transfer running through equipment: an error at the edge, naming what it runs through', () => {
    // A cabinet in the inspection station, right under the reject transfer to the rework lane.
    const { timing } = checkFactory(registry, bottling);
    const t = timing.layout.transfers.find((x) => x.from === 'inspect' && x.to === 'rework');
    const at = timing.layout.stations.inspect;
    const f = structuredClone(bottling);
    f.stations[2].equipment.push({
      id: 'cabinet', type: 'genericMachine', params: { name: 'In the way', passThrough: false, length: 0.6, depth: 0.6 },
      position: [t.centre - at.x, 0, t.z - at.z],
    });
    const r = review(registry, f, { play: false });
    expect(r.ok).toBe(false);
    const e = geometry(r).filter((x) => x.severity === 'error');
    expect(e).toHaveLength(1);
    expect(e[0].path).toBe('graph.edges[3]');
    expect(e[0].message).toMatch(/^the transfer inspect\.reject → rework\.input \(beltConveyor\) runs through station "inspect"'s "cabinet" \(genericMachine\)/);
  });

  it('geometry: false skips building the line', () => {
    const f = structuredClone(bottling);
    const capper = f.stations[1].equipment.find((e) => e.id === 'capper');
    f.stations[1].equipment.push({ ...structuredClone(capper), id: 'capper2' });
    expect(geometry(review(registry, f, { geometry: false, play: false }))).toEqual([]);
  });
});
