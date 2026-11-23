#!/usr/bin/env node
// Writes spec/examples/bottling-line.factory.json: Phase 6's closing test line, built only from the
// generic level (basic blocks in composites, placeholders, graph shapes, a parametric product);
// the conveyors are the catalog belt. Kept as a script so the numbers stay readable; the JSON is
// the source of truth once written (edit it, or this, and run again).
//
//   node scripts/make-bottling-line.mjs
import { writeFileSync } from 'node:fs';

const H = 0.86;
const ports = { input: { machine: 'belt', port: 'input' }, output: { machine: 'belt', port: 'output' } };
const belt = (length = 2.4) => ({ id: 'belt', type: 'beltConveyor', params: { length } });
const toWork = [{ op: 'transfer', conveyor: 'belt', to: { machine: 'belt', port: 'input', offset: [1.2, 0, 0] }, label: 'Bottle in' }];
const out = [{ op: 'transfer', conveyor: 'belt', to: 'output', label: 'Bottle out' }];
const T = { kind: 'conveyor', type: 'beltConveyor', params: {} };
const placeholder = (id, code, title, name, note, seconds, length = 1.2) => ({
  id, code, title, conveyor: 'belt', inputStage: 'capped', ports,
  equipment: [belt(2.6), { id: 'machine', type: 'genericMachine', params: { name, note, length, depth: 0.9 } }],
  intake: [{ op: 'transfer', conveyor: 'belt', to: { machine: 'machine', port: 'work' }, label: `Into the ${name.toLowerCase()}` }],
  process: [{ op: 'operate', machine: 'machine', seconds, label: name }],
  output: out,
  feed: { fromLift: false },
});

