// Station placement from hints (lib/station/place.js, Phase 8 step 3b): words in, positions out,
// against real parts. The integration tests rebuild example stations from hints alone and run the
// whole reviewer on them: no clashes, and the run plays to the end.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import { preloadComponentAssets } from '../../lib/core/assets.js';
import { placeStation, PlacementError, GAP } from '../../lib/station/place.js';
import { review } from '../../agents/reviewer/deterministic.js';
import { CONVENTIONS } from '../../lib/core/conventions.js';

await preloadComponentAssets(registry);

const ctx = { beltHeight: CONVENTIONS.beltHeight };
const spec = (e) => registry.componentSpec(e.type, e.params ?? {}, ctx);
const at = (r, id) => r.equipment.find((e) => e.id === id);
const portIn = (e, name) => { const p = spec(e).ports[name].position; return [e.position[0] + p[0], p[1], e.position[2] + p[2]]; };

describe('placement hints', () => {
  const belt = { id: 'belt', type: 'beltConveyor', params: { length: 3 }, place: 'line', at: 'whole' };
  const cabinet = (id, extra) => ({ id, type: 'genericMachine', params: { passThrough: false, length: 0.8, depth: 0.6 }, ...extra });

  it('line at the origin; overLine puts a work port on the conveyor\'s work place, else the origin on its centre line', () => {
    const r = placeStation(registry, {
      conveyor: 'belt',
      equipment: [belt, { id: 'tunnel', type: 'genericMachine', params: { passThrough: true, length: 1.2 }, place: 'overLine', at: 'output' }],
    });
    expect(at(r, 'belt').position).toEqual([0, 0, 0]);
    // A pass-through placeholder has a work port at its middle: on the belt's output port (x 1.5).
    expect(portIn(at(r, 'tunnel'), 'work')[0]).toBeCloseTo(1.5, 6);
    expect(at(r, 'tunnel').position[2]).toBe(0);
  });

  it('rear and front: clear of the conveyor by the gap and of each other; side by side when they share a place', () => {
    const r = placeStation(registry, {
      conveyor: 'belt',
      equipment: [belt, cabinet('a', { place: 'rear', at: 'work' }), cabinet('b', { place: 'rear', at: 'work' }), cabinet('c', { place: 'front', at: 'input' })],
    });
    const edge = spec(belt).footprint.z;
    for (const id of ['a', 'b']) expect(at(r, id).position[2] + spec(at(r, id)).footprint.z[1]).toBeLessThanOrEqual(edge[0] - GAP + 1e-9);
    expect(at(r, 'a').position[2]).toBe(at(r, 'b').position[2]);
    expect(at(r, 'b').position[0] - at(r, 'a').position[0]).toBeCloseTo(0.8 + 0.15, 6); // widths and the side gap
    expect((at(r, 'a').position[0] + at(r, 'b').position[0]) / 2).toBeCloseTo(0, 6); // centred on the work place
    expect(at(r, 'c').position[2] + spec(at(r, 'c')).footprint.z[0]).toBeGreaterThanOrEqual(edge[1] + GAP - 1e-9);
    expect(at(r, 'c').position[0]).toBeCloseTo(-1.5, 6); // at the input port
    expect(r.notes).toEqual([]);
  });

  it('besideLine: against the edge (either side); turned, it runs away from the line', () => {
    const lane = { id: 'lane', type: 'rollerConveyor', params: { length: 1.2 }, place: 'besideLine', at: 'work', turned: true };
    const r = placeStation(registry, {
      conveyor: 'belt',
      equipment: [belt, lane, cabinet('near', { place: 'besideLine', at: 'input', side: 'walkway' })],
    });
    expect(at(r, 'lane').rotationY).toBe(Math.PI / 2); // exactly: +X now points to −Z
    // Turned, its local x runs along −Z: its start (footprint x0) lies on the belt's equipment-side edge.
    expect(at(r, 'lane').position[2] - spec(at(r, 'lane')).footprint.x[0]).toBeCloseTo(spec(belt).footprint.z[0], 6);
    expect(at(r, 'near').position[2] + spec(at(r, 'near')).footprint.z[0]).toBeCloseTo(spec(belt).footprint.z[1], 6);
  });

  it('upstream / downstream: ports meet the conveyor\'s input / output; onTop rests on the top, centred', () => {
    const r = placeStation(registry, {
      conveyor: 'belt',
      equipment: [
        belt,
        { id: 'feed', type: 'beltConveyor', params: { length: 1 }, place: 'upstream', at: 'input' },
        { id: 'away', type: 'beltConveyor', params: { length: 1 }, place: 'downstream', at: 'output' },
        { id: 'table', type: 'workTable', params: {}, place: 'rear', at: 'output' },
        { id: 'box', type: 'tote', params: {}, place: 'onTop', on: 'table', at: 'whole' },
      ],
    });
    expect(portIn(at(r, 'feed'), 'output')).toEqual(portIn(at(r, 'belt'), 'input'));
    expect(portIn(at(r, 'away'), 'input')).toEqual(portIn(at(r, 'belt'), 'output'));
    expect(at(r, 'box').position[1]).toBeCloseTo(spec(at(r, 'table')).footprint.height, 6);
    expect(at(r, 'box').position[0]).toBeCloseTo(at(r, 'table').position[0] + (spec(at(r, 'table')).footprint.x[0] + spec(at(r, 'table')).footprint.x[1]) / 2, 6);
  });

  it('refuses hints it cannot place, with the reason', () => {
    const run = (equipment, conveyor = 'belt') => () => placeStation(registry, { conveyor, equipment });
    expect(run([{ ...belt, place: 'rear' }])).toThrow(/the conveyor "belt" must have place "line"/);
    expect(run([belt, { ...belt, id: 'belt2' }])).toThrow(/only the conveyor \("belt"\) takes place "line"/);
    expect(run([belt], 'nope')).toThrow(/neither a machine of the station nor of its shell/);
    expect(run([belt, belt])).toThrow(/equipment id "belt" is used twice/);
    expect(run([belt, cabinet('x', { place: 'onTop', at: 'work' })])).toThrow(/place onTop needs "on"/);
    expect(run([belt, cabinet('x', { place: 'sideways', at: 'work' })])).toThrow(/unknown place "sideways"/);
    expect(run([belt], 'nope')).toThrow(PlacementError);
  });
});

