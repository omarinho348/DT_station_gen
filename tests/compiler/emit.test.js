// The compiler (compiler/emit.js): factory.json → generated/<line>/*.js. The compiled printer line
// must play exactly like the IR it came from: same stations, same machines in the same places,
// the same steps at the same moments, the same scene.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import { compileFactory, lineFolder, moduleName, angle, GENERATED_MARK } from '../../compiler/emit.js';
import { toJs, jsString } from '../../compiler/jsLiteral.js';
import { writeCompiled } from '../../compiler/write.js';
import { expandFactory } from '../../compiler/expand.js';
import { lineTiming } from '../../compiler/timing.js';
import { FactoryError } from '../../spec/factory.schema.js';
import { Line, LINE_STATES, LineError } from '../../lib/line/index.js';
import { createMaterials } from '../../lib/core/materials.js';
import factory from '../../spec/examples/printer-line.factory.json';
import * as compiled from '../../generated/printer-line/line.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCE = 'spec/examples/printer-line.factory.json';
const materials = createMaterials();
const evaluate = (code) => new Function(`return (${code});`)();

describe('jsLiteral', () => {
  it('writes JSON data as a JS literal that evaluates back to the same data', () => {
    const data = {
      a: 1, b: -0.25, c: 1e-12, d: 'it\'s "quoted" \\ back', e: 'line\nbreak\ttab\r', f: `sep${String.fromCharCode(0x2028)}x${String.fromCharCode(0)}`,
      g: [1, [2, [3, {}]], []], h: null, i: true, 'not-ident': 'x', 'two words': { $ok: 1, _ok: 2 }, j: 'π · ±', k: 0.1 + 0.2,
    };
    for (const width of [20, 100, 1000]) expect(evaluate(toJs(data, { width }))).toEqual(data);
    expect(jsString('a\'b')).toBe('\'a\\\'b\'');
  });

  it('keeps short values on one line and breaks long ones one entry per line', () => {
    expect(toJs({ x: [0, 1, 2], y: { z: 'w' } })).toBe('{ x: [0, 1, 2], y: { z: \'w\' } }');
    const long = toJs({ list: Array.from({ length: 40 }, (_, i) => i) }, { width: 60 });
    expect(long.split('\n').length).toBeGreaterThan(3);
    for (const line of toJs(factory.stations[0], { width: 100 }).split('\n')) {
      if (!/'[^']{60,}'/.test(line)) expect(line.length, line).toBeLessThanOrEqual(100); // long strings may run over
    }
  });

  it('follows JSON for undefined and refuses what is not JSON data', () => {
    expect(evaluate(toJs({ a: undefined, b: [undefined] }))).toEqual({ b: [null] });
    expect(() => toJs({ a: NaN })).toThrow(/\$\.a is NaN/);
    expect(() => toJs({ f: () => 1 })).toThrow(/function/);
    expect(() => toJs({ v: new THREE.Vector3() })).toThrow(/Vector3/);
    expect(() => toJs(JSON.parse('{"__proto__": 1}'))).toThrow(/__proto__/);
  });

  it('angles: exact multiples of π as Math.PI expressions, other values as numbers', () => {
    expect(angle(Math.PI / 2)).toBe('Math.PI / 2');
    expect(angle(-Math.PI / 2)).toBe('-Math.PI / 2');
    expect(angle(Math.PI)).toBe('Math.PI');
    expect(angle((3 * Math.PI) / 4)).toBe('3 * Math.PI / 4');
    expect(angle(0.3)).toBe('0.3');
    for (const v of [Math.PI / 2, -Math.PI / 2, Math.PI, (3 * Math.PI) / 4, -Math.PI / 6, 0.3]) expect(evaluate(angle(v))).toBe(v);
  });
});

