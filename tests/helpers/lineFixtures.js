// A small line used by the line and timing tests: three reference-sized stations with plain
// wait processes, chained by pallet transfers (types from the catalog, as in factory.json).
export function station(id, code, process, { conveyor = 'palletConveyor' } = {}) {
  return {
    id, code, title: `Station ${code}`, workState: 'WORKING', inputStage: 'kitted', conveyor: 'line',
    ports: { input: { standalone: ['liftIn'] }, output: { standalone: ['liftOut'] } },
    process,
    signals: { beacon: { machine: 'beacon' } },
    equipment: [
      { id: 'line', type: conveyor, params: {} },
      { id: 'liftIn', type: 'liftUnit', position: [-1.6, 0, 0] },
      { id: 'liftOut', type: 'liftUnit', position: [1.6, 0, 0] },
      { id: 'beacon', type: 'stackLight', position: [1.95, 0, -0.55] },
    ],
  };
}

export const wait = (s, label = 'Working') => [{ op: 'wait', seconds: s, label }];
export const TRANSFER = { type: 'palletConveyor', params: { workStop: false } };

export function lineData(overrides = {}) {
  return {
    id: 'demo', title: 'Demo line', runSize: 3, product: { type: 'printer' },
    stations: [station('a', 'A1', wait(1)), station('b', 'B2', wait(1.5)), station('c', 'C3', wait(1))],
    edges: [
      { from: 'a.output', to: 'b.input', carries: 'pallet', transport: TRANSFER },
      { from: 'b.output', to: 'c.input', transport: TRANSFER },
    ],
    ...overrides,
  };
}