const factory = {
  $schema: '../factory.schema.json',
  version: 1,
  line: { id: 'bottlingLine', title: 'Juice bottling (generic level)', runSize: 10, conventions: { beltHeight: H } },
  product: { kind: 'parametric', params: { shape: 'bottle', length: 0.09, width: 0.09, height: 0.26, finish: 'glass', liquid: '#d9a21b', labelText: 'APPLE JUICE', rejectEvery: 4 } },
  stations: [
    {
      id: 'fill', code: 'F', title: 'Filling', parallel: 2, conveyor: 'belt', inputStage: 'raw', ports,
      equipment: [belt(), {
        id: 'doser', type: 'composite', params: {
          parts: [
            { id: 'frame', type: 'portalFrame', params: { span: 0.8, height: 2.0 } },
            { id: 'cross', type: 'linearAxis', params: { stroke: 0.5, hang: true }, on: 'frame.beam', rotationY: Math.PI / 2 },
            { id: 'lift', type: 'verticalAxis', params: { stroke: 0.25, bodyLength: 0.35 }, on: 'cross.carriage' },
            { id: 'nozzle', type: 'dispenseNozzle', params: { jetLength: 0.15, liquid: 'oil' }, on: 'lift.ram' },
          ],
          motions: { lower: 'lift.extend', flow: 'nozzle.flow' },
          anchors: { tool: 'nozzle' },
        },
      }],
      intake: toWork,
      process: [
        { op: 'move', machine: 'doser', to: { lower: 0.2 }, seconds: 1.0, label: 'Nozzle down', state: 'FILLING' },
        { op: 'move', machine: 'doser', to: { flow: 1 }, seconds: 0.3, label: 'Valve open', state: 'FILLING' },
        { op: 'runRoutine', routine: 'fill', seconds: 6, label: 'Filling', state: 'FILLING' },
        { op: 'move', machine: 'doser', to: { flow: 0 }, seconds: 0.3, label: 'Valve closed', state: 'FILLING' },
        { op: 'move', machine: 'doser', to: { lower: 0 }, seconds: 1.0, label: 'Nozzle up', state: 'FILLING' },
      ],
      output: out,
      feed: { fromLift: false },
    },
    {
      id: 'cap', code: 'C', title: 'Capping', conveyor: 'belt', inputStage: 'filled', ports,
      equipment: [belt(), {
        id: 'capper', type: 'composite', params: {
          parts: [
            { id: 'arm', type: 'cantileverFrame', params: { reach: 0.8, height: 1.9 } },
            { id: 'lift', type: 'verticalAxis', params: { stroke: 0.25, bodyLength: 0.35 }, on: 'arm.tip' },
            { id: 'wrist', type: 'rotaryAxis', params: { hang: true, radius: 0.05, height: 0.08 }, on: 'lift.ram' },
            { id: 'chuck', type: 'fingerGripper', params: { fingerLength: 0.08, maxGap: 0.08 }, on: 'wrist.flange' },
          ],
          motions: { lower: 'lift.extend', spin: 'wrist.angle', grip: 'chuck.grip' },
          anchors: { tool: 'chuck' },
        },
      }],
      intake: toWork,
      process: [
        { op: 'move', machine: 'capper', to: { lower: 0.18 }, seconds: 0.8, label: 'Chuck down to the neck', state: 'CAPPING' },
        { op: 'move', machine: 'capper', to: { grip: 0.035 }, seconds: 0.3, label: 'Cap placed', state: 'CAPPING', after: [{ set: { cap: 'on' } }] },
        { op: 'move', machine: 'capper', by: { spin: 6 * Math.PI }, seconds: 1.5, label: 'Screwing the cap on', state: 'CAPPING' },
        { op: 'move', machine: 'capper', to: { grip: 0.08 }, seconds: 0.2, label: 'Chuck open', state: 'CAPPING' },
        { op: 'move', machine: 'capper', to: { lower: 0 }, seconds: 0.8, label: 'Chuck up', state: 'CAPPING' },
      ],
      output: out,
      feed: { fromLift: false },
    },
    {
      id: 'inspect', code: 'Q', title: 'Inspection', conveyor: 'belt', inputStage: 'capped',
      ports: { ...ports, reject: { machine: 'rejectLane', port: 'output', direction: 'out' } },
      equipment: [
        belt(),
        {
          id: 'vision', type: 'composite', params: {
            parts: [
              { id: 'arm', type: 'cantileverFrame', params: { reach: 0.7, height: 1.7 } },
              { id: 'camera', type: 'visionCamera', params: { workingDistance: 0.4 }, on: 'arm.tip' },
            ],
            motions: { light: 'camera.light' },
          },
        },
        { id: 'rejectLane', type: 'rollerConveyor', params: { length: 1.2, width: 0.4, endStop: false, bayMarking: false }, position: [0.6, 0, -0.95], rotationY: Math.PI / 2 },
      ],
      intake: toWork,
      process: [
        { op: 'toolOn', machine: 'vision', motion: 'light', value: 'on', then: 'off', seconds: 1.5, label: 'Vision check', state: 'INSPECTING' },
        {
          op: 'decide', on: 'quality', planAs: 'pass', cases: {
            pass: [],
            reject: [{ op: 'transfer', conveyor: 'rejectLane', from: { machine: 'belt', port: 'input', offset: [1.2, 0, 0] }, to: { machine: 'rejectLane', port: 'output' }, label: 'Rejected · to rework', state: 'REJECT' }],
          },
        },
      ],
      output: out,
      feed: { fromLift: false },
    },
    placeholder('rework', 'R', 'Rework', 'Rework bench', 'manual check', 8),
    placeholder('pack', 'P', 'Case packing', 'Case packer', '6 bottles per case', 4, 1.4),
  ],
  graph: {
    edges: [
      { from: 'fill.output', to: 'cap.input', transport: { ...T, capacity: 3 } },
      { from: 'cap.output', to: 'inspect.input', transport: T },
      { from: 'inspect.output', to: 'pack.input', transport: T },
      { from: 'inspect.reject', to: 'rework.input', transport: T },
    ],
  },
};

const out_ = new URL('../spec/examples/bottling-line.factory.json', import.meta.url);
writeFileSync(out_, `${JSON.stringify(factory, null, 2)}\n`);
console.log(`written ${out_.pathname}`);