describe('compileFactory', () => {
  const result = compileFactory(registry, factory, { source: SOURCE });

  it('emits one readable file per station plus line.js, deterministically', () => {
    expect(result.folder).toBe('printer-line');
    expect(lineFolder('printerLine')).toBe('printer-line');
    expect(result.files.map((f) => f.name)).toEqual(['st1.js', 'st2.js', 'st3.js', 'st4.js', 'st5.js', 'st6.js', 'line.js']);
    expect(compileFactory(registry, factory, { source: SOURCE }).files).toEqual(result.files);
    for (const f of result.files) {
      expect(f.content).toContain(GENERATED_MARK);
      expect(f.content).toContain(SOURCE);
      expect(f.content).not.toMatch(/Math\s*\.\s*random/);
      // Imports: three, the library, sibling station files. Nothing else.
      for (const m of f.content.matchAll(/^import .*?['"]([^'"]+)['"];$/gm)) expect(m[1]).toMatch(/^(three|\.\.\/\.\.\/lib\/.+|\.\/st\d\.js)$/);
      // Comments and code stay readable (long strings in data may run over).
      for (const line of f.content.split('\n')) if (!/'[^']{50,}'/.test(line)) expect(line.length, `${f.name}: ${line}`).toBeLessThanOrEqual(130);
    }
    const st5 = result.files.find((f) => f.name === 'st5.js').content;
    expect(st5).toContain('equipment.rejectLane = registry.buildComponent(\'rollerConveyor\'');
    expect(st5).toContain('equipment.rejectLane.root.rotation.y = 1.5708;'); // as written in factory.json (not exactly π/2)
    expect(st5).toMatch(/\/\/ slab: .+ \(shell assemblyCell\)/);
    const st6 = result.files.find((f) => f.name === 'st6.js').content;
    expect(st6).toMatch(/registry\.buildComponent\('rollerConveyor', \{[^}]*\}, \{ \.\.\.ctx, beltHeight: 0\.55 \}\);/);
  });

  it('generated/printer-line/ on disk is what the compiler writes now (else: npm run compile)', () => {
    const dir = join(ROOT, 'generated', result.folder);
    expect(readdirSync(dir).filter((n) => n.endsWith('.js')).sort()).toEqual(result.files.map((f) => f.name).sort());
    for (const f of result.files) expect(readFileSync(join(dir, f.name), 'utf8').replace(/\r\n/g, '\n'), f.name).toBe(f.content);
  });

  it('a compiled station is the expanded station: same data, same machines in the same places', () => {
    const { line } = expandFactory(registry, factory);
    expect(compiled.stations.map((s) => s.station.id)).toEqual(line.stations.map((s) => s.id));
    const ctx = { beltHeight: compiled.conventions.beltHeight, materials };
    for (const s of compiled.stations) {
      const { equipment: list, ...data } = line.stations.find((x) => x.id === s.station.id);
      expect(s.station).toEqual(JSON.parse(JSON.stringify(data)));
      const built = s.build({ registry, ctx });
      expect(Object.keys(built.equipment)).toEqual(list.map((e) => e.id));
      for (const e of list) {
        const inst = built.equipment[e.id];
        expect(inst.type).toBe(e.type);
        expect(inst.params).toEqual(registry.componentSpec(e.type, e.params, e.beltHeight !== undefined ? { ...ctx, beltHeight: e.beltHeight } : ctx).params);
        expect(inst.root.position.toArray()).toEqual(e.position);
        expect(inst.root.rotation.y).toBe(e.rotationY);
        expect(inst.root.parent).toBe(built.root);
      }
      Object.values(built.equipment).forEach((inst) => inst.dispose());
    }
  });

  it('the line file carries the merged conventions, product, edges and the dry timing', () => {
    const expanded = expandFactory(registry, factory);
    expect(compiled.id).toBe('printerLine');
    expect(compiled.runSize).toBe(8);
    expect(compiled.conventions).toEqual(JSON.parse(JSON.stringify(expanded.conventions)));
    expect(compiled.product).toEqual(expanded.line.product);
    expect(compiled.edges).toEqual(expanded.line.edges);
    const timing = lineTiming(registry, expanded.line, { ctx: expanded.ctx, conventions: expanded.conventions });
    expect(compiled.timing.takt).toBe(timing.takt);
    expect(compiled.timing.bottleneck).toEqual(timing.bottleneck);
    expect(compiled.timing.stations.st3.cycleTime).toBe(timing.stations.find((s) => s.id === 'st3').cycleTime);
    expect(compiled.timing.transfers).toEqual(timing.transfers);
  });

  it('refuses a factory.json that does not check, with the paths of the problems', () => {
    const bad = structuredClone(factory);
    bad.stations[1].equipment[0].type = 'noSuchMachine';
    expect(() => compileFactory(registry, bad)).toThrow(/noSuchMachine/);
    const worse = structuredClone(factory);
    worse.stations[0].id = worse.stations[1].id;
    expect(() => compileFactory(registry, worse)).toThrow(FactoryError);
  });

  it('station modules never shadow a reserved word or a line.js binding', () => {
    expect(moduleName('st1')).toBe('st1');
    expect(moduleName('case')).toBe('caseStation');
    expect(moduleName('product')).toBe('productStation');
  });
});