describe('example stations rebuilt from hints alone', () => {
  it('the bottling line: the same places as by hand (the reject lane steps clear of the camera frame), no clash, the run plays to the end', () => {
    const hints = {
      fill: { belt: { place: 'line', at: 'whole' }, doser: { place: 'overLine', at: 'work' } },
      cap: { belt: { place: 'line', at: 'whole' }, capper: { place: 'overLine', at: 'work' } },
      inspect: { belt: { place: 'line', at: 'whole' }, vision: { place: 'overLine', at: 'work' }, rejectLane: { place: 'besideLine', at: 'work', turned: true } },
      rework: { belt: { place: 'line', at: 'whole' }, machine: { place: 'overLine', at: 'work' } },
      pack: { belt: { place: 'line', at: 'whole' }, machine: { place: 'overLine', at: 'work' } },
    };
    const f = JSON.parse(readFileSync('spec/examples/bottling-line.factory.json', 'utf8'));
    for (const s of f.stations) {
      const r = placeStation(registry, { conveyor: s.conveyor, equipment: s.equipment.map((e) => ({ ...e, ...hints[s.id][e.id] })) });
      expect(r.notes, s.id).toEqual([]);
      for (const e of r.equipment) if (e.id !== 'rejectLane') expect(e.position, `${s.id}/${e.id}`).toEqual(s.equipment.find((x) => x.id === e.id).position ?? [0, 0, 0]);
      s.equipment = r.equipment;
    }
    const result = review(registry, f);
    expect(result.ok).toBe(true);
    expect(result.findings.filter((x) => x.check === 'geometry')).toEqual([]);
    expect(result.findings.find((x) => x.check === 'play').message).toMatch(/^played a run of 10: every unit left the line/);
  }, 120000);

  it('printer ST2–ST5 inside their shells: machines in a portal\'s span, not behind the fence; a rear machine that only fits behind it is a note; the run plays', () => {
    const hints = {
      st2: { gantry: { place: 'overLine', at: 'work' }, presenter: { place: 'rear', at: 'output' }, feederM3: { place: 'onTop', on: 'presenter' }, feederM4: { place: 'onTop', on: 'presenter' }, feederM5: { place: 'onTop', on: 'presenter' } },
      st3: { gantry: { place: 'overLine', at: 'work' }, harnessBoard: { place: 'rear', at: 'output' }, tester: { place: 'rear', at: 'input' } },
      st4: { enclosure: { place: 'overLine', at: 'work' }, dock: { place: 'besideLine', at: 'work' }, monitor: { place: 'front', at: 'output' }, rack: { place: 'rear', at: 'work' } },
      st5: { scanner: { place: 'overLine', at: 'work' }, labeller: { place: 'besideLine', side: 'walkway', at: 'work' }, diverter: { place: 'overLine', at: 'work' }, rejectLane: { place: 'besideLine', at: 'work', turned: true }, rejectSign: { place: 'rear', at: 'output' }, monitor: { place: 'front', at: 'output' } },
    };
    const f = JSON.parse(readFileSync('spec/examples/printer-line.factory.json', 'utf8'));
    const notes = [];
    for (const s of f.stations) {
      if (!hints[s.id]) continue;
      const shell = registry.expandShell(s.shell.type, s.shell.params, ctx);
      const r = placeStation(registry, { conveyor: shell.station.conveyor, fixed: shell.equipment, equipment: s.equipment.map((e) => ({ ...e, ...hints[s.id][e.id] })) });
      notes.push(...r.notes.map((n) => `${s.id}: ${n.message}`));
      s.equipment = r.equipment;
    }
    const presenter = f.stations[1].equipment.find((e) => e.id === 'presenter');
    expect(presenter.position[2]).toBeGreaterThan(-1.3); // inside the gantry's span, in front of the fence (−1.55)
    expect(notes).toEqual(['st4: "rack" only fits behind "fence" (guardFence), which runs along the station: make the cell deeper on that side or pick a smaller machine']);
    const result = review(registry, f);
    expect(result.ok).toBe(true);
    expect(result.findings.filter((x) => x.check === 'geometry')).toEqual([]);
    expect(result.findings.find((x) => x.check === 'play').message).toMatch(/^played a run of 8: every unit left the line/);
  }, 180000);
});