describe('the compiled printer line plays exactly like its factory.json', () => {
  // Every object of the line: name, visibility, world position (rounded to 1e-9 m).
  const scene = (line) => {
    line.root.updateMatrixWorld(true);
    const out = [];
    const p = new THREE.Vector3();
    line.root.traverse((o) => {
      p.setFromMatrixPosition(o.matrixWorld);
      out.push(`${o.name}|${o.visible ? 1 : 0}|${p.toArray().map((v) => Math.round(v * 1e9)).join(',')}`);
    });
    return out;
  };

  it('a whole run of 8, update by update: the same status, transfers and scene', () => {
    const expanded = expandFactory(registry, factory);
    const fromIr = new Line({ registry, line: expanded.line, ctx: { ...expanded.ctx, materials }, conventions: expanded.conventions });
    const fromFiles = compiled.createLine({ materials });
    expect(fromFiles.layout).toEqual(fromIr.layout);
    expect(fromFiles.timing).toEqual(fromIr.timing);
    expect(scene(fromFiles)).toEqual(scene(fromIr));

    fromIr.start();
    fromFiles.start();
    let t = 0;
    let firstDifference = null;
    const checkpoints = new Set([2000, 6000, 12000]);
    for (let i = 0; fromIr.state !== LINE_STATES.FINISHED && t < 900; i += 1) {
      fromIr.update(0.05);
      fromFiles.update(0.05);
      t += 0.05;
      if (firstDifference === null && JSON.stringify(fromFiles.status) !== JSON.stringify(fromIr.status)) {
        firstDifference = { t, ir: fromIr.status, files: fromFiles.status };
      }
      if (checkpoints.has(i)) expect(scene(fromFiles), `scene at ${t.toFixed(2)} s`).toEqual(scene(fromIr));
    }
    expect(firstDifference).toBe(null);
    expect(fromIr.state).toBe(LINE_STATES.FINISHED);
    expect(fromFiles.state).toBe(LINE_STATES.FINISHED);
    expect(fromFiles.status).toMatchObject({ released: 8, exited: 8 });
    expect(scene(fromFiles)).toEqual(scene(fromIr));
    expect(fromFiles.byId.get('st6').cycle.status).toMatchObject({ completed: 6, palletCount: 6 });
    fromIr.dispose();
    fromFiles.dispose();
  }, 300000);
});

describe('Line with compiled stations', () => {
  const base = { id: 'one', title: 'One', product: { type: compiled.product.type }, edges: [] };

  it('needs a station\'s equipment or its build function', () => {
    const { station } = compiled.stations[0];
    expect(() => new Line({ registry, line: { ...base, stations: [{ ...station }] }, ctx: { materials } })).toThrow(/equipment.*build function/);
  });

  it('refuses a build function that returns no machines', () => {
    const { station } = compiled.stations[0];
    const build = () => ({ root: new THREE.Group(), equipment: {} });
    expect(() => new Line({ registry, line: { ...base, stations: [{ ...station, build }] }, ctx: { materials } })).toThrow(LineError);
  });
});

describe('writeCompiled', () => {
  it('writes changed files only, removes stale generated files and leaves other files alone', () => {
    const out = mkdtempSync(join(tmpdir(), 'dt-compile-'));
    try {
      const result = { folder: 'demo', files: [{ name: 'a.js', content: `// a\n// ${GENERATED_MARK}\n` }, { name: 'line.js', content: `// ${GENERATED_MARK}\n` }] };
      expect(writeCompiled(result, out)).toMatchObject({ written: ['a.js', 'line.js'], unchanged: [], removed: [] });
      expect(writeCompiled(result, out)).toMatchObject({ written: [], unchanged: ['a.js', 'line.js'], removed: [] });
      writeFileSync(join(out, 'demo', 'old.js'), `// ${GENERATED_MARK}\n`);
      writeFileSync(join(out, 'demo', 'mine.js'), '// hand-written\n');
      const next = { folder: 'demo', files: [{ name: 'line.js', content: `// ${GENERATED_MARK} v2\n` }] };
      expect(writeCompiled(next, out)).toMatchObject({ written: ['line.js'], unchanged: [], removed: ['a.js', 'old.js'] });
      expect(existsSync(join(out, 'demo', 'mine.js'))).toBe(true);
      expect(readFileSync(join(out, 'demo', 'line.js'), 'utf8')).toBe(`// ${GENERATED_MARK} v2\n`);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
